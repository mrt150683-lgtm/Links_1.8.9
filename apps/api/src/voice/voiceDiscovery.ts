/**
 * Voice Discovery
 *
 * Scans the voices/ directory for *.onnx files, reads their companion
 * .json metadata, and upserts each voice into the voice_voices table.
 *
 * Called on GET /voice/voices. Safe to call repeatedly — uses ON CONFLICT
 * upsert on source_path so re-runs are idempotent.
 *
 * Filename convention: {lang_code}-{speaker_name}-{quality}.onnx
 * Example: en_GB-jenny_dioco-medium.onnx
 */

import { existsSync, readdirSync, readFileSync, openSync, readSync, closeSync } from 'fs';
import { resolve, join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { createLogger } from '@links/logging';
import { upsertVoiceVoice } from '@links/storage';
import type { VoiceQuality, VoiceVoice } from '@links/storage';

const logger = createLogger({ name: 'voice:discovery' });

const VALID_QUALITIES: VoiceQuality[] = ['low', 'medium', 'high', 'x_low'];

// ── Dir resolution ─────────────────────────────────────────────────────────

export function resolveVoicesDir(): string {
  if (process.env.VOICES_DIR) {
    return process.env.VOICES_DIR;
  }
  // Portable: relative to this file's location (api/src/voice → project root/voices)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const fromFile = resolve(__dirname, '../../../../voices');
  if (existsSync(fromFile)) return fromFile;

  // CWD fallback (dev)
  const fromCwd = resolve(process.cwd(), 'voices');
  if (existsSync(fromCwd)) return fromCwd;

  return fromFile; // Return even if missing — discovery will log a warning
}

// ── Filename parsing ────────────────────────────────────────────────────────

interface ParsedFilename {
  langCode: string;
  speakerName: string;
  quality: VoiceQuality;
}

export function parseVoiceFilename(filename: string): ParsedFilename | null {
  // Strip .onnx extension
  const stem = filename.replace(/\.onnx$/, '');
  // Split on '-': first part = lang_code, last part = quality, middle = speaker
  const parts = stem.split('-');
  if (parts.length < 3) return null;

  const qualityRaw = parts[parts.length - 1];
  if (!VALID_QUALITIES.includes(qualityRaw as VoiceQuality)) return null;

  const langCode = parts[0];
  const speakerName = parts.slice(1, -1).join('-');

  if (!langCode || !speakerName) return null;

  return {
    langCode,
    speakerName,
    quality: qualityRaw as VoiceQuality,
  };
}

// ── Metadata reading ────────────────────────────────────────────────────────

interface PiperMetadata {
  sampleRate?: number;
  numSpeakers?: number;
  piperVersion?: string;
  langCode?: string;
}

function readPiperMetadata(onnxPath: string): PiperMetadata {
  const jsonPath = onnxPath + '.json';
  if (!existsSync(jsonPath)) return {};

  try {
    const raw = readFileSync(jsonPath, 'utf-8');
    const data = JSON.parse(raw);
    return {
      sampleRate: data?.audio?.sample_rate ?? undefined,
      numSpeakers: data?.num_speakers ?? undefined,
      piperVersion: data?.piper_version ?? undefined,
      langCode: data?.language?.code ?? undefined,
    };
  } catch {
    return {};
  }
}

// ── File hash (first 64 KB, for change detection) ──────────────────────────

function computeFileHash(filePath: string): string | null {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytesRead = readSync(fd, buf, 0, 65536, 0);
    closeSync(fd);
    return createHash('sha256').update(buf.subarray(0, bytesRead)).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

// ── Stable ID derived from source path ─────────────────────────────────────

function stableId(sourcePath: string): string {
  return createHash('sha256').update(sourcePath).digest('hex').slice(0, 32);
}

// ── Display name ────────────────────────────────────────────────────────────

function makeDisplayName(speakerName: string, langCode: string, quality: VoiceQuality): string {
  const speaker = speakerName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${speaker} (${langCode}, ${quality})`;
}

// ── Single-file upsert (used by import route) ───────────────────────────────

export async function upsertDiscoveredVoice(onnxPath: string, isImported = false): Promise<VoiceVoice | null> {
  const filename = basename(onnxPath);
  const parsed = parseVoiceFilename(filename);
  if (!parsed) return null;

  const meta = readPiperMetadata(onnxPath);
  const langCode = meta.langCode ?? parsed.langCode;

  return upsertVoiceVoice({
    id: stableId(onnxPath),
    display_name: makeDisplayName(parsed.speakerName, langCode, parsed.quality),
    lang_code: langCode,
    speaker_name: parsed.speakerName,
    quality: parsed.quality,
    engine_type: 'piper',
    source_path: onnxPath,
    is_imported: isImported,
    file_hash: computeFileHash(onnxPath),
    sample_rate: meta.sampleRate ?? null,
    num_speakers: meta.numSpeakers ?? 1,
    piper_version: meta.piperVersion ?? null,
    enabled: true,
  });
}

// ── Main discovery function ─────────────────────────────────────────────────

export async function discoverAndIndexVoices(): Promise<number> {
  const voicesDir = resolveVoicesDir();

  if (!existsSync(voicesDir)) {
    logger.warn({ msg: 'voice:discovery voices dir not found', voicesDir });
    return 0;
  }

  let files: string[];
  try {
    files = readdirSync(voicesDir).filter((f) => f.endsWith('.onnx'));
  } catch (err) {
    logger.error({ msg: 'voice:discovery failed to read voices dir', voicesDir, err });
    return 0;
  }

  logger.info({ msg: 'voice:discovery starting', count: files.length, voicesDir });

  let indexed = 0;
  for (const filename of files) {
    const onnxPath = join(voicesDir, filename);
    const parsed = parseVoiceFilename(filename);

    if (!parsed) {
      logger.warn({ msg: 'voice:discovery skipping unparseable filename', filename });
      continue;
    }

    const meta = readPiperMetadata(onnxPath);
    // Prefer lang code from metadata if available
    const langCode = meta.langCode ?? parsed.langCode;

    try {
      await upsertVoiceVoice({
        id: stableId(onnxPath),
        display_name: makeDisplayName(parsed.speakerName, langCode, parsed.quality),
        lang_code: langCode,
        speaker_name: parsed.speakerName,
        quality: parsed.quality,
        engine_type: 'piper',
        source_path: onnxPath,
        is_imported: false,
        file_hash: computeFileHash(onnxPath),
        sample_rate: meta.sampleRate ?? null,
        num_speakers: meta.numSpeakers ?? 1,
        piper_version: meta.piperVersion ?? null,
        enabled: true,
      });
      indexed++;
    } catch (err) {
      logger.error({ msg: 'voice:discovery upsert failed', filename, err });
    }
  }

  logger.info({ msg: 'voice:discovery complete', indexed });
  return indexed;
}

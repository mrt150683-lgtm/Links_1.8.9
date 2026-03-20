/**
 * Whisper STT Adapter — Local whisper.cpp binary
 *
 * Transcribes audio using a local whisper-cli binary (whisper.cpp).
 * Accepts WAV audio (16kHz mono 16-bit PCM), writes to a temp file,
 * runs whisper-cli, reads the .txt output, then cleans up.
 *
 * Binary resolution order:
 *   1. WHISPER_BIN environment variable
 *   2. {cwd}/whisper/whisper-cli.exe  (Windows)
 *   3. {cwd}/whisper/whisper-cli      (Linux/macOS)
 *   4. {cwd}/whisper/main.exe         (older whisper.cpp builds)
 *   5. {cwd}/whisper/main
 *   6. "whisper-cli" on system PATH (fallback)
 *
 * Model resolution order:
 *   1. WHISPER_MODEL environment variable
 *   2. {cwd}/whisper/ggml-base.en.bin
 *   3. {cwd}/whisper/ggml-small.en.bin
 *   4. {cwd}/whisper/ggml-tiny.en.bin
 *   5. Any *.bin in {cwd}/whisper/
 */

import { spawn } from 'child_process';
import { existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createLogger } from '@links/logging';
import type { STTAdapter } from './sttAdapter.js';
import type { STTResult } from '../types.js';

const logger = createLogger({ name: 'voice:stt:whisper' });

function findWhisperBinary(): string {
  if (process.env['WHISPER_BIN']) return process.env['WHISPER_BIN'];

  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'whisper', 'whisper-cli.exe'),
    join(cwd, 'whisper', 'whisper-cli'),
    join(cwd, 'whisper', 'main.exe'),
    join(cwd, 'whisper', 'main'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  return 'whisper-cli'; // fallback to PATH
}

function findWhisperModel(): string {
  if (process.env['WHISPER_MODEL']) return process.env['WHISPER_MODEL'];

  const cwd = process.cwd();
  const preferred = [
    join(cwd, 'whisper', 'ggml-base.en.bin'),
    join(cwd, 'whisper', 'ggml-small.en.bin'),
    join(cwd, 'whisper', 'ggml-tiny.en.bin'),
    join(cwd, 'whisper', 'ggml-base.bin'),
    join(cwd, 'whisper', 'ggml-tiny.bin'),
  ];
  for (const p of preferred) {
    if (existsSync(p)) return p;
  }

  // Pick any .bin in whisper dir
  const whisperDir = join(cwd, 'whisper');
  if (existsSync(whisperDir)) {
    const bins = readdirSync(whisperDir).filter((f) => f.endsWith('.bin'));
    if (bins.length > 0) return join(whisperDir, bins[0]!);
  }

  return '';
}

export class WhisperSTTAdapter implements STTAdapter {
  private readonly whisperBin: string;
  private readonly modelPath: string;
  private readonly modelReady: boolean;

  constructor() {
    this.whisperBin = findWhisperBinary();
    this.modelPath = findWhisperModel();
    this.modelReady = !!(this.modelPath && existsSync(this.modelPath));

    logger.info(
      { whisperBin: this.whisperBin, modelPath: this.modelPath, modelReady: this.modelReady },
      'whisper: initialized',
    );
  }

  /** Streaming not supported — REST-style transcription only. */
  async transcribeChunk(_chunk: Buffer, _mimeType?: string): Promise<STTResult | null> {
    return null;
  }

  async transcribeFinal(audio: Buffer, _mimeType = 'audio/wav'): Promise<STTResult> {
    const start = Date.now();

    if (!this.modelReady) {
      logger.warn(
        { modelPath: this.modelPath },
        'whisper: model not found — download ggml-base.en.bin to the whisper/ directory',
      );
      throw new Error('Whisper model not found. Download ggml-base.en.bin to the whisper/ directory.');
    }

    // Write audio to a temp WAV file
    const id = randomBytes(8).toString('hex');
    const tmpWav = join(tmpdir(), `whisper_${id}.wav`);
    const tmpOutBase = join(tmpdir(), `whisper_${id}_out`);
    const tmpOutTxt = `${tmpOutBase}.txt`;

    try {
      writeFileSync(tmpWav, audio);

      const text = await new Promise<string>((resolve, reject) => {
        const args = [
          '-m', this.modelPath,
          '-l', 'en',           // language: English
          '-nt',                 // no timestamps in output
          '-otxt',               // write plain text output
          '-of', tmpOutBase,     // output file prefix (creates tmpOutBase.txt)
          '-np',                 // no prints (suppress progress/info to stderr)
          '-t', '4',             // 4 threads
          tmpWav,                // positional: input audio file
        ];

        logger.info({ bytes: audio.length, model: this.modelPath }, 'whisper: transcribing');

        const proc = spawn(this.whisperBin, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        const errChunks: Buffer[] = [];
        proc.stderr.on('data', (c: Buffer) => errChunks.push(c));

        proc.on('error', (err) => {
          logger.error({ err }, 'whisper: spawn error — is whisper-cli installed in the whisper/ directory?');
          reject(err);
        });

        proc.on('close', (code) => {
          const latency_ms = Date.now() - start;
          const stderr = Buffer.concat(errChunks).toString().slice(0, 400);

          if (code !== 0) {
            logger.warn({ code, stderr, latency_ms }, 'whisper: exited non-zero');
          }

          if (existsSync(tmpOutTxt)) {
            const raw = readFileSync(tmpOutTxt, 'utf-8');
            // Strip any remaining [BLANK_AUDIO] markers and whitespace
            const cleaned = raw
              .replace(/\[BLANK_AUDIO\]/gi, '')
              .replace(/\[.*?\]/g, '')  // strip any [timestamp] markers
              .replace(/\s+/g, ' ')
              .trim();

            logger.info({ text_len: cleaned.length, latency_ms }, 'whisper: transcription complete');
            resolve(cleaned);
          } else {
            logger.warn({ code, stderr, outFile: tmpOutTxt }, 'whisper: output file not found');
            resolve('');
          }
        });
      });

      return { text, is_final: true, latency_ms: Date.now() - start };

    } catch (err) {
      logger.error({ err }, 'whisper: transcription failed');
      throw err;
    } finally {
      // Cleanup temp files
      try { rmSync(tmpWav, { force: true }); } catch { /* ignore */ }
      try { rmSync(tmpOutTxt, { force: true }); } catch { /* ignore */ }
    }
  }

  reset(): void {
    // Stateless
  }
}

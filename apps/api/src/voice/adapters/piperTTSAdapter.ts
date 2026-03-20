/**
 * Piper TTS Adapter — Phase E
 *
 * Synthesizes text to speech using the Piper binary.
 * Piper reads text from stdin and writes a WAV file.
 *
 * On Windows, stdout piping corrupts binary data (text-mode \n → \r\n),
 * so we write to a temp file instead of using --output_file -.
 *
 * Binary resolution order:
 *   1. PIPER_BIN environment variable (explicit path)
 *   2. {cwd}/piper/piper.exe  (Windows, next to app)
 *   3. {cwd}/piper/piper      (Linux/macOS)
 *   4. "piper" on system PATH (fallback)
 *
 * If no binary is found or synthesis fails, returns audio_buffer: undefined
 * so the browser falls back to Web Speech API. Failures are non-fatal.
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { createLogger } from '@links/logging';
import type { TTSAdapter } from './ttsAdapter.js';
import type { TTSResult } from '../types.js';

const logger = createLogger({ name: 'voice:piper-tts' });

function findPiperBinary(): string {
  if (process.env['PIPER_BIN']) return process.env['PIPER_BIN'];

  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'piper', 'piper.exe'),
    join(cwd, 'piper', 'piper'),
    join(cwd, 'piper.exe'),
    join(cwd, 'piper'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Fall back to system PATH
  return 'piper';
}

export class PiperTTSAdapter implements TTSAdapter {
  private voiceId = '';
  private voicePath = '';
  private piperBin = '';
  private configured = false;

  configure(voiceId: string, voicePath: string): void {
    this.voiceId = voiceId;
    this.voicePath = voicePath;
    this.piperBin = findPiperBinary();
    this.configured = !!(voicePath && this.piperBin);
    logger.info(
      { voiceId, voicePath, piperBin: this.piperBin, configured: this.configured },
      'piper: configured',
    );
  }

  isReady(): boolean {
    return this.configured && existsSync(this.voicePath);
  }

  async synthesize(text: string): Promise<TTSResult> {
    const start = Date.now();

    if (!this.isReady()) {
      logger.warn({ configured: this.configured, voicePath: this.voicePath }, 'piper: not ready');
      return { audio_buffer: undefined, latency_ms: 0, voice_id: this.voiceId };
    }

    // Sanitize text for spoken output: strip markdown, collapse whitespace
    const spokenText = text
      .replace(/[#*`_~\[\]()>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!spokenText) {
      return { audio_buffer: undefined, latency_ms: 0, voice_id: this.voiceId };
    }

    // Write to a temp file — piping binary WAV through stdout on Windows
    // corrupts data due to text-mode \n → \r\n translation
    const id = randomBytes(8).toString('hex');
    const tmpOutWav = join(tmpdir(), `piper_${id}.wav`);

    logger.info(
      { text_len: spokenText.length, model: this.voicePath, tmpOutWav },
      'piper: synthesizing',
    );

    try {
      const audioBuffer = await new Promise<Buffer | undefined>((resolve) => {
        // cwd must be the piper binary directory so espeak-ng-data is found
        const piperCwd = dirname(this.piperBin);
        const proc = spawn(
          this.piperBin,
          [
            '--model', this.voicePath,
            '--output_file', tmpOutWav,
            '--length_scale', '1.15',  // slightly slower than default — more natural pace
            '--sentence_silence', '0.1', // short pause between sentences (we split ourselves)
            '--quiet',
          ],
          { stdio: ['pipe', 'pipe', 'pipe'], cwd: piperCwd },
        );

        const errChunks: Buffer[] = [];
        proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

        proc.on('error', (err) => {
          logger.warn({ err }, 'piper: spawn error (binary not found?)');
          resolve(undefined);
        });

        proc.on('close', (code) => {
          if (code !== 0) {
            const stderr = Buffer.concat(errChunks).toString().slice(0, 300);
            logger.warn({ code, stderr }, 'piper: process exited non-zero');
            resolve(undefined);
            return;
          }

          if (!existsSync(tmpOutWav)) {
            logger.warn({ tmpOutWav }, 'piper: output file not found after exit');
            resolve(undefined);
            return;
          }

          const buf = readFileSync(tmpOutWav);
          if (buf.length < 44) {
            logger.warn({ bytes: buf.length }, 'piper: output too small');
            resolve(undefined);
            return;
          }

          logger.info({ bytes: buf.length, latency_ms: Date.now() - start }, 'piper: synthesis complete');
          resolve(buf);
        });

        // Write text to stdin and close
        proc.stdin.write(spokenText, 'utf-8');
        proc.stdin.end();
      });

      return { audio_buffer: audioBuffer, latency_ms: Date.now() - start, voice_id: this.voiceId };

    } catch (err) {
      logger.error({ err }, 'piper: unexpected error');
      return { audio_buffer: undefined, latency_ms: Date.now() - start, voice_id: this.voiceId };
    } finally {
      // Cleanup temp file
      try { rmSync(tmpOutWav, { force: true }); } catch { /* ignore */ }
    }
  }
}

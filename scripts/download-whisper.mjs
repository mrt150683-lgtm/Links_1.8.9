/**
 * Download whisper.cpp binary + ggml-base.en model for local STT.
 *
 * Usage:
 *   node scripts/download-whisper.mjs
 *
 * Downloads to:
 *   whisper/whisper-cli.exe     (binary)
 *   whisper/ggml-base.en.bin   (model, ~142 MB)
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const whisperDir = join(repoRoot, 'whisper');

mkdirSync(whisperDir, { recursive: true });

// ── File definitions ─────────────────────────────────────────────────────────

const WHISPER_RELEASE_URL =
  'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.4/whisper-cli-windows-x64.zip';

const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';

// ── Helpers ──────────────────────────────────────────────────────────────────

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    if (existsSync(destPath)) {
      console.log(`  ✓ Already exists: ${destPath}`);
      resolve();
      return;
    }

    const tmp = destPath + '.tmp';
    const file = createWriteStream(tmp);
    let totalBytes = 0;
    let downloadedBytes = 0;
    let lastPct = -1;

    const request = (u, redirectCount = 0) => {
      const mod = u.startsWith('https') ? https : http;
      mod.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303 || res.statusCode === 307 || res.statusCode === 308) {
          if (redirectCount > 10) { reject(new Error('Too many redirects')); return; }
          request(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.floor((downloadedBytes / totalBytes) * 100);
            if (pct !== lastPct && pct % 10 === 0) {
              process.stdout.write(`\r  Downloading... ${pct}%`);
              lastPct = pct;
            }
          }
        });
        res.pipe(file);
        res.on('end', () => {
          file.close(() => {
            console.log('');
            renameSync(tmp, destPath);
            resolve();
          });
        });
      }).on('error', (err) => {
        try { unlinkSync(tmp); } catch {}
        reject(err);
      });
    };

    request(url);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

const whisperExe = join(whisperDir, 'whisper-cli.exe');
const modelBin = join(whisperDir, 'ggml-base.en.bin');

console.log('\n=== Whisper STT Setup ===\n');
console.log(`Target directory: ${whisperDir}\n`);

// Step 1: Download binary zip
console.log('Step 1: Downloading whisper-cli.exe...');
const zipPath = join(whisperDir, 'whisper-cli-windows.zip');

if (existsSync(whisperExe)) {
  console.log('  ✓ whisper-cli.exe already present — skipping');
} else {
  try {
    await download(WHISPER_RELEASE_URL, zipPath);
    console.log('  Downloaded zip. Extracting...');

    // Extract using PowerShell (built-in on Windows)
    const { execSync } = await import('child_process');
    execSync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${whisperDir}' -Force"`,
      { stdio: 'inherit' }
    );

    // The zip might extract whisper-cli.exe directly or in a subdirectory
    // Try to find it
    const { readdirSync, statSync } = await import('fs');
    function findExe(dir, name, depth = 0) {
      if (depth > 3) return null;
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        if (f.toLowerCase() === name.toLowerCase()) return full;
        try {
          if (statSync(full).isDirectory()) {
            const found = findExe(full, name, depth + 1);
            if (found) return found;
          }
        } catch {}
      }
      return null;
    }

    const foundExe = findExe(whisperDir, 'whisper-cli.exe');
    if (foundExe && foundExe !== whisperExe) {
      renameSync(foundExe, whisperExe);
    }

    // Cleanup zip
    try { unlinkSync(zipPath); } catch {}

    if (existsSync(whisperExe)) {
      console.log('  ✓ whisper-cli.exe extracted successfully');
    } else {
      console.warn('  ⚠ whisper-cli.exe not found after extraction');
      console.warn('  Please manually download whisper-cli.exe from:');
      console.warn('  https://github.com/ggerganov/whisper.cpp/releases');
      console.warn(`  And place it in: ${whisperDir}`);
    }
  } catch (err) {
    console.error('  ✗ Failed to download/extract binary:', err.message);
    console.log('\n  Please manually download whisper-cli.exe from:');
    console.log('  https://github.com/ggerganov/whisper.cpp/releases');
    console.log(`  And place it in: ${whisperDir}`);
    console.log('  Then re-run this script to download the model.\n');
  }
}

// Step 2: Download model
console.log('\nStep 2: Downloading ggml-base.en.bin (~142 MB)...');
try {
  await download(MODEL_URL, modelBin);
  if (existsSync(modelBin)) {
    console.log('  ✓ ggml-base.en.bin downloaded');
  }
} catch (err) {
  console.error('  ✗ Failed to download model:', err.message);
  console.log('\n  Please manually download ggml-base.en.bin from:');
  console.log('  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin');
  console.log(`  And place it in: ${whisperDir}`);
}

// Summary
console.log('\n=== Summary ===');
console.log(`  Binary:  ${existsSync(whisperExe) ? '✓' : '✗ MISSING'} ${whisperExe}`);
console.log(`  Model:   ${existsSync(modelBin) ? '✓' : '✗ MISSING'} ${modelBin}`);

if (existsSync(whisperExe) && existsSync(modelBin)) {
  console.log('\n  ✓ Whisper STT ready! Rebuild the installer to include these files.\n');
} else {
  console.log('\n  ⚠ Some files are missing. See above for manual download instructions.\n');
}

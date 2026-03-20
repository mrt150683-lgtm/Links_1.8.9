import { createWriteStream, existsSync, renameSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const whisperDir = join(repoRoot, 'whisper');

const URL = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.3/whisper-bin-x64.zip';
const zipPath = join(whisperDir, 'whisper-bin-x64.zip');
const whisperExe = join(whisperDir, 'whisper-cli.exe');

if (existsSync(whisperExe)) {
  console.log('whisper-cli.exe already present — done.');
  process.exit(0);
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      const code = res.statusCode;
      if (code === 301 || code === 302 || code === 303 || code === 307 || code === 308) {
        if (redirects > 10) { reject(new Error('Too many redirects')); return; }
        download(res.headers.location, dest, redirects + 1).then(resolve).catch(reject);
        return;
      }
      if (code !== 200) { reject(new Error('HTTP ' + code + ' for ' + url)); return; }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      let lastPct = -1;
      const file = createWriteStream(dest);
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) {
          const pct = Math.floor(downloaded / total * 100);
          if (pct !== lastPct && pct % 5 === 0) { process.stdout.write('\r  ' + pct + '%'); lastPct = pct; }
        }
      });
      res.pipe(file);
      file.on('finish', () => { console.log(''); resolve(); });
    }).on('error', reject);
  });
}

console.log('Downloading whisper-bin-x64.zip...');
await download(URL, zipPath);
console.log('Extracting...');
execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${whisperDir}' -Force"`, { stdio: 'inherit' });
try { unlinkSync(zipPath); } catch {}

// Find whisper-cli.exe anywhere in the extracted files
function findFile(dir, name, depth = 0) {
  if (depth > 4) return null;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (f.toLowerCase() === name.toLowerCase()) return full;
    try { if (statSync(full).isDirectory()) { const r = findFile(full, name, depth + 1); if (r) return r; } } catch {}
  }
  return null;
}

const found = findFile(whisperDir, 'whisper-cli.exe') || findFile(whisperDir, 'main.exe');
if (found && found !== whisperExe) {
  renameSync(found, whisperExe);
  console.log('Moved to:', whisperExe);
} else if (found === whisperExe) {
  console.log('Binary in place:', whisperExe);
}

if (existsSync(whisperExe)) {
  console.log('SUCCESS: whisper-cli.exe ready');
} else {
  console.error('FAILED: could not find whisper-cli.exe after extraction');
  console.log('Files in whisper dir:', readdirSync(whisperDir));
}

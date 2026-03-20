import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const piperDir = join(repoRoot, 'piper');
const piperExe = join(piperDir, 'piper.exe');
const zipPath = join(piperDir, 'piper_windows_amd64.zip');

const URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

if (existsSync(piperExe)) {
  console.log('piper.exe already present — done.');
  process.exit(0);
}

mkdirSync(piperDir, { recursive: true });

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'links-app' } }, (res) => {
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
          if (pct !== lastPct && pct % 10 === 0) { process.stdout.write('\r  ' + pct + '%'); lastPct = pct; }
        }
      });
      res.pipe(file);
      file.on('finish', () => { console.log(''); resolve(); });
    }).on('error', reject);
  });
}

function findFile(dir, name, depth = 0) {
  if (depth > 5) return null;
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (f.toLowerCase() === name.toLowerCase()) return full;
    try {
      if (statSync(full).isDirectory()) {
        const r = findFile(full, name, depth + 1);
        if (r) return r;
      }
    } catch {}
  }
  return null;
}

console.log('Downloading piper_windows_amd64.zip...');
await download(URL, zipPath);
console.log('Extracting...');
execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${piperDir}' -Force"`, { stdio: 'inherit' });
try { unlinkSync(zipPath); } catch {}

// Find piper.exe in the extracted structure and move it to piper root
const found = findFile(piperDir, 'piper.exe');
if (found && found !== piperExe) {
  // Also move all DLLs and supporting files from its directory to piper root
  const foundDir = dirname(found);
  if (foundDir !== piperDir) {
    for (const f of readdirSync(foundDir)) {
      const src = join(foundDir, f);
      const dst = join(piperDir, f);
      if (!existsSync(dst)) {
        try { renameSync(src, dst); } catch (e) { console.warn('  Could not move', f, ':', e.message); }
      }
    }
  }
}

if (existsSync(piperExe)) {
  console.log('SUCCESS: piper.exe ready at', piperExe);
  console.log('Files:', readdirSync(piperDir).join(', '));
} else {
  console.error('FAILED: piper.exe not found after extraction');
  console.log('Files in piper dir:', readdirSync(piperDir));
  process.exit(1);
}

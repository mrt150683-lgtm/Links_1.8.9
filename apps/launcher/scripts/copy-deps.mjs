/**
 * Bundles the API with esbuild (single CJS file) and copies the built web UI
 * into the launcher directory so electron-builder can bundle them into the EXE.
 *
 * better-sqlite3 is marked external — electron-builder installs it as a real
 * dependency and rebuilds the native .node file for Electron automatically.
 *
 * import.meta.url is polyfilled so migration/prompt/config path resolution
 * works at runtime from the bundle's location.
 */
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { buildSync } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const launcherRoot = join(__dirname, '..');
const repoRoot = join(launcherRoot, '..', '..');

// ── 1. Copy web dist ────────────────────────────────────────────────────────
const webSrc = join(repoRoot, 'apps', 'web', 'dist');
const webDest = join(launcherRoot, 'web-dist');

if (!existsSync(webSrc)) {
  console.error(`Missing: ${webSrc}  — run pnpm --filter @links/web build first`);
  process.exit(1);
}
if (existsSync(webDest)) rmSync(webDest, { recursive: true });
cpSync(webSrc, webDest, { recursive: true });
console.log(`✓ Copied web dist → web-dist`);

// ── 1b. Copy prompts to resources ───────────────────────────────────────────
const promptsSrc = join(repoRoot, 'packages', 'ai', 'prompts');
const promptsDest = join(launcherRoot, 'resources', 'prompts');

if (existsSync(promptsSrc)) {
  if (existsSync(promptsDest)) rmSync(promptsDest, { recursive: true });
  // Ensure parent dir exists
  if (!existsSync(dirname(promptsDest))) mkdirSync(dirname(promptsDest), { recursive: true });
  cpSync(promptsSrc, promptsDest, { recursive: true });
  console.log(`✓ Copied prompts → resources/prompts`);
} else {
  console.warn(`⚠ Missing prompts source: ${promptsSrc}`);
}

// ── 2. Bundle API with esbuild into a single CJS file ───────────────────────
// The banner injects an import.meta.url polyfill so that packages that use
// import.meta.url to derive __dirname (migrations.ts, prompt-loader.ts, etc.)
// resolve paths relative to the bundle file's location at runtime.
const apiDist = join(launcherRoot, 'api-dist');
if (existsSync(apiDist)) rmSync(apiDist, { recursive: true });
mkdirSync(apiDist, { recursive: true });

const apiEntry = join(repoRoot, 'apps', 'api', 'src', 'index.ts');
const bundleOut = join(apiDist, 'bundle.cjs');

if (!existsSync(apiEntry)) {
  console.error(`Missing: ${apiEntry}`);
  process.exit(1);
}

const banner = [
  // Polyfill import.meta.url for CJS bundle
  `var __importMetaUrl=require('url').pathToFileURL(__filename).href;`,
  // Electron utility process may not honour NODE_PATH, and even if it does,
  // Node's parent-directory traversal can find a non-Electron-rebuilt copy
  // in the workspace node_modules first.  Hook _resolveFilename so that
  // NODE_PATH wins for better-sqlite3 (the only external native module).
  `(function(){`,
  `var M=require('module'),P=require('path'),F=require('fs'),orig=M._resolveFilename;`,
  `M._resolveFilename=function(req,par,isMain,opts){`,
  `if(req==='better-sqlite3'&&process.env.NODE_PATH){`,
  `var dirs=process.env.NODE_PATH.split(P.delimiter);`,
  `for(var i=0;i<dirs.length;i++){var c=P.join(dirs[i],req);`,
  `if(F.existsSync(c))return orig.call(this,c,par,isMain,opts);}`,
  `}return orig.call(this,req,par,isMain,opts);};`,
  `})();`,
].join('');

console.log('Bundling API with esbuild...');
try {
  buildSync({
    entryPoints: [apiEntry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: bundleOut,
    external: ['better-sqlite3'],
    banner: { js: banner },
    define: { 'import.meta.url': '__importMetaUrl' },
  });
  console.log(`✓ API bundled → api-dist/bundle.cjs`);
} catch (e) {
  console.error('API Bundle Failed:', e);
  process.exit(1);
}

// ── 3. Bundle Worker with esbuild into a single CJS file ──────────────────────
const workerDist = join(launcherRoot, 'worker-dist');
if (existsSync(workerDist)) rmSync(workerDist, { recursive: true });
mkdirSync(workerDist, { recursive: true });

const workerEntry = join(repoRoot, 'apps', 'worker', 'src', 'index.ts');
const workerBundleOut = join(workerDist, 'bundle.cjs');

if (!existsSync(workerEntry)) {
  console.error(`Missing: ${workerEntry}`);
  process.exit(1);
}

console.log('Bundling Worker with esbuild...');
try {
  buildSync({
    entryPoints: [workerEntry],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: workerBundleOut,
    external: ['better-sqlite3'],
    banner: { js: banner },
    define: { 'import.meta.url': '__importMetaUrl' },
  });
  console.log(`✓ Worker bundled → worker-dist/bundle.cjs`);
} catch (e) {
  console.error('Worker Bundle Failed:', e);
  process.exit(1);
}

// ── 4. Rebuild better-sqlite3 for Electron ──────────────────────────────────
// In a pnpm monorepo, electron-builder's @electron/rebuild may not correctly
// replace the symlinked native .node file from the store.  We explicitly
// rebuild here so the .node binary matches Electron's NODE_MODULE_VERSION.
console.log('Rebuilding native modules for Electron...');
execSync(
  `npx electron-builder install-app-deps`,
  { cwd: launcherRoot, stdio: 'inherit' },
);
console.log(`✓ Native modules rebuilt for Electron`);

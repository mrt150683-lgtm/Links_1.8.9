/**
 * Generates extension icons from logo_links.png using sharp.
 * Run: node scripts/generate-icons.mjs
 * (sharp is a devDependency — run pnpm install first)
 */

import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const sharp = require('sharp');
const sourceLogo = resolve(__dirname, '../../web/src/assets/icons/logo_links.png');
const outputDir = resolve(__dirname, '../icons');

const sizes = [16, 48, 128];

for (const size of sizes) {
  const output = resolve(outputDir, `icon${size}.png`);
  await sharp(sourceLogo)
    .resize(size, size, { fit: 'contain', background: { r: 16, g: 20, b: 26, alpha: 1 } })
    .png()
    .toFile(output);
  console.log(`Generated icon${size}.png`);
}

console.log('Done. Run pnpm build to copy icons into dist/.');

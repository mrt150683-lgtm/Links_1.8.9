#!/usr/bin/env node
/**
 * Build license generator tools as standalone EXEs
 * Uses esbuild to bundle, then pkg to create EXE
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundleDir = join(__dirname, 'bundle');

console.log('Building license generator executables...\n');

// Step 1: Create bundles with esbuild
console.log('1. Bundling TypeScript with esbuild...');
mkdirSync(bundleDir, { recursive: true });

const bundles = [
  {
    name: 'links-keygen.exe',
    entry: 'src/generate-keypair.ts',
    outfile: join(bundleDir, 'keygen.mjs'),
  },
  {
    name: 'links-signer.exe',
    entry: 'src/sign-license.ts',
    outfile: join(bundleDir, 'signer.mjs'),
  },
];

for (const bundle of bundles) {
  console.log(`   Bundling ${bundle.name}...`);
  try {
    // Use CJS format for better pkg compatibility
    const cjsOutfile = bundle.outfile.replace('.mjs', '.cjs');
    execSync(
      `npx esbuild ${join(__dirname, bundle.entry)} --bundle --platform=node --format=cjs --external:fs --external:crypto --outfile=${cjsOutfile}`,
      {
        cwd: __dirname,
        stdio: 'inherit',
      }
    );
    // Update bundle to use cjs
    bundle.outfile = cjsOutfile;
  } catch (err) {
    console.error(`Failed to bundle ${bundle.name}:`, err.message);
    process.exit(1);
  }
}

// Step 2: Build EXEs with pkg
console.log('\n2. Building EXEs with pkg...');

for (const bundle of bundles) {
  console.log(`   Building ${bundle.name}...`);
  try {
    execSync(
      `npx pkg ${bundle.outfile} --targets node18-win-x64 --output ${join(__dirname, bundle.name)}`,
      {
        cwd: __dirname,
        stdio: 'inherit',
      }
    );
  } catch (err) {
    console.error(`Failed to build ${bundle.name}:`, err.message);
    process.exit(1);
  }
}

console.log('\n✓ Build complete!');
console.log('\nGenerated files:');
bundles.forEach((b) => {
  console.log(`  - ${b.name}`);
});
console.log('\nUsage:');
console.log('  links-keygen.exe                         # Generate keypair');
console.log('  links-signer.exe --help                  # Show signing options');

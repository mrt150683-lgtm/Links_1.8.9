#!/usr/bin/env node
/**
 * SIMPLE BUILD SCRIPT - Creates links-keygen.exe
 *
 * No complex bundling, just:
 * 1. Compile keygen-standalone.ts to JS
 * 2. Create EXE with pkg
 */

import { execSync } from 'child_process';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('Building links-keygen.exe...\n');

try {
  // Step 1: Compile TypeScript
  console.log('Compiling TypeScript...');
  execSync('npx tsc src/keygen-standalone.ts --outDir dist --target ES2020 --module commonjs', {
    cwd: __dirname,
    stdio: 'inherit',
  });

  // Step 2: Build EXE with pkg
  console.log('\nBuilding EXE...');
  execSync(
    `npx pkg dist/keygen-standalone.js --targets node18-win-x64 --output links-keygen.exe`,
    {
      cwd: __dirname,
      stdio: 'inherit',
    }
  );

  console.log('\n✓ SUCCESS!');
  console.log('\nGenerated: links-keygen.exe');
  console.log('\nRun it:');
  console.log('  links-keygen.exe');
  console.log('\nNo Node.js required!');

} catch (error) {
  console.error('\n✗ Build failed:', error.message);
  process.exit(1);
}

/**
 * electron-builder afterPack hook.
 *
 * In a pnpm monorepo, @electron/rebuild doesn't follow workspace symlinks
 * correctly, so the native .node file for better-sqlite3 keeps the NMV
 * compiled for Node instead of Electron.
 *
 * This hook runs AFTER files are copied to the output dir but BEFORE
 * the portable/installer is created. It downloads the correct prebuilt
 * binary for Electron's ABI version directly into the output directory.
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
    const logFile = path.join(context.appOutDir, '..', 'after-pack.log');
    const log = (msg) => fs.appendFileSync(logFile, msg + '\n');

    log(`[afterPack] Starting hook for ${context.arch}`);
    log(`[afterPack] appOutDir: ${context.appOutDir}`);

    const appDir = path.join(context.appOutDir, 'resources', 'app');
    const bsqlDir = path.join(appDir, 'node_modules', 'better-sqlite3');

    log(`[afterPack] Checking bsqlDir: ${bsqlDir}`);

    if (!fs.existsSync(bsqlDir)) {
        log('[afterPack] better-sqlite3 not found in output dir, skipping');
        console.log('[afterPack] better-sqlite3 not found in output dir, skipping');
        return;
    }

    // electron-builder gives us the electron version via context
    const ev = context.packager.config.electronVersion ||
        require(path.join(context.packager.appDir, 'node_modules', 'electron', 'package.json')).version;

    console.log(`[afterPack] Rebuilding better-sqlite3 for Electron ${ev} (arch: ${context.arch})...`);

    try {
        // Try prebuild-install first (downloads pre-compiled binary)
        execSync(
            `npx -y prebuild-install -r electron -t ${ev} --arch x64 --platform win32 --tag-prefix v`,
            { cwd: bsqlDir, stdio: 'inherit' }
        );
        console.log('[afterPack] ✓ better-sqlite3 prebuilt downloaded for Electron');
    } catch (_err1) {
        console.log('[afterPack] Prebuilt not available, building from source...');
        // Fall back to node-gyp rebuild
        execSync(
            `npx -y node-gyp rebuild --runtime=electron --target=${ev} --arch=x64 --dist-url=https://electronjs.org/headers`,
            { cwd: bsqlDir, stdio: 'inherit' }
        );
        console.log('[afterPack] ✓ better-sqlite3 compiled from source for Electron');
    }

    // Verify the .node file was updated
    const nodeFile = path.join(bsqlDir, 'build', 'Release', 'better_sqlite3.node');
    if (fs.existsSync(nodeFile)) {
        const stat = fs.statSync(nodeFile);
        console.log(`[afterPack] .node file: ${stat.size} bytes, modified: ${stat.mtime.toISOString()}`);
    }
};

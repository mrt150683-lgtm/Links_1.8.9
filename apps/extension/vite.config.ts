import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Plugin to copy manifest.json and icons into dist after build
function copyExtensionAssets() {
  return {
    name: 'copy-extension-assets',
    closeBundle() {
      // Copy manifest
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json'),
      );

      // Copy icons
      const iconsDir = resolve(__dirname, 'dist/icons');
      if (!existsSync(iconsDir)) mkdirSync(iconsDir, { recursive: true });

      for (const icon of ['icon16.png', 'icon48.png', 'icon128.png']) {
        const src = resolve(__dirname, 'icons', icon);
        if (existsSync(src)) {
          copyFileSync(src, resolve(iconsDir, icon));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionAssets()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Background and content scripts
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        // HTML entry points at root level so they output to dist/popup/ and dist/options/
        popup: resolve(__dirname, 'popup/index.html'),
        options: resolve(__dirname, 'options/index.html'),
      },
      output: {
        format: 'es',
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'background') return 'background/index.js';
          if (chunkInfo.name === 'content') return 'content/index.js';
          return '[name]/[name].js';
        },
        chunkFileNames: 'shared/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
    // Disable module preload polyfill — background service worker has no document
    modulePreload: { polyfill: false },
  },
});

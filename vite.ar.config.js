import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname, 'ar'),
  base: './',
  publicDir: resolve(import.meta.dirname, 'public/ar'),
  server: { fs: { allow: [import.meta.dirname] } },
  build: { outDir: resolve(import.meta.dirname, 'dist-ar'), emptyOutDir: true, chunkSizeWarningLimit: 1600, rollupOptions: { input: { index: resolve(import.meta.dirname, 'ar/index.html'), walk: resolve(import.meta.dirname, 'ar/walk.html') } } },
});

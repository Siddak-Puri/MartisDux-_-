import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built site works from any static host or sub-path.
  base: './',
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});

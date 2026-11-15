import { defineConfig } from 'vite';
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

function offlineManifest() {
  return {
    name: 'martisdux-offline-manifest',
    apply: 'build',
    writeBundle({ dir: root }) {
      const files = [], hash = createHash('sha256');
      const walk = dir => readdirSync(dir).forEach(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return walk(path);
        const rel = relative(root, path).split(sep).join('/');
        if (rel === 'sw.js' || rel === 'precache.json') return;
        files.push(rel); hash.update(rel).update(readFileSync(path));
      });
      walk(root);
      files.sort();
      const version = hash.digest('hex').slice(0, 12);
      writeFileSync(join(root, 'precache.json'), JSON.stringify({ version, files }));
      const sw = join(root, 'sw.js');
      writeFileSync(sw, readFileSync(sw, 'utf8').replace("const VERSION = 'martisdux-dev';", `const VERSION = 'martisdux-${version}';`));
    },
  };
}

export default defineConfig({
  base: './',
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium/') },
  server: { port: 5173, strictPort: false },
  build: { chunkSizeWarningLimit: 1600, rollupOptions: { input: { main: 'index.html', ar: 'ar/index.html', walk: 'ar/walk.html' } } },
  plugins: [
    { name: 'knockout-global-without-eval', enforce: 'pre', transform(code, id) { if (id.split('\\').join('/').endsWith('/ThirdParty/knockout-3.5.1.js')) return code.replace('this||(0,eval)("this")', 'globalThis'); } },
    offlineManifest(),
  ],
});

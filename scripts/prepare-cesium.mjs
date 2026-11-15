import { cpSync, mkdirSync } from 'node:fs';
const source = new URL('../node_modules/cesium/Build/Cesium/', import.meta.url);
const target = new URL('../public/cesium/', import.meta.url);
mkdirSync(target, { recursive: true });
for (const folder of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
  cpSync(new URL(folder, source), new URL(folder, target), { recursive: true });
}

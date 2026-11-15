import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createTileCache,tileRequest} from './tile-cache.mjs';import {startServer} from './app-server.mjs';
const png=Buffer.from('89504e470d0a1a0a0000000049454e44ae426082','hex');
async function temporary(t){const root=await mkdtemp(path.join(os.tmpdir(),'martisdux-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
test('proxy restricts datasets, zoom, coordinates and path traversal',()=>{
 for(const p of ['/tiles/https://evil.test/0/0/0','/tiles/ctx/99/0/0','/tiles/ctx/0/2/0','/tiles/ctx/0/0/2','/tiles/ctx/0/0/../secret'])assert.equal(tileRequest(p),null);
 assert.match(tileRequest('/tiles/hirise/17/52100/187470').url,/^https:/);
});
test('concurrent downloads deduplicate and a restarted cache uses disk',async t=>{
 const root=await temporary(t);let calls=0;const fetcher=async()=>{calls++;return new Response(png);};const tile=tileRequest('/tiles/ctx/0/0/0');
 const cache=createTileCache({root,bundled:root,fetcher});const [a,b]=await Promise.all([cache.get(tile),cache.get(tile)]);assert.equal(calls,1);assert.deepEqual(a.data,b.data);
 const second=createTileCache({root,bundled:root,fetcher});assert.equal((await second.get(tile)).source,'disk');assert.equal(calls,1);
});
test('bundled imagery is used without any network request',async t=>{
 const root=await temporary(t);await mkdir(path.join(root,'data/jezero-detail/17/52100'),{recursive:true});await writeFile(path.join(root,'data/jezero-detail/17/52100/187470.png'),png);
 const cache=createTileCache({root:path.join(root,'cache'),bundled:root,fetcher:()=>{throw new Error('Must stay offline');}});assert.equal((await cache.get(tileRequest('/tiles/hirise/17/52100/187470'))).source,'bundled');
});
test('transient failures retry; permanent missing tiles are negatively cached',async t=>{
 const root=await temporary(t);let calls=0;const cache=createTileCache({root,bundled:root,fetcher:async()=>++calls===1?new Response('unavailable',{status:503}):new Response(png)});
 await cache.get(tileRequest('/tiles/ctx/0/0/0'));assert.equal(calls,2);assert.equal(cache.stats.retries,1);
 let misses=0;const missing=createTileCache({root,bundled:root,fetcher:async()=>{misses++;return new Response('',{status:404});}});
 for(let i=0;i<2;i++)await assert.rejects(missing.get(tileRequest('/tiles/ctx/0/0/1')));assert.equal(misses,1);
});
test('HTML responses cannot poison the image cache',async t=>{
 const root=await temporary(t);const cache=createTileCache({root,bundled:root,fetcher:async()=>new Response('<html>Error</html>')});await assert.rejects(cache.get(tileRequest('/tiles/ctx/0/0/0')),/Invalid tile/);assert.equal(cache.stats.downloads,0);
});
test('native server protects its origin and serves bundled content',async t=>{
 const root=await temporary(t);await writeFile(path.join(root,'index.html'),'<title>MartisDux</title>');const app=await startServer({root,cacheDir:path.join(root,'cache'),port:0});t.after(()=>new Promise(r=>app.server.close(r)));
 const status=await fetch(app.url+'/api/status').then(r=>r.json());assert.equal(status.cache,'device');assert.equal((await fetch(app.url,{headers:{Origin:'https://evil.test'}})).status,403);
 const r=await fetch(app.url);assert.match(r.headers.get('Content-Security-Policy'),/object-src 'none'/);assert.match(await r.text(),/MartisDux/);
});

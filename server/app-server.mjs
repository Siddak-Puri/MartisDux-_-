import http from 'node:http';
import path from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createTileCache,tileRequest} from './tile-cache.mjs';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.wasm':'application/wasm','.gz':'application/gzip'};
export const defaultCache=path.join(homedir(),process.platform==='darwin'?'Library/Caches/MartisDux/tiles-v1':'.cache/MartisDux/tiles-v1');
export async function startServer({root=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url))),cacheDir=defaultCache,port=4173}={}){
 const cache=createTileCache({root:cacheDir,bundled:root});
 const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;if(!/^127\.0\.0\.1:\d+$/.test(host||'')){res.writeHead(403).end();return;}
  if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403).end();return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return;}
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https:; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-MartisDux','local-cache-v1');
  try{
   const url=new URL(req.url,`http://${host}`);
   if(url.pathname==='/api/status'){res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({service:'MartisDux',cache:'device',...cache.stats}));return;}
   if(url.pathname.startsWith('/tiles/')){
    const tile=tileRequest(url.pathname);if(!tile){res.writeHead(400).end();return;}
    const {data,source}=await cache.get(tile);res.setHeader('Content-Type',tile.id==='elevation'?tile.type:data[0]===0x89?'image/png':'image/jpeg');res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('X-Mars-Cache',source);res.end(req.method==='HEAD'?undefined:data);return;
   }
   const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'index.html';const file=path.resolve(root,relative);
   if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
   const info=await stat(file);if(!info.isFile())throw new Error('Not a file');
   res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
   res.setHeader('Cache-Control',file.endsWith('index.html')||file.endsWith('.json')?'no-cache':'public, max-age=31536000, immutable');
   res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch(e){res.writeHead(e.status===404||e.code==='ENOENT'?404:502,{'Cache-Control':'no-store'}).end('Data unavailable');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,url:`http://127.0.0.1:${server.address().port}`,cache};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))startServer({port:Number(process.env.MARTISDUX_PORT||4173)}).then(({url})=>console.log(`MartisDux device cache: ${url}`)).catch(e=>{console.error(e.message);process.exitCode=1;});

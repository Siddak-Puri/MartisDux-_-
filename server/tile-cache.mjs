import {mkdir,readFile,writeFile,rename,stat,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {DATASETS} from '../src/data.js';
export function tileRequest(pathname){
 const m=/^\/tiles\/(viking|ctx|hirise|themis|mola|geology|elevation)\/(\d+)\/(\d+)\/(\d+)$/.exec(pathname);if(!m)return null;
 const [,id,zs,ys,xs]=m,z=+zs,y=+ys,x=+xs,max=id==='elevation'?7:DATASETS[id].maximumLevel;
 if(z>max||x>=2**(z+1)||y>=2**z)return null;
 const url=id==='elevation'?`https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer/tile/${z}/${y}/${x}`:DATASETS[id].url.replace('{z}',z).replace('{y}',y).replace('{x}',x);
 return {id,z,y,x,key:`${id}/${z}/${y}/${x}`,url,type:id==='elevation'?'application/octet-stream':id==='ctx'||id==='viking'||id==='mola'?'image/jpeg':'image/png'};
}
export function createTileCache({root,bundled,fetcher=fetch,maxBytes=2*1024**3,timeout=8000}){
 const pending=new Map(),missing=new Map();let active=0;const waiting=[];const stats={diskHits:0,bundledHits:0,downloads:0,retries:0,unavailable:0};
 async function acquire(){if(active>=10)await new Promise(r=>waiting.push(r));else active++;}
 function release(){const next=waiting.shift();if(next)next();else active--;}
 async function prune(){try{const files=[];async function walk(p){for(const e of await readdir(p,{withFileTypes:true})){const f=path.join(p,e.name);if(e.isDirectory())await walk(f);else if(!e.name.endsWith('.tmp')){const s=await stat(f);files.push({f,size:s.size,time:s.mtimeMs});}}}await walk(root);let total=files.reduce((a,b)=>a+b.size,0);for(const f of files.sort((a,b)=>a.time-b.time)){if(total<=maxBytes)break;await unlink(f.f).catch(()=>{});total-=f.size;}}catch{}}
 const startup=mkdir(root,{recursive:true}).then(prune);
 function valid(data,id){return id==='elevation'?(data.subarray(0,10).toString().startsWith('Lerc')||data.subarray(0,10).toString().startsWith('CntZImage')):data[0]===0xff&&data[1]===0xd8||data[0]===0x89&&data.subarray(1,4).toString()==='PNG';}
 async function obtain(t){
  await startup;
  const local=t.id==='hirise'?path.join(bundled,`data/jezero-detail/${t.z}/${t.y}/${t.x}.png`):t.id==='elevation'&&t.z===0?path.join(bundled,`terrain/global/0/${t.y}/${t.x}.lerc`):null;
  if(local)try{const data=await readFile(local);if(valid(data,t.id)){stats.bundledHits++;return {data,source:'bundled'};}}catch{}
  const file=path.join(root,t.key);try{const data=await readFile(file);if(valid(data,t.id)){stats.diskHits++;return {data,source:'disk'};}}catch{}
  if((missing.get(t.key)||0)>Date.now())throw Object.assign(new Error('Tile outside available coverage'),{status:404});
  await acquire();try{
   let last;
   for(let attempt=0;attempt<3;attempt++){
    if(attempt){stats.retries++;await new Promise(r=>setTimeout(r,250*2**attempt));}
    try{
     const response=await fetcher(t.url,{signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'MartisDux/0.3 (NASA public planetary data viewer)'}});
     if(response.status===404||response.status===204){missing.set(t.key,Date.now()+300000);throw Object.assign(new Error('No tile at this location'),{status:404});}
     if(!response.ok)throw new Error(`Tile service ${response.status}`);
     const data=Buffer.from(await response.arrayBuffer());if(data.length>8*1024**2||!valid(data,t.id))throw new Error('Invalid tile response');
     await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,data);await rename(temp,file);stats.downloads++;
     if(stats.downloads%256===0)prune();return {data,source:'network'};
    }catch(e){last=e;if(e.status===404)break;}
   }
   stats.unavailable++;throw last;
  }finally{release();}
 }
 return {stats,get(t){if(!pending.has(t.key))pending.set(t.key,obtain(t).finally(()=>pending.delete(t.key)));return pending.get(t.key);}};
}

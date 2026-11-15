import { SingleTileImageryProvider, Rectangle, Credit } from 'cesium';
import {tileUrl} from './tile-access.js';
import { DATASETS,containsPoint } from './data.js';
import { geographicTile,tileBounds } from './terrain-grid.js';
import { distanceBetween } from './surface-navigation.js';

export function createGroundImagery(viewer,mars) {
  const images=new Map();let controller=null,layer=null,centre=null,request=0,loading=false,info=null;
  let local=null;
  const manifest=fetch(`${import.meta.env.BASE_URL}data/jezero-detail/manifest.json`).then(r=>r.ok?r.json():null).then(v=>local=v).catch(()=>{});
  function image(url,signal){
    if(images.has(url))return images.get(url);
    const promise=fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(14000)])}).then(r=>{if(!r.ok)throw new Error('Detail tile unavailable');return r.blob();}).then(blob=>createImageBitmap(blob)).catch(e=>{images.delete(url);throw e;});
    images.set(url,promise);return promise;
  }
  async function load(point,onProgress=()=>{}) {
    loading=true;const token=++request;controller?.abort();controller=new AbortController();const signal=controller.signal;
    await manifest;
    const id=containsPoint(DATASETS.hirise.bounds,point.lon,point.lat)?'hirise':containsPoint(DATASETS.ctx.bounds,point.lon,point.lat)?'ctx':'viking';
    const data=DATASETS[id],level=data.maximumLevel,tile=geographicTile(point,level),radius=id==='hirise'?4:1,size=radius*2+1;
    const nx=2**(level+1),ny=2**level;
    const x0=Math.max(0,Math.min(nx-size,tile.x-radius)),y0=Math.max(0,Math.min(ny-size,tile.y-radius));
    const jobs=[];for(let y=y0;y<Math.min(ny,y0+size);y++)for(let x=x0;x<Math.min(nx,x0+size);x++)jobs.push({x,y});
    const canvas=document.createElement('canvas');canvas.width=size*data.tileSize;canvas.height=size*data.tileSize;
    const context=canvas.getContext('2d');let done=0,loaded=0,next=0;
    try {
      await Promise.all(Array.from({length:Math.min(8,jobs.length)},async()=>{
        while(next<jobs.length&&!signal.aborted){const job=jobs[next++];
          const bundled=id==='hirise'&&local&&job.x>=local.xMin&&job.x<=local.xMax&&job.y>=local.yMin&&job.y<=local.yMax;
          const url=bundled?`${import.meta.env.BASE_URL}data/jezero-detail/${level}/${job.y}/${job.x}.png`:tileUrl(id,job.x,job.y,level,data.url);
          try{const bitmap=await image(url,signal);if(token!==request)return;context.drawImage(bitmap,(job.x-x0)*data.tileSize,(job.y-y0)*data.tileSize);loaded++;}catch(e){if(signal.aborted)return;}
          done++;onProgress(done,jobs.length);
        }
      }));
      if(token!==request||signal.aborted)return;
      if(!loaded)throw new Error('No native image tiles available');
      const west=tileBounds(x0,y0,level),east=tileBounds(x0+size-1,y0+size-1,level);
      const provider=await SingleTileImageryProvider.fromUrl(canvas.toDataURL('image/png'),{rectangle:Rectangle.fromDegrees(west.west,east.south,east.east,west.north),ellipsoid:mars,credit:new Credit(data.credit)});
      if(token!==request||signal.aborted)return;
      const previous=layer;layer=viewer.imageryLayers.addImageryProvider(provider);layer.maximumAnisotropy=16;
      if(previous)viewer.imageryLayers.remove(previous,true);
      centre={...point};info={id,title:data.title,loaded,total:jobs.length,partial:loaded!==jobs.length,mpp:data.sourceMpp};
      viewer.scene.requestRender();
      if(images.size>220)for(const [url,value]of images){if(images.size<=160)break;images.delete(url);value.then(bitmap=>bitmap.close()).catch(()=>{});}
      return info;
    }finally{if(token===request)loading=false;}
  }
  function update(point){if(!loading&&centre&&distanceBetween(centre,point)>(info?.id==='hirise'?220:900))load(point).catch(()=>{});}
  function close(){++request;controller?.abort();loading=false;centre=null;info=null;if(layer){viewer.imageryLayers.remove(layer,true);layer=null;}}
  return {load,update,close,get info(){return info;},get loading(){return loading;}};
}

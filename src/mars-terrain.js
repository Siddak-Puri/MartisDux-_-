import { CustomHeightmapTerrainProvider, GeographicTilingScheme, Credit, HeightmapTerrainData } from 'cesium';
import Lerc from 'lerc';
import { tileUrl } from './tile-access.js';
import { sampleDtm,gridEdgeWeight,coverageDistance,bilinear,geographicTile,tileBounds,decodeHeightBuffer } from './terrain-grid.js';

export const GLOBAL_TERRAIN_URL='https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer';
const TILE_SIZE=65;
const key=(x,y,l)=>`${l}/${y}/${x}`;

export function createMarsTerrain(mars) {
  const cache=new Map(), grids=[];let localError=false,failures=0,fine=[];
  const SITES=[{site:'Jezero',manifest:'terrain/jezero.json'},{site:'Gale',manifest:'terrain/gale.json'}];
  function loadLocal() { return Promise.all(SITES.map(async({site,manifest})=>{
    try {
      const metadata=await fetch(`${import.meta.env.BASE_URL}${manifest}`).then(r=>{if(!r.ok)throw new Error('DTM metadata unavailable');return r.json();});
      const data=await Promise.all(metadata.datasets.map(async info=>{
        const response=await fetch(import.meta.env.BASE_URL+info.url);if(!response.ok)throw new Error('DTM unavailable');
        const values=await decodeHeightBuffer(await response.arrayBuffer(),info.width*info.height);
        const grid={...info,site:info.site||site,values};
        if((info.validFraction??1)<1)grid.coverage=coverageDistance(grid);
        return grid;
      }));grids.push(...data);fine=grids.filter(g=>g.step===1);
    }catch(error){if(site==='Jezero')localError=true;console.warn(`[MartisDux] Local ${site} terrain unavailable.`,error.message);}
  })); }

  async function globalTile(x,y,level) {
    const id=key(x,y,level);if(cache.has(id))return cache.get(id);
    const promise=(async()=>{
      let response;
      try {response=await fetch(level===0?`${import.meta.env.BASE_URL}terrain/global/0/${y}/${x}.lerc`:tileUrl('elevation',x,y,level,`${GLOBAL_TERRAIN_URL}/tile/{z}/{y}/{x}`),{signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error('Terrain service unavailable');}
      catch(error){
        failures++;
        if(level===0)response=await fetch(`${GLOBAL_TERRAIN_URL}/tile/0/${y}/${x}`,{signal:AbortSignal.timeout(7000)});
        else {cache.delete(id);throw error;}
      }
      const decoded=Lerc.decode(await response.arrayBuffer());
      if(decoded.width!==513||decoded.height!==513)throw new Error('Unexpected elevation tile shape');
      const tile={...tileBounds(x,y,level),values:decoded.pixels[0],width:decoded.width,height:decoded.height,level,nodata:decoded.statistics?.[0]?.noDataValue};
      cache.set(id,tile);
      if(cache.size>80){for(const [old,value]of cache){if(!(value instanceof Promise)&&!old.startsWith('0/')){cache.delete(old);break;}}}
      return tile;
    })().catch(e=>{cache.delete(id);throw e;});cache.set(id,promise);return promise;
  }
  let ready;
  function preload() {
    ready ??= Promise.all([
      Promise.all([globalTile(0, 0, 0), globalTile(1, 0, 0)]),
      loadLocal(),
    ]).catch(error => { ready = null; throw error; });
    return ready;
  }
  function cachedGlobal(point,maxLevel=7) {
    point={...point,lon:((point.lon+180)%360+360)%360-180};
    for(let l=maxLevel;l>=0;l--){const t=geographicTile(point,l),tile=cache.get(key(t.x,t.y,l));
      if(!tile||tile instanceof Promise)continue;
      const h=bilinear(tile.values,513,513,(point.lon-tile.west)/(tile.east-tile.west)*512,(tile.north-point.lat)/(tile.north-tile.south)*512,tile.nodata);
      if(h!==null)return {height:h,spacing:200*2**(7-l),level:l};
    }return null;
  }
  function localHeightAt(point){for(const g of fine){const h=sampleDtm(g,point);if(h!==null)return h;}return null;}
  const fullyInside=(g,p)=>sampleDtm(g,p)!==null&&gridEdgeWeight(g,p,100)===1;
  function heightAt(point) {
    for(const g of fine)if(fullyInside(g,point))return sampleDtm(g,point);
    let sample=cachedGlobal(point),height=sample?.height??null;
    for(const grid of grids){const value=sampleDtm(grid,point);if(value===null)continue;
      const alpha=gridEdgeWeight(grid,point,grid.step===1?100:350);
      height=height===null?value:height*(1-alpha)+value*alpha;
    }return height;
  }
  function infoAt(point) {
    for(const grid of [...grids].reverse())if(sampleDtm(grid,point)!==null&&gridEdgeWeight(grid,point,grid.step===1?100:350)>.99)return {title:grid.step===1?`${grid.site} HiRISE DTM · 1 m`:`${grid.site} HiRISE DTM · ${grid.step} m context`,spacing:grid.step,detail:true};
    const g=cachedGlobal(point);return {title:g?.level===7?'HRSC/MOLA DEM · 200 m':g?'Coarse global terrain fallback':'Elevation unavailable',spacing:g?.spacing??null,detail:false};
  }
  async function prepare(point) {
    await preload();
    const local=grids.some(g=>sampleDtm(g,point)!==null);
    const t=geographicTile(point,7);
    if(local)globalTile(t.x,t.y,7).catch(()=>{});
    else try{await globalTile(t.x,t.y,7);}catch{if(!cachedGlobal(point))throw new Error('No elevation data for this position');}
    const height=heightAt(point);if(height===null)throw new Error('Elevation unavailable');return height;
  }
  const tilingScheme=new GeographicTilingScheme({ellipsoid:mars});
  const buildHeights=async(x,y,level)=>{
      await preload();
      const sourceLevel=Math.min(level,7),factor=2**Math.max(0,level-sourceLevel);
      const b=tileBounds(x,y,level);
      const covered=fine.some(g=>[[b.west,b.north],[b.east,b.north],[b.west,b.south],[b.east,b.south]].every(([lon,lat])=>fullyInside(g,{lon,lat})));
      if(!covered)try{await globalTile(Math.floor(x/factor),Math.floor(y/factor),sourceLevel);}catch{}
      const values=new Float32Array(TILE_SIZE*TILE_SIZE);
      for(let row=0;row<TILE_SIZE;row++)for(let col=0;col<TILE_SIZE;col++)values[row*TILE_SIZE+col]=heightAt({lon:b.west+(b.east-b.west)*col/(TILE_SIZE-1),lat:b.north-(b.north-b.south)*row/(TILE_SIZE-1)})??0;
      return values;
    };
  const provider=new CustomHeightmapTerrainProvider({tilingScheme,width:TILE_SIZE,height:TILE_SIZE,callback:buildHeights,credit:new Credit('Terrain: NASA / ESA / USGS · HRSC/MOLA (Esri) / Jezero & Gale HiRISE DTMs')});
  provider.requestTileGeometry=async(x,y,level)=>new HeightmapTerrainData({buffer:await buildHeights(x,y,level),width:TILE_SIZE,height:TILE_SIZE,childTileMask:level<18?15:0});
  return {provider,get ready(){return preload();},prepare,heightAt,localHeightAt,infoAt,get grids(){return grids;},tile:globalTile,get localError(){return localError;},get failures(){return failures;}};
}

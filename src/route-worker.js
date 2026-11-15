import {findTerrainPath} from './terrain-routing.js';
self.onmessage=({data})=>{try{self.postMessage({result:findTerrainPath(data)});}catch(e){self.postMessage({error:e.message});}};

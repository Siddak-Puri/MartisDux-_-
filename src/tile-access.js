let deviceCache=false;
export async function initializeTileAccess(){try{const r=await fetch('/api/status',{signal:AbortSignal.timeout(1500)});deviceCache=r.ok&&(await r.json()).service==='MartisDux';}catch{}return deviceCache;}
export function tileTemplate(id,original){return deviceCache?`${location.origin}/tiles/${id}/{z}/{y}/{x}`:original;}
export function tileUrl(id,x,y,z,original){return tileTemplate(id,original).replace('{z}',z).replace('{y}',y).replace('{x}',x);}
export function hasDeviceCache(){return deviceCache;}

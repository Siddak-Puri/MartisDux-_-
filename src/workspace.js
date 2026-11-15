import { routeDocument, validateRoute } from './route-storage.js';
import { formatRouteDistance } from './route-geometry.js';
const $=id=>document.getElementById(id);
const KEY='martisdux.routes.v1', ACTIVE='martisdux.active-route.v1';
export function createWorkspace({routes,photos,notify,openTerrain,topDown,onMapView}) {
  let saved=[];
  try {saved=JSON.parse(localStorage.getItem(KEY)||'[]').map(validateRoute).slice(0,30);}catch{saved=[];}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(saved));return true;}catch{notify('Device storage unavailable. Export JSON to keep this route.');return false;}}
  function changed(){
    const state=routes.getState(),ready=Boolean(state.distance);
    $('route-save').disabled=!ready;$('route-export').disabled=!ready;$('quick-fit').hidden=!ready;
    try{if(ready)localStorage.setItem(ACTIVE,JSON.stringify(routeDocument(state)));else localStorage.removeItem(ACTIVE);}catch{}
  }
  function restore(item){photos.close({restorePanels:false});routes.restore(item,{frame:true});$('saved-dialog').close();routes.open();routes.fit();}
  function render(){
    const list=$('saved-list');list.replaceChildren();
    if(!saved.length){const p=document.createElement('p');p.className='saved-empty';p.textContent='No saved routes';list.append(p);}
    saved.forEach((item,index)=>{
      const row=document.createElement('div');row.className='saved-route';
      const open=document.createElement('button');open.type='button';const title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=item.name;detail.textContent=`${formatRouteDistance(item.distanceMetres)} · Mars`;open.append(title,detail);open.addEventListener('click',()=>restore(item));
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Delete ${item.name}`);
      remove.addEventListener('click',()=>{const old=saved;saved=saved.filter((_,i)=>i!==index);if(!persist())saved=old;render();});row.append(open,remove);list.append(row);
    });
  }
  $('saved-button').addEventListener('click',()=>{render();$('saved-feedback').textContent='';$('saved-dialog').showModal();});
  $('saved-close').addEventListener('click',()=>$('saved-dialog').close());
  $('saved-dialog').addEventListener('click',e=>{if(e.target===$('saved-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('route-save').addEventListener('click',()=>{
    if(saved.length>=30){notify('30 routes saved. Remove a route or export this one.');return;}
    const item=routeDocument(routes.getState());
    if(saved.some(x=>x.mode===item.mode&&JSON.stringify(x.start)===JSON.stringify(item.start)&&JSON.stringify(x.destination)===JSON.stringify(item.destination))){notify('Route already saved.');return;}
    saved.unshift(item);if(persist())notify('Route saved.');else saved.shift();
  });
  $('route-export').addEventListener('click',()=>{
    const blob=new Blob([JSON.stringify(routeDocument(routes.getState()),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='MartisDux-Mars-route.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Route exported.');
  });
  $('route-import').addEventListener('click',()=>$('route-import-file').click());
  $('route-import-file').addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    try{if(file.size>1_000_000)throw new Error('Route file is too large.');const item=validateRoute(JSON.parse(await file.text()));restore(item);notify('Route imported. Save to keep it in your library.');}
    catch(error){$('saved-feedback').textContent=error instanceof SyntaxError?'Invalid JSON file.':error.message;}finally{e.target.value='';}
  });
  $('quick-pin').addEventListener('click',()=>{photos.close({restorePanels:false});routes.open();routes.arm('start');});
  $('quick-route').addEventListener('click',()=>{photos.close({restorePanels:false});routes.open();if(!routes.getState().start)routes.arm('start');else $('route-destination').focus();});
  $('quick-fit').addEventListener('click',()=>{photos.close({restorePanels:false});topDown(false);routes.fit();});
  $('photos-button').addEventListener('click',()=>{topDown(false);photos.open('jezero');});
  $('terrain-button').addEventListener('click',()=>openTerrain());
  $('jezero-terrain').addEventListener('click',()=>openTerrain({lat:18.4446,lon:77.4509}));
  $('map-view-button').addEventListener('click',onMapView);
  try{const active=JSON.parse(localStorage.getItem(ACTIVE)||'null');if(active)routes.restore(validateRoute(active));}catch{}
  changed();
  return {changed};
}

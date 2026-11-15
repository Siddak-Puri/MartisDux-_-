import {helmetProfile,helmetSurface} from './helmet-profile.js';
import {helmetInstrument} from './helmet-instrument.js';

export function createHelmetProjection(THREE,{profile={},surface={},resolution=1024,viewportWidth,viewportHeight}={}){
 const canvas=document.createElement('canvas'),size=Number.isFinite(resolution)?Math.round(Math.min(2048,Math.max(512,resolution))):1024;
 const screenW=Number.isFinite(viewportWidth)&&viewportWidth>0?viewportWidth:1024;
 const screenH=Number.isFinite(viewportHeight)&&viewportHeight>0?viewportHeight:Math.round(screenW*.64);
 const ratio=Math.min(3,Math.max(.3,screenH/screenW));
 canvas.width=Math.round(size/Math.max(1,ratio));canvas.height=Math.round(canvas.width*ratio);
 const ctx=canvas.getContext('2d');
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.generateMipmaps=false;texture.minFilter=THREE.LinearFilter;
 const {positions,uvs,indices}=helmetSurface(surface);
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uvs,2));geometry.setIndex(new THREE.BufferAttribute(indices,1));
 const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false});
 const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=100;mesh.frustumCulled=false;
 let fit=helmetProfile(profile),previous='';
 const ink='#f1f3ee',dim='#c8ccc6',amber='#ffd497',border='#e4e8df65';
 function update(state){
  const info=helmetInstrument(state),key=JSON.stringify([fit,info]);if(key===previous)return false;previous=key;
  const w=canvas.width,h=canvas.height,unit=w/screenW,cx=screenW/2,cy=h/unit*(.5+fit.offset/100);
  const a=screenW*fit.width/200,b=h/unit*fit.height/200,top=cy-b,bottom=cy+b;
  const font=(n,weight=500)=>`${weight} ${n}px 'Instrument Sans Variable', system-ui, sans-serif`;
  ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.setTransform(unit,0,0,unit,0,0);
  ctx.textBaseline='middle';ctx.lineCap='round';ctx.lineJoin='round';
  const label=(value,x,y,n,{color=ink,weight=500,align='center',max=a*1.9,shadow=false}={})=>{
   ctx.textAlign=align;ctx.font=font(n,weight);ctx.fillStyle=color;
   if(shadow){ctx.shadowColor='#080b0a';ctx.shadowBlur=(fit.contrast?3:2)*unit;ctx.shadowOffsetY=unit;}
   ctx.fillText(value,x,y,max);ctx.shadowBlur=0;ctx.shadowOffsetY=0;
  };
  const line=(x1,y1,x2,y2,color=border,width=1)=>{ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();};
  const plate=(x,y,width,height,fill)=>{ctx.fillStyle=fit.contrast?'#101312':fill;ctx.beginPath();ctx.roundRect(x,y,width,height,3);ctx.fill();};
  const measure=(value,n,weight=500)=>{ctx.font=font(n,weight);return ctx.measureText(value).width;};
  const compact=b*2<360,narrow=a*2<390,headingSize=Math.max(18,Math.min(30,b*.088));
  const headerY=top+Math.max(9,b*.04);
  label('MartisDux',cx-a*.96,headerY,narrow?11:13,{align:'left',weight:650,shadow:true});
  label('Jezero',cx-a*.96,headerY+14,10,{align:'left',color:dim,shadow:true});
  label(info.status,cx+a*.96,a*2<285?top+b*.28:headerY,narrow?10:11,{align:'right',color:state?.mode==='stale'?amber:dim,shadow:true});
  label('Heading',cx,headerY,11,{color:dim,shadow:true});
  const headingY=headerY+headingSize*.72+5;
  label(info.headingLabel,cx,headingY,headingSize,{weight:620,shadow:true});
  if(info.heading!==null){
   const tapeWidth=Math.min(compact?178:236,Math.max(108,a*(compact?.52:.64))),y=headingY+headingSize*.57+12;
   for(const tick of info.ticks){
    const x=cx+(tick.position-.5)*tapeWidth;
    line(x,y+5,x,y+(tick.major?11:8),dim);
    if(tick.label)label(tick.label,x,y,8,{color:dim,shadow:true});
   }
   ctx.fillStyle=ink;ctx.beginPath();ctx.moveTo(cx,y+11);ctx.lineTo(cx-3,y+15);ctx.lineTo(cx+3,y+15);ctx.closePath();ctx.fill();
  }
  const warning=info.level==='steep'||info.level==='caution',hasIcon=info.level!=='low';
  const warningSize=Math.max(12,Math.min(16,b*.05)),detailSize=Math.max(10,Math.min(12,b*.04));
  const warningW=Math.min(a*1.92,Math.max(measure(info.terrain,warningSize,650),measure(info.terrainDetail,detailSize))+20+(hasIcon?21:0));
  const wx=cx-warningW/2,wy=top+b*(compact?.50:.56),wh=info.terrainDetail?37:26;
  plate(wx,wy,warningW,wh,warning?'#211c14e6':'#141918ac');
  line(wx+1,wy+1,wx+1,wy+wh-1,warning?amber:info.level==='unknown'?'#d9c3a0':border,2);
  const color=warning?amber:ink;
  if(hasIcon){
   const ix=wx+15,iy=wy+wh/2;
   ctx.strokeStyle=color;ctx.lineWidth=1.15;ctx.beginPath();ctx.moveTo(ix,iy-6);ctx.lineTo(ix+6,iy+5);ctx.lineTo(ix-6,iy+5);ctx.closePath();ctx.stroke();
   line(ix,iy-2,ix,iy+1,color);line(ix,iy+3,ix+.2,iy+3,color);
  }
  const tx=wx+(hasIcon?31:10),max=warningW-(tx-wx)-9;
  label(info.terrain,tx,wy+(info.terrainDetail?11:13),warningSize,{align:'left',weight:650,color,max});
  if(info.terrainDetail)label(info.terrainDetail,tx,wy+26,detailSize,{align:'left',color:dim,max});
  line(cx-18,cy,cx-10,cy,'#eef3e8b0');line(cx+10,cy,cx+18,cy,'#eef3e8b0');line(cx,cy-1,cx,cy+1,'#eef3e8b0');
  const routeY=top+b*(compact?1.30:1.36),distanceSize=Math.max(19,Math.min(31,b*.094)),routeHeight=info.remaining==='—'?25:distanceSize+24;
  const hasRoute=info.remaining!=='—',arrowWidth=info.turn===null?0:32;
  const rangeW=hasRoute?measure(info.remaining,distanceSize,620):0;
  const destW=hasRoute?Math.min(measure(info.destination,11),narrow?56:86):0;
  const routeW=Math.min(a*1.92,Math.max(measure(info.guidance,11),rangeW+destW+(hasRoute?9:0))+arrowWidth+20);
  const rx=cx-routeW/2,ry=routeY-routeHeight/2,textX=rx+arrowWidth+10;
  plate(rx,ry,routeW,routeHeight,'#141918b8');line(rx+1,ry+.5,rx+routeW-1,ry+.5);
  if(info.turn!==null){
   ctx.save();ctx.translate(rx+20,routeY);ctx.rotate(info.turn*Math.PI/180);ctx.strokeStyle=ink;ctx.lineWidth=1.65;
   ctx.beginPath();ctx.moveTo(0,8);ctx.lineTo(0,-8);ctx.moveTo(-6,-2);ctx.lineTo(0,-8);ctx.lineTo(6,-2);ctx.stroke();ctx.restore();
  }
  label(info.guidance,textX,ry+12,11,{align:'left',color:dim,max:routeW-arrowWidth-20});
  if(hasRoute){
   const y=ry+23+distanceSize*.42;
   label(info.remaining,textX,y,distanceSize,{align:'left',weight:620});
   label(info.destination,textX+rangeW+9,y+distanceSize*.18,11,{align:'left',color:dim,max:Math.max(1,Math.min(destW,rx+routeW-textX-rangeW-17))});
  }
  label('Radiation  Unknown',cx,Math.min(cy+b*.74,bottom-51),10,{color:dim,shadow:true});
  texture.needsUpdate=true;return true;
 }
 update({mode:'waiting'});
 return {mesh,update,setProfile(value){fit=helmetProfile(value);previous='';},dispose(){mesh.removeFromParent();geometry.dispose();material.dispose();texture.dispose();}};
}

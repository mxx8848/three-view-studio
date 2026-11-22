// Finite grooves leave two kinds of evidence: the end profile in one view
// and the axial extent of its generators in the perpendicular view.
const rect=(l,r,t,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]];
const cut=(role,profile,range)=>({role,profile,kind:'through',structural:true,...(range?{axialRange:range}:{})});
const bore=(role,c,range)=>({role,u:c.u,v:c.v,r:c.rx,kind:'through',structural:true,...(range?{axialRange:range}:{})});
const near=(x,y,tol=.012)=>Math.abs(x-y)<=tol;

function tracks(work,k){
 const groups=[];
 for(const path of work.paths.filter(p=>!p.arc&&['v','h','t'].includes(p.lt)))for(let i=1;i<path.points.length;i++){
  const a=path.points[i-1],b=path.points[i],lo=Math.min(a[1-k],b[1-k]),hi=Math.max(a[1-k],b[1-k]);
  if(hi-lo<.012||Math.abs(a[k]-b[k])>.006)continue;
  const at=(a[k]+b[k])/2;
  let g=groups.find(g=>near(at,g.at,.005));if(!g){g={at,spans:[],weight:0};groups.push(g);}
  g.at=(g.at*g.weight+at*(hi-lo))/(g.weight+hi-lo);g.weight+=hi-lo;
  g.spans.push({lo,hi,path});
 }
 return groups.sort((a,b)=>a.at-b.at);
}
function covers(track,lo,hi,type='v',quality=.82){
 if(!track||hi-lo<=.02)return false;
 const ss=track.spans.filter(s=>s.path.lt===type&&s.hi>=lo&&s.lo<=hi).sort((a,b)=>a.lo-b.lo);
 if(!ss.length||ss[0].lo>lo+.025||Math.max(...ss.map(s=>s.hi))<hi-.025)return false;
 let end=lo,length=0;
 for(const s of ss){const upper=Math.min(hi,s.hi);length+=Math.max(0,upper-Math.max(end,s.lo));end=Math.max(end,upper);}
 return length>=(hi-lo)*quality;
}
const trackAt=(tracks,at)=>tracks.find(l=>near(l.at,at));
function bottomGroove(elevation){
 const vs=elevation.vertical.filter(l=>l.at>.02&&l.at<.98&&l.spans.some(s=>s.path.lt==='v'&&s.hi>.975));
 for(const l of vs)for(const r of vs.filter(g=>g.at>l.at+.06)){
  const floor=elevation.horizontal.find(g=>g.at>.5&&g.at<.98&&covers(g,l.at,r.at)&&covers(l,g.at,1)&&covers(r,g.at,1));
  if(floor)return {left:l.at,right:r.at,level:floor.at};
 }
}
function generators(elevation,level,lo,hi){
 const g=trackAt(elevation.horizontal,level);
 return brokenWall(g,lo,hi);
}

function brokenWall(track,lo,hi){
 if(!track)return false;
 const dashes=track.spans.filter(s=>s.path.lt==='h'&&s.lo<hi&&s.hi>lo);
 if(dashes.length<2||dashes.reduce((sum,s)=>sum+Math.min(hi,s.hi)-Math.max(lo,s.lo),0)<(hi-lo)*.38)return false;
 // At a hidden corner the last dash may belong to a polyline with another
 // direction. Count its measured extent without classifying the other leg.
 const spans=track.spans.filter(s=>s.path.lt==='h'||!s.path.colored&&!s.path.manualType&&s.hi-s.lo<.18);
 return covers({spans:spans.map(s=>({...s,path:{lt:'h'}}))},lo,hi,'h',.45);
}

function layeredPlate(recon,f,s,footX,footD){
 const circles=recon.drawing.front.curveDatums||[];
 const upper=f.vertical.filter(g=>g.at>.02&&g.at<.98&&g.spans.some(p=>p.path.lt==='v'&&p.lo<.015));
 if(upper.length!==4||circles.length!==1)return;
 const [left,lipL,lipR,right]=upper,c=circles[0];
 if(!(c.u-c.rx>lipL.at&&c.u+c.rx<lipR.at&&c.v-c.ry>.01))return;
 const ledge=f.horizontal.find(g=>g.at>c.v+c.ry&&g.at<footX.level&&covers(g,0,lipL.at)&&covers(g,lipR.at,1));
 const shoulder=ledge&&s.vertical.find(g=>g.at>.02&&g.at<.98&&covers(g,0,ledge.at));
 if(!shoulder||![left,right].every(g=>covers(g,0,ledge.at))||![lipL,lipR].every(g=>covers(g,0,footX.level))||!covers(trackAt(s.horizontal,ledge.at),shoulder.at,1))return;
 const stop=s.vertical.find(g=>g.at>.02&&g.at<shoulder.at&&generators(s,c.v-c.ry,0,g.at)&&generators(s,c.v+c.ry,0,g.at)&&brokenWall(g,0,footX.level));
 if(!stop)return;
 return {family:'forked-plate-crossed-base-grooves',target:'top',components:[],boxes:[
  {lo:[0,0,0],hi:[1,1,1-ledge.at]},{lo:[left.at,1-shoulder.at,1-ledge.at],hi:[right.at,1,1]}],
  features:[cut('front',rect(footX.left,footX.right,footX.level,1.02)),cut('side',rect(footD.left,footD.right,footD.level,1.02)),
   cut('top',rect(lipL.at,lipR.at,stop.at,1.02)),bore('front',c,[1-stop.at,1])],
  explanation:['主视的两级外壁与左视的肩面同高，先确定底座和立板的长、深、高。两图底部开口分别对应两道垂直相交的槽，各自的槽顶在另一图留下虚线。',
   '主视圆孔的上下切点与左视两排短虚线等高。孔壁在同一道竖向终止边结束，前方是叉口；将该深度经45°线转入俯视，保留后部孔壁虚线。']};
}

function saddle(recon,f,s,footX,footD){
 const rings=(recon.drawing.front.curveDatums||[]).filter(c=>near(c.v,0)&&c.u-c.rx>0&&c.u+c.rx<1).sort((a,b)=>a.rx-b.rx);
 if(rings.length!==2||!near(rings[0].u,rings[1].u))return;
 const [small,large]=rings;
 const end=s.vertical.find(g=>g.at>.02&&g.at<.98&&covers(g,0,1)&&covers(trackAt(s.horizontal,large.ry),0,g.at));
 if(!end)return;
 const wall=s.vertical.find(g=>g.at>end.at&&g.at<.98&&generators(s,small.ry,0,g.at)&&generators(s,large.ry,g.at,1));
 if(!wall)return;
 const ledge=s.horizontal.find(g=>g.at>large.ry&&g.at<Math.min(footX.level,footD.level)&&covers(g,wall.at,1)&&covers(wall,0,g.at));
 if(!ledge)return;
 const shoulders=f.vertical.filter(g=>g.at>.02&&g.at<.98&&covers(g,0,ledge.at));
 if(shoulders.length!==2)return;
 const [l,r]=shoulders.map(g=>g.at);
 if(l>=large.u-large.rx||r<=large.u+large.rx||!covers(trackAt(f.horizontal,ledge.at),0,l)||!covers(trackAt(f.horizontal,ledge.at),r,1))return;
 // The two arcs establish a hole in front of the centre cross. A thin
 // diameter in that opening can touch both lips and look like a solid line.
 const work=recon.drawing.front;
 const onAxis=p=>p.points.every(([x])=>near(x,small.u,.004));
 const cross=work.paths.some(p=>p.lt==='c'&&onAxis(p)&&p.points.some(([,y])=>y>0&&y<small.ry));
 const lineClasses=cross?work.paths.filter(p=>!p.arc&&!p.manualType&&p.black&&p.width<work.thickWidth*.8&&p.lt==='v'&&(
  onAxis(p)&&p.points.every(([,y])=>y<=small.ry)||
  p.points.every(([x,y])=>near(y,0,.004)&&Math.abs(x-small.u)<=small.rx+.004)
 )).map(p=>['front',p.id,'c']):[];
 return {family:'stepped-open-saddle-crossed-base-grooves',target:'top',lineClasses,
  components:[{axis:'y',x:large.u,y:.5,z:1,r:large.rx,lo:1-end.at,hi:1}],
  boxes:[{lo:[0,0,0],hi:[1,1-end.at,1]}],
  features:[bore('front',{...small,v:0},[1-wall.at,1]),bore('front',{...large,v:0},[0,1-wall.at]),
   cut('front',rect(-.02,l,-.02,ledge.at),[0,1-wall.at]),cut('front',rect(r,1.02,-.02,ledge.at),[0,1-wall.at]),
   cut('front',rect(footX.left,footX.right,footX.level,1.02)),cut('side',rect(footD.left,footD.right,footD.level,1.02))],
  explanation:['主视上沿有两个同心半圆，左视对应两种高度的隐藏槽底。沿深度分开：小半径段延伸到台肩，大半径段在台肩前方；后端突出的半圆外缘也有独立端面。',
   '将两道槽底和左右肩的位置分别转入俯视。再由底部两个方向的开口求交，遮住的槽边画虚线。']};
}

function openTube(recon){
 const {front,top}=recon.drawing;
 const arch=(front.curveDatums||[]).find(c=>near(c.v,1));
 const mouth=(front.curveDatums||[]).find(c=>c.v-c.ry>.015&&c.v+c.ry<1&&near(c.u,arch?.u));
 if(!mouth||!top.sourceSize?.h)return;
 const endMargin=2/top.sourceSize.h;
 const rings=(top.curveDatums||[]).filter(c=>c.v-c.ry>endMargin&&c.v+c.ry<1-endMargin).sort((a,b)=>b.rx-a.rx);
 if(rings.length!==2)return;
 const [outer,inner]=rings,lr=[mouth.u-mouth.rx,mouth.u+mouth.rx],frontWalls=tracks(front,0),topWalls=tracks(top,0);
 if(!near(outer.rx,.5)||!near(outer.u,inner.u)||!near(outer.v,inner.v)||!near(mouth.u,inner.u)||!near(mouth.rx,inner.rx))return;
 if(![arch.u-arch.rx,arch.u+arch.rx].every(x=>{const g=trackAt(topWalls,x);return g&&g.spans.some(s=>s.lo<.02)&&g.spans.some(s=>s.hi>.98);}))return;
 const reach=outer.ry*Math.sqrt(1-(inner.rx/outer.rx)**2);
 const sideOfSlot=[-1,1].filter(sign=>lr.every(x=>covers(trackAt(topWalls,x),Math.min(inner.v,inner.v+sign*reach),Math.max(inner.v,inner.v+sign*reach))));
 if(sideOfSlot.length!==1||!lr.every(x=>covers(trackAt(frontWalls,x),0,mouth.v)))return;
 const sign=sideOfSlot[0],edits=[];
 function dashed(work,g,lo,hi){
  if(!g)return false;
  const runs=g.spans.filter(s=>s.lo>=lo-.015&&s.hi<=hi+.015&&!s.path.manualType&&s.path.points.length===2).sort((a,b)=>a.lo-b.lo);
  const unit=1/work.sourceSize.h;
  if(runs.length<3||runs.filter((s,i)=>i&&s.lo-runs[i-1].hi>unit*.8).length<2)return false;
  if(runs.at(-1).hi-runs[0].lo<(hi-lo)*.5)return false;
  for(const s of runs)edits.push([work===front?'front':'top',s.path.id,'h']);
  return true;
 }
 const rear=inner.v-sign*reach;
 if(!lr.every(x=>dashed(front,trackAt(frontWalls,x),mouth.v,1)&&dashed(top,trackAt(topWalls,x),Math.min(inner.v,rear),Math.max(inner.v,rear))))return;
 const sharedX=[inner.u,mouth.u,outer.u,arch.u];
 const aligned=(Math.max(...sharedX)-Math.min(...sharedX))*Math.max(front.sourceSize.w,top.sourceSize.w)<=1;
 const axis=sharedX.reduce((sum,x)=>sum+x,0)/sharedX.length;
 const u=aligned?axis:(inner.u+mouth.u)/2,r=(inner.rx+mouth.rx)/2;
 return {family:'open-tube-cross-bore-arched-base',target:'side',lineClasses:edits,
  components:[{axis:'z',x:aligned?axis:outer.u,y:1-outer.v,z:.5,r:outer.rx,lo:0,hi:1},{axis:'y',x:aligned?axis:arch.u,y:.5,z:0,r:arch.rx,lo:0,hi:1}],boxes:[],
  features:[bore('top',{...inner,u,rx:r}),bore('front',{...mouth,u,rx:r}),cut('front',rect(u-r,u+r,-.02,mouth.v),sign>0?[0,1-inner.v]:[1-inner.v,1])],
  explanation:['俯视同心圆与主视圆口、成对孔壁虚线分别确定竖孔和横孔。俯视圆外两端的直边与主视底部半圆对应，形成沿深度延伸的半圆柱底座。',
   '两条孔壁从实线转为虚线的位置给出开槽终点，只切去槽口一侧的上壁。用辅助平面求两孔的相贯线，再按剩余管壁判断左视中的可见段和隐藏段。']};
}

// A radial slot ending in a semicircle removes a rectangular opening and
// half a cross bore. The axial bore remains above and below the opening.
function roundEndedTubeSlot(recon){
 const {front,top}=recon.drawing;
 const rings=(top.curveDatums||[]).toSorted((a,b)=>b.rx-a.rx);
 if(rings.length!==2)return;
 const [outer,inner]=rings;
 if(!near(outer.rx,.5)||!near(outer.ry,.5)||!near(outer.u,inner.u)||!near(outer.v,inner.v))return;
 const arcs=(front.curveDatums||[]).filter(c=>near(c.u,outer.u,.025)&&c.v-c.ry>.03&&c.v+c.ry<.97);
 if(arcs.length!==1)return;
 const c=arcs[0],levels=[c.v-c.ry,c.v+c.ry],walls=tracks(front,0),lips=tracks(front,1);
 for(const sign of [-1,1]){
  const open=sign<0?0:1,back=1-open,wall=trackAt(walls,open);
  const across=[open,c.u].sort((a,b)=>a-b);
  if(!covers(trackAt(walls,back),0,1)||!covers(wall,0,levels[0])||!covers(wall,levels[1],1)||covers(wall,...levels))continue;
  // The circular fit can absorb the last few pixels of a tangent lip.
  const inside=sign<0?[across[0]+.022,across[1]-c.rx*.55]:[across[0]+c.rx*.55,across[1]-.022];
  if(!levels.every(v=>lips.some(g=>near(g.at,v)&&covers(g,...inside))))continue;
  const far=c.u-sign*c.rx,edge=front.paths.find(p=>p.arc&&c.ids?.includes(p.id));
  if(!edge?.points.some(q=>near(q[0],far,.018)&&near(q[1],c.v,.04)))continue;
  // On the plan the back of the slot has a separate generator on either
  // side of the axial hole. An elevation without these stops is ambiguous.
  const depthLimits=tracks(top,0).find(g=>near(g.at,far,.02));
  if(!depthLimits||![-1,1].every(s=>depthLimits.spans.some(p=>p.path.lt!=='v'&&s*((p.hi+p.lo)/2-inner.v)>.09)))continue;
  const pixelX=1/(front.sourceSize?.w||300),range=sign<0?[-.02,c.u]:[c.u,1.02];
  const axis=Math.abs(c.u-inner.u)<pixelX*1.5?(c.u+inner.u)/2:c.u;
  range[sign<0?1:0]=axis;
  return {family:'axial-tube-round-ended-side-slot',target:'side',components:[{axis:'z',x:outer.u,y:1-outer.v,z:.5,r:outer.rx,lo:0,hi:1}],boxes:[],
   features:[bore('top',inner),bore('front',{...c,u:axis}),cut('front',rect(...range,...levels))],
   explanation:['俯视的两个同心圆给出圆管外径和轴向孔径。主视的一侧外壁在两个槽唇之间断开，另一侧外壁保持连续。',
    '主视的两条槽唇与半圆形槽底相切。将槽底最深处投到俯视，与内孔两侧的槽壁核对，再由实际剩余管壁判定左视相贯线的虚实。']};
 }
}

export function layeredStructureHypotheses(recon){
 const target=recon.inferredRoles?.[0]||recon.completionRole;
 const out=[];
 // A complete third view is an additional constraint on this construction.
 // The caller scores all supplied views before accepting the measured body.
 if((!target||target==='side')&&recon.drawing.top?.paths.length){
  out.push(...[openTube(recon),roundEndedTubeSlot(recon)].filter(Boolean));
 }
 if((target&&target!=='top')||!recon.drawing.side?.paths.length)return out;
 const view=w=>({vertical:tracks(w,0),horizontal:tracks(w,1)});
 const f=view(recon.drawing.front),s=view(recon.drawing.side),footX=bottomGroove(f),footD=bottomGroove(s);
 if(!footX||!footD)return out;
 if(!s.horizontal.some(g=>near(g.at,footX.level)&&g.spans.some(p=>p.path.lt==='h'))||
    !f.horizontal.some(g=>near(g.at,footD.level)&&g.spans.some(p=>p.path.lt==='h')))return out;
 return [...out,layeredPlate(recon,f,s,footX,footD),saddle(recon,f,s,footX,footD)].filter(Boolean);
}

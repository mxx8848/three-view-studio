// Finite support assemblies measured from two orthographic drawings. No
// image names, exercise numbers or missing-view pixels enter these rules.
import {circleFit,simplify} from './upload-lines.js';
const rect=(l,r,t,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]];
const box=(l,r,a,b,z,h)=>({lo:[l,a,z],hi:[r,b,h]});
const cut=(role,profile,extra={})=>({role,profile,kind:'through',structural:true,...extra});
const bore=(role,c,extra={})=>({role,u:c.u,v:c.v,r:c.rx,kind:'through',structural:true,...extra});
const lines=w=>w.paths.filter(p=>!p.arc&&p.lt==='v').flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
const hs=w=>lines(w).filter(l=>Math.abs(l.a[1]-l.b[1])<.006&&Math.abs(l.a[0]-l.b[0])>.025);
const vs=w=>lines(w).filter(l=>Math.abs(l.a[0]-l.b[0])<.006&&Math.abs(l.a[1]-l.b[1])>.06);
const mid=l=>(l.a[0]+l.b[0])/2;
const span=l=>[Math.min(l.a[0],l.b[0]),Math.max(l.a[0],l.b[0])];
const unique=xs=>xs.sort((a,b)=>a-b).filter((x,i,a)=>!i||x-a[i-1]>.015);
const cylinder=(c,lo,hi)=>({axis:'y',x:c.u,y:.5,z:1-c.v,r:c.rx,lo,hi});

// JPEG stair steps can survive the drawing's curve smoothing. Recover long
// straight inclines from dense measured ink rather than requiring one long
// segment in that display polyline. Do not bridge curved runs or junctions.
function measuredInclines(w) {
 if(!w.sourceMap)return [];
 const [o,u,v]=w.sourceMap,map=p=>o.map((x,i)=>x+p[0]*(u[i]-x)+p[1]*(v[i]-x)),out=[];
 for(const p of w.paths.filter(p=>p.lt==='v'&&!p.arc&&p.measuredPoints?.length>20)) {
  const raw=p.measuredPoints,tol=Math.max(1.25,p.width*.7),ps=simplify(raw,tol);
  for(let i=1;i<ps.length;i++) {
   const a=ps[i-1],b=ps[i],na=map(a),nb=map(b);
   if(Math.abs(na[0]-nb[0])<.15||Math.abs(na[1]-nb[1])<.15)continue;
   const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
   const samples=raw.filter(q=>{const t=((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(length*length);return t>.02&&t<.98&&Math.abs(dx*(q[1]-a[1])-dy*(q[0]-a[0]))/length<=tol;});
   if(samples.length<length*.7)continue;
   const x=samples.reduce((s,q)=>s+q[0],0)/samples.length,y=samples.reduce((s,q)=>s+q[1],0)/samples.length;
   const m=samples.reduce((s,q)=>s+(q[0]-x)*(q[1]-y),0)/samples.reduce((s,q)=>s+(q[0]-x)**2,0);
   const rms=Math.sqrt(samples.reduce((s,q)=>s+(q[1]-y-m*(q[0]-x))**2,0)/samples.length/(1+m*m));
   if(rms>tol*.55)continue;
   out.push({a:map([a[0],y+m*(a[0]-x)]),b:map([b[0],y+m*(b[0]-x)]),path:p});
  }
 }
 return out;
}

// A circle in one view establishes the two wall supports in the other.
// Repeated white gaps on those supports establish dashes, even if a black
// screenshot stroke has the same measured width as the visible contour.
export function classifySupportBoreDashes(recon,h) {
 if(h.family==='counterbored-tube-finite-web-pedestal') {
  const w=recon.drawing.front,[o,u,v]=w.sourceMap||[];
  if(o)for(const l of measuredInclines(w)) {
   const sx=1/Math.abs(u[0]-o[0]),sy=1/Math.abs(v[1]-o[1]),a=[l.a[0]*sx,l.a[1]*sy],b=[l.b[0]*sx,l.b[1]*sy],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
   const tolerance=Math.max(1.25,(l.path.width||1)*.7);
   l.path.points=simplify(l.path.points.map(p=>{
    if(p.curved)return p;
    const x=p[0]*sx,y=p[1]*sy,t=((x-a[0])*dx+(y-a[1])*dy)/length;
    if(t<-.015||t>1.015||Math.abs(dx*(y-a[1])-dy*(x-a[0]))/Math.sqrt(length)>tolerance)return p;
    // Keep its measured X and shared vertical junction; only remove the
    // staircase displacement perpendicular to the fitted straight support.
    return [p[0],(a[1]+(x-a[0])*dy/dx)/sy];
   }),.5/Math.max(sx,sy));
  }
 }
 // Thin black axes on a red JPEG need not be thinner than the red outline.
 // Require measured extension past the circular face (or the finite tube),
 // rather than a colour-dependent width ratio.
 for(const role of ['front','top']) {
  const w=recon.drawing[role];
  for(const c of w.curveDatums||[])for(const axis of [0,1]) {
   const at=axis?c.v:c.u,radius=axis?c.rx:c.ry,center=axis?c.u:c.v;
   const tolerance=Math.max(2,w.thickWidth||1)/(axis?w.sourceSize.h:w.sourceSize.w);
   const paths=w.paths.filter(p=>!p.arc&&!p.colored&&p.points.every(q=>Math.abs(q[axis]-at)<tolerance));
   const ends=paths.flatMap(p=>p.points.map(q=>q[1-axis]));
   if(Math.min(...ends)<center-radius-.012&&Math.max(...ends)>center+radius+.012)for(const p of paths)p.lt='c';
  }
 }
 for(const c of h.components||[])if(c.axis==='y') {
  const w=recon.drawing.top,paths=w.paths.filter(p=>!p.arc&&!p.colored&&p.points.every(q=>Math.abs(q[0]-c.x)<.004));
  const ends=paths.flatMap(p=>p.points.map(q=>q[1]));
  if(Math.min(...ends)<1-c.hi-.015&&Math.max(...ends)>1-c.lo+.015)for(const p of paths)p.lt='c';
 }
 for(const f of h.features.filter(f=>!f.profile&&f.kind==='through'&&['front','top'].includes(f.role))) {
  const role=f.role==='top'?'front':'top',w=recon.drawing[role];
  for(const x of [f.u-f.r,f.u+f.r]) {
   const paths=w.paths.filter(p=>!p.arc&&!p.colored&&p.points.length===2&&p.points.every(q=>Math.abs(q[0]-x)<Math.max(2,(w.thickWidth||1)*.9)/w.sourceSize.w)&&Math.abs(p.points[0][0]-p.points[1][0])<.004);
   const runs=paths.map(p=>[Math.min(...p.points.map(q=>q[1])),Math.max(...p.points.map(q=>q[1]))]).sort((a,b)=>a[0]-b[0]);
   if(runs.length>=2&&runs.some((r,i)=>i&&r[0]-runs[i-1][1]>1.5/w.sourceSize.h))for(const p of paths){p.lt='h';p.dashFragment=true;}
  }
 }
}

export function supportStructureHypotheses(recon) {
 const {front,top,side}=recon.drawing,s=recon.modelSize,out=[];
 // A measured circle tangent to the drawing envelope must share that exact
 // support. Subpixel least-squares drift otherwise clips off its silhouette.
 const tangentCircle=c=>Math.abs(c.v-c.rx*s.x/s.z)*front.sourceSize.h<1.5?{...c,rx:c.v*s.z/s.x,ry:c.v}:c;
 if(recon.inferredRoles.includes('front')) {
  const walls=vs(top),full=x=>{const ps=walls.filter(l=>Math.abs(mid(l)-x)<.008).flatMap(l=>[l.a[1],l.b[1]]);return Math.min(...ps)<.025&&Math.max(...ps)>.94;};
  const left=walls.find(l=>mid(l)>.1&&mid(l)<.4&&full(mid(l)));
  const right=left&&walls.find(l=>mid(l)>.6&&mid(l)<.9&&Math.abs(mid(l)+mid(left)-1)<.025&&full(mid(l)));
  const slot=walls.filter(l=>mid(l)>.3&&mid(l)<.7&&Math.max(l.a[1],l.b[1])>.94&&Math.min(l.a[1],l.b[1])>.45);
  const slope=lines(side).find(l=>Math.abs(l.a[0]-l.b[0])>.2&&Math.abs(l.a[1]-l.b[1])>.12&&Math.min(l.a[1],l.b[1])<.03);
  const base=hs(side).find(l=>l.a[1]>.5&&l.a[1]<.9&&Math.min(...span(l))<.04);
  const notch=(top.curveDatums||[]).find(c=>Math.min(Math.abs(c.u),Math.abs(1-c.u))<.02&&Math.abs(c.v-.5)<.025);
  if(left&&right&&slot.length>=2&&slope&&base&&notch) {
   const l=mid(left),r=mid(right),sl=Math.min(...slot.map(mid)),sr=Math.max(...slot.map(mid)),measuredStop=Math.min(...slot.flatMap(l=>[l.a[1],l.b[1]]));
   const endWalls=side.paths.filter(p=>!p.arc&&['h','t'].includes(p.lt)&&p.points.every(q=>Math.abs(q[0]-measuredStop)<.03)&&p.points.length>=2&&Math.abs(p.points[0][1]-p.points.at(-1)[1])>.06);
   const end=endWalls.length>=3?endWalls.flatMap(p=>p.points).reduce((n,p)=>n+p[0],0)/endWalls.flatMap(p=>p.points).length:measuredStop;
   const stop=(measuredStop+end)/2;
   let a=slope.a[1]<slope.b[1]?slope.a:slope.b,q=a===slope.a?slope.b:slope.a,b=[1,a[1]+(q[1]-a[1])*(1-a[0])/(q[0]-a[0])];
   const [o,u,v]=side.sourceMap||[],samples=o?side.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||[]).map(p=>o.map((x,i)=>x+p[0]*(u[i]-x)+p[1]*(v[i]-x))).filter(p=>p[0]>a[0]+.05&&p[0]<.94&&Math.abs(p[1]-(a[1]+(b[1]-a[1])*(p[0]-a[0])/(1-a[0])))<.015):[];
   if(samples.length>=12){const x=samples.reduce((n,p)=>n+p[0],0)/samples.length,y=samples.reduce((n,p)=>n+p[1],0)/samples.length,m=samples.reduce((n,p)=>n+(p[0]-x)*(p[1]-y),0)/samples.reduce((n,p)=>n+(p[0]-x)**2,0);if(m>0&&samples.every(p=>Math.abs(p[1]-y-m*(p[0]-x))*side.sourceSize.h<1.5)){a=[x-y/m,0];b=[1,y+m*(1-x)];}}
   const corners=side.paths.filter(p=>p.lt==='v').flatMap(p=>p.points).filter(p=>(p[0]<.004||p[0]>.996)&&Math.abs(p[1]-base.a[1])<.015);
   const baseV=corners.length?(base.a[1]+corners.reduce((n,p)=>n+p[1],0)/corners.length)/2:base.a[1];
   const h=1-baseV,notches=[0,1].map(u=>bore('top',{u,v:notch.v,rx:notch.rx}));
   out.push({family:'inclined-web-fork-notched-base',target:'front',components:[],boxes:[box(0,1,0,1,0,h),box(l,r,0,1,h-1e-5,1)],features:[...notches,cut('top',rect(sl,sr,stop,1.02)),cut('side',[[a[0],-.02],[1.02,-.02],[1.02,b[1]],[b[0],b[1]],a])],explanation:['俯视的两条贯穿直壁确定中部立台的宽度，左视斜线和水平段确定沿深度变化的顶面。','底座两端的半圆凹口按圆柱面切除；前端两条槽壁及终止横线共同确定叉槽的宽度和有限长度。','将斜面在叉槽终止处的高度投到主视图，保留槽后方材料；凹口的两条最深母线按遮挡画虚线。']});
  }
 }
 if(recon.inferredRoles.includes('top')) {
  const arcs=(front.curveDatums||[]).filter(c=>Math.abs(c.u-.5)<.025&&Math.abs(c.v-1)<.025).sort((a,b)=>b.rx-a.rx);
  const holes=(front.curveDatums||[]).filter(c=>c.v>.05&&c.v<.5&&c.rx<.15);
  const levels=unique(hs(side).map(l=>l.a[1])).filter(v=>v>.04&&v<.96);
  const depth=unique(vs(side).map(mid)).filter(v=>v>.06&&v<.94);
  const corners=(front.curveDatums||[]).filter(c=>c.v<.4&&c.rx>.15&&c.rx<.25);
  if(arcs.length===2&&holes.length===2&&corners.length===2&&depth.length===2&&levels.length>=2) {
   const t=depth[0],end=depth[1],baseV=Math.max(...levels),R=arcs[0].rx,inner=arcs[1];
   const cs=corners.map(tangentCircle).sort((a,b)=>a.u-b.u),l=cs[0].u-cs[0].rx,r=cs[1].u+cs[1].rx;
   const points=[[l,baseV],[l,cs[0].v]];
   for(let i=0;i<=48;i++){const a=Math.PI+i*Math.PI/96;points.push([cs[0].u+cs[0].rx*Math.cos(a),cs[0].v+cs[0].ry*Math.sin(a)]);}
   for(let i=0;i<=48;i++){const a=-Math.PI/2+i*Math.PI/96;points.push([cs[1].u+cs[1].rx*Math.cos(a),cs[1].v+cs[1].ry*Math.sin(a)]);}
   points.push([r,baseV],[l,baseV]);
   out.push({family:'rounded-plate-arch-base',target:'top',components:[cylinder({...arcs[0],v:1},0,1),...cs.map(c=>({...cylinder(c,1-t,1),analyticOnly:true}))],boxes:[box(0,1,1-end,1,0,1-baseV),{...box(l,r,1-t,1,1-baseV,1-Math.max(...cs.map(c=>c.v))),analyticOnly:true},{...box(cs[0].u,cs[1].u,1-t,1,1-baseV,1),analyticOnly:true}],profiles:[{role:'front',points,lo:1-t,hi:1,meshOnly:true}],features:[bore('front',{...inner,v:1}),...holes.map(c=>bore('front',c,{axialRange:[1-t,1]}))],explanation:['主视的同心半圆确定拱座和贯穿圆拱孔，两只圆孔及圆角外边确定后立板。','左视的两条深度台阶分别确定立板厚度与底脚长度；圆孔仅贯穿立板，底脚也不能拉满整个深度。','俯视先画分段外框，再转移立板边和孔壁。圆拱孔及板孔的隐藏母线按实体遮挡绘制。']});
  }
 }
 if(recon.inferredRoles.includes('side')) {
  // Rounded mounting plate with a projecting half-cylinder and a finite
  // counterbore. Three concentric semicircles are not three through holes.
  {
  const arches=(front.curveDatums||[]).filter(c=>Math.abs(c.u-.5)<.025&&Math.abs(c.v-1)<.025).sort((a,b)=>b.rx-a.rx);
  const holes=(front.curveDatums||[]).filter(c=>c.rx<.12&&c.v>.15&&c.v<.6);
  if(arches.length===3&&holes.length===2) {
   const [outer,counter,inner]=arches,ends=unique(hs(top).filter(l=>Math.min(...span(l))<outer.u&&Math.max(...span(l))>outer.u).map(l=>l.a[1])).filter(v=>v>.05&&v<.95);
   const hidden=top.paths.filter(p=>!p.arc&&['h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
   const stops=unique(hidden.filter(l=>Math.abs(l.a[1]-l.b[1])<.008&&Math.abs(l.a[0]-l.b[0])>.015).map(l=>l.a[1])).filter(v=>v>(ends[0]||1)+.04&&v<.95);
   const corners=[];
   if(front.sourceMap)for(const right of [false,true]) {
    const [o,u,v]=front.sourceMap,metric=s.x/s.z;
    const ps=front.paths.filter(p=>p.lt==='v'&&!p.arc).flatMap(p=>p.measuredPoints||[]).map(p=>o.map((x,i)=>x+p[0]*(u[i]-x)+p[1]*(v[i]-x))).filter(p=>p[0]>(right?.82:.005)&&p[0]<(right?.995:.18)&&p[1]>.008&&p[1]<.32&&holes.every(c=>Math.hypot(p[0]-c.u,(p[1]-c.v)/metric)>c.rx*1.35)).map(p=>[p[0]*1000,p[1]*1000/metric]);
    const fit=circleFit(ps,10);
    const tolerance=2000/front.sourceSize.w;
    if(fit&&fit.error<.025&&fit.r>80&&fit.r<250&&Math.abs(fit.cy-fit.r)<tolerance&&Math.abs((right?1000-fit.cx:fit.cx)-fit.r)<tolerance)corners.push({u:right?1-fit.r/1000:fit.r/1000,v:fit.r/1000*metric,rx:fit.r/1000,ry:fit.r/1000*metric});
   }
   if(ends.length===1&&stops.length===1&&corners.length===2&&Math.abs(corners[0].rx-corners[1].rx)<.02) {
    const back=ends[0],stop=stops[0],points=[[0,1],[0,corners[0].v]];
    for(let i=0;i<=48;i++){const a=Math.PI+i*Math.PI/96;points.push([corners[0].u+corners[0].rx*Math.cos(a),corners[0].v+corners[0].ry*Math.sin(a)]);}
    for(let i=0;i<=48;i++){const a=-Math.PI/2+i*Math.PI/96;points.push([corners[1].u+corners[1].rx*Math.cos(a),corners[1].v+corners[1].ry*Math.sin(a)]);}
    points.push([1,1],[0,1]);
    out.push({family:'rounded-plate-stepped-arch',target:'side',components:[cylinder({...outer,v:1},0,1-back),...corners.map(c=>({...cylinder(c,1-back,1),analyticOnly:true}))],boxes:[{...box(0,1,1-back,1,0,1-Math.max(...corners.map(c=>c.v))),analyticOnly:true},{...box(corners[0].u,corners[1].u,1-back,1,0,1),analyticOnly:true}],profiles:[{role:'front',points,lo:1-back,hi:1,meshOnly:true}],features:[bore('front',{...inner,v:1}),bore('front',{...counter,v:1},{axialRange:[0,1-stop]}),...holes.map(c=>bore('front',c,{axialRange:[1-back,1]}))],explanation:['主视三条同心半圆分别确定前部拱体外圆、有限深度的大拱孔和贯穿的小拱孔，不能全部当作通孔。','俯视宽条限定后立板厚度；窄条限定前伸拱体，虚线横向终止边限定大孔只从前端切入。两只安装孔仅贯穿后立板。','左视先转移板厚、拱体长度及拱顶高度，再画大小拱孔的台阶和安装孔壁，按实际遮挡区分实线与虚线。']});
   }
  }
  }
  const rings=(front.curveDatums||[]).filter(c=>c.u>.5&&c.v>.15&&c.v<.6).sort((a,b)=>b.rx-a.rx);
  const mounting=(top.curveDatums||[]).filter(c=>c.u<.5&&c.rx<.12);
  if(rings.length===3&&mounting.length===2&&rings.every(c=>Math.hypot(c.u-rings[0].u,c.v-rings[0].v)<.015)) {
   const [rawOuter,rawCounter,rawInner]=rings;
   let outer=tangentCircle(rawOuter);
   if(Math.abs(1-rawOuter.u-rawOuter.rx)*front.sourceSize.w<Math.max(1.5,(front.thickWidth||1)*.6)) {
    const radius=(outer.rx+1-rawOuter.u)/2;
    outer={...outer,u:1-radius,v:radius*s.x/s.z,rx:radius,ry:radius*s.x/s.z};
   }
   const counter={...rawCounter,u:outer.u,v:outer.v},inner={...rawInner,u:outer.u,v:outer.v};
   const base=hs(front).filter(a=>a.a[1]>.5&&a.a[1]<.95).sort((a,b)=>Math.abs(b.a[0]-b.b[0])-Math.abs(a.a[0]-a.b[0]))[0];
   const depths=unique(hs(top).filter(a=>Math.min(...span(a))<.04&&Math.max(...span(a))>.35).map(a=>a.a[1])).filter(v=>v>.02&&v<.98);
   const tubeEnd=hs(top).find(a=>a.a[1]>.5&&a.a[1]<.95&&Math.min(...span(a))>outer.u-outer.rx-.03);
   const slope=[...lines(front),...measuredInclines(front)].filter(a=>Math.abs(a.a[0]-a.b[0])>.15&&Math.abs(a.a[1]-a.b[1])>.15).sort((a,b)=>Math.abs(b.a[0]-b.b[0])-Math.abs(a.a[0]-a.b[0]))[0];
   const support=vs(front).filter(a=>Math.min(a.a[1],a.b[1])>.5&&Math.max(a.a[1],a.b[1])<.98&&Math.abs(mid(a)-outer.u)<inner.rx);
   // Counterbore termination is a paired hidden step, independently aligned
   // with its diameter in plan. A third ring alone does not fix hole depth.
   const hidden=top.paths.filter(p=>!p.arc&&['h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
   const rim=hidden.filter(a=>Math.abs(a.a[1]-a.b[1])<.008&&a.a[1]>.4&&a.a[1]<.9&&[a.a[0],a.b[0]].some(x=>Math.abs(Math.abs(x-outer.u)-counter.rx)<.025));
   const stops=unique(rim.map(a=>a.a[1]));
   if(base&&depths.length===2&&tubeEnd&&slope&&support.length>=2&&stops.length) {
    const back=depths[0],webFront=depths[1],end=tubeEnd.a[1],stop=stops.find(v=>v>webFront+.04&&v<end-.04);
    if(stop!==undefined) {
     const a=slope.a[0]<slope.b[0]?slope.a:slope.b,b=a===slope.a?slope.b:slope.a,metric=[outer.u*s.x,outer.v*s.z],point=[a[0]*s.x,a[1]*s.z],delta=point.map((v,i)=>v-metric[i]),d2=delta[0]**2+delta[1]**2,R=outer.rx*s.x;
     if(d2>R*R) {
      const k=R*R/d2,q=R*Math.sqrt(d2-R*R)/d2,tangents=[-1,1].map(sign=>[metric[0]+k*delta[0]-sign*q*delta[1],metric[1]+k*delta[1]+sign*q*delta[0]]).map(p=>[p[0]/s.x,p[1]/s.z]);
      const tangent=tangents.sort((p,q)=>Math.abs(p[1]-(a[1]+(b[1]-a[1])*(p[0]-a[0])/(b[0]-a[0])))-Math.abs(q[1]-(a[1]+(b[1]-a[1])*(q[0]-a[0])/(b[0]-a[0]))))[0];
      const h=1-base.a[1],l=Math.min(...support.map(mid)),r=Math.max(...support.map(mid)),measuredHeight=1-Math.min(...support.flatMap(a=>[a.a[1],a.b[1]]));
      // The pedestal joins the lower cylindrical surface at its two walls.
      // Raster junctions terminate a little early; recover the exact common
      // point instead of leaving an air slit or two false horizontal shelves.
      const half=Math.max(Math.abs(l-outer.u),Math.abs(r-outer.u))*s.x,join=1-outer.v-Math.sqrt(Math.max(0,(outer.rx*s.x)**2-half**2))/s.z;
      const height=Math.abs(join-measuredHeight)*front.sourceSize.h<Math.max(2,(front.thickWidth||1)*.8)?join+1e-6:measuredHeight;
      const points=[[0,base.a[1]],[0,a[1]-a[0]*(b[1]-a[1])/(b[0]-a[0])],tangent,[outer.u,outer.v],[1,outer.v],[1,base.a[1]],[0,base.a[1]]];
      out.push({family:'counterbored-tube-finite-web-pedestal',target:'side',components:[cylinder(outer,1-end,1)],boxes:[box(0,1,0,1-back,0,h),{...box(l,r,1-end,1-webFront,h-1e-5,height),analyticOnly:true},{...box(l,r,1-end,1-webFront+1e-4,h-1e-5,height),meshOnly:true}],profiles:[{role:'front',points,lo:1-webFront,hi:1-back}],features:[bore('front',inner),bore('front',counter,{axialRange:[1-end,1-stop]}),...mounting.map(c=>bore('top',c))],explanation:['主视的三个同心圆确定圆筒、通孔和沉孔；俯视的成对隐藏台阶确定沉孔只从前端切入。','俯视两条横线限定斜肋厚度，圆筒下方的窄支撑由两图的竖壁和终止边确定，底座安装孔沿高度贯通。','先补圆筒与底座的深度外框，再画有限斜肋和支撑。通孔及沉孔分别使用各自深度范围，按真实遮挡补虚线。']});
     }
    }
   }
  }
  const arches=(front.curveDatums||[]).filter(c=>Math.abs(c.u-.5)<.025&&Math.abs(c.v-1)<.025).sort((a,b)=>b.rx-a.rx);
  const rawRoof=(front.curveDatums||[]).find(c=>Math.abs(c.u-.5)<.025&&c.v>.1&&c.v<.4&&c.rx>.12),roof=rawRoof&&tangentCircle(rawRoof);
  const hole=(front.curveDatums||[]).find(c=>roof&&Math.hypot(c.u-roof.u,c.v-roof.v)<.015&&c.rx<roof.rx*.8);
  const topHole=(top.curveDatums||[]).find(c=>Math.abs(c.u-.5)<.025&&c.v>.55&&c.rx<.15);
  const feet=(top.curveDatums||[]).filter(c=>Math.abs(c.v-.5)<.025&&(c.u<.2||c.u>.8)&&c.rx<.1);
  if(arches.length===2&&roof&&hole&&topHole&&feet.length===2) {
   const l=roof.u-roof.rx,r=roof.u+roof.rx,ends=hs(top).filter(a=>Math.min(...span(a))>=l-.025&&Math.max(...span(a))<=r+.025&&Math.abs(a.a[0]-a.b[0])>.07);
   const ys=unique(ends.map(a=>a.a[1])).filter(v=>v>.05&&v<.95&&[l,r].every(x=>vs(top).some(a=>Math.abs(mid(a)-x)<.015&&[a.a[1],a.b[1]].some(y=>Math.abs(y-v)<.015)))),base=hs(front).find(a=>a.a[1]>.6&&a.a[1]<.9&&Math.min(...span(a))<.15);
   if(ys.length===2&&base) {
    const rear=ys[0],step=ys[1],z=1-roof.v,h=1-base.a[1],R=arches[0].rx;
    const crown=hs(front).find(a=>a.a[1]>roof.v+.05&&a.a[1]<base.a[1]-.04&&Math.min(...span(a))>=l-.02&&Math.max(...span(a))<=r+.02);
    if(!crown)return out;
    // Rounded mounting ears are a stadium, united with the arch. Their
    // radius is measured by the outer plan span, not the mounting holes.
    const footWalls=vs(top).filter(a=>Math.abs(mid(a)-(roof.u-R))<.12||Math.abs(mid(a)-(roof.u+R))<.12);
    const footEnds=footWalls.flatMap(a=>[a.a[1],a.b[1]]).filter(v=>v>.1&&v<.9);
    const ft=Math.min(...footEnds),fb=Math.max(...footEnds),rad=(fb-ft)*s.y/s.x/2;
    const measuredR=Math.hypot((1-crown.a[1])*s.z,roof.rx),arch=Math.abs(measuredR-R)*front.sourceSize.w<1.5?{...arches[0],rx:measuredR}:arches[0];
    let corner=(top.curveDatums||[]).find(c=>(c.u<.2||c.u>.8)&&Math.abs(c.v-.5)>.04&&Math.abs(c.v-.5)<.2&&c.rx>.06&&c.rx<rad);
    if(!corner&&top.sourceMap){const [o,u,v]=top.sourceMap,ps=top.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||[]).map(p=>o.map((x,i)=>x+p[0]*(u[i]-x)+p[1]*(v[i]-x))).filter(p=>p[0]>.002&&p[0]<rad*.7&&p[1]>ft+.006&&p[1]<ft+(fb-ft)*.35).map(p=>[p[0]*1000,p[1]*1000*s.y/s.x]),fit=circleFit(ps,12);if(fit&&fit.error<.025&&fit.r/1000<rad&&fit.r/1000>.04&&Math.abs(fit.cx-fit.r)<5&&Math.abs(fit.cy-fit.r-ft*1000*s.y/s.x)<5)corner={rx:fit.r/1000};}
    const innerWalls=vs(top).filter(a=>Math.abs(a.a[1]-a.b[1])>.4&&mid(a)>.1&&mid(a)<.4),inner=innerWalls.length?Math.max(...innerWalls.map(mid)):undefined;
    if(rad>0&&rad<R&&corner&&inner) {
     const fR=corner.rx,ry=fR*s.x/s.y,points=[[inner,ft],[fR,ft]];
     for(let i=0;i<=48;i++){const a=-Math.PI/2-i*Math.PI/96;points.push([fR+fR*Math.cos(a),ft+ry+ry*Math.sin(a)]);}
     points.push([0,fb-ry]);
     for(let i=0;i<=48;i++){const a=Math.PI-i*Math.PI/96;points.push([fR+fR*Math.cos(a),fb-ry+ry*Math.sin(a)]);}
     points.push([inner,fb],[inner,ft]);
     const profiles=[points,points.map(([u,v])=>[1-u,v])].map(points=>({role:'top',points,lo:0,hi:h,meshOnly:true}));
     const corners=[fR,1-fR].flatMap(x=>[ft+ry,fb-ry].map(v=>({axis:'z',x,y:1-v,z:.5,r:fR,lo:0,hi:h,analyticOnly:true})));
     const feetBoxes=[box(fR,1-fR,1-fb,1-ft,0,h),box(0,1,1-fb+ry,1-ft-ry,0,h)].map(b=>({...b,analyticOnly:true}));
     // The middle strip joins the ears only inside the main arch; preserve
     // the measured square inner ends of the mounting pads in the mesh.
     out.push({family:'arch-lug-stepped-crown-drilled-feet',target:'side',components:[cylinder({...arch,v:1},0,1),cylinder(roof,1-rear,1),...corners],boxes:[box(l,r,1-rear,1,0,z),box(inner,1-inner,1-fb,1-ft,0,h),...feetBoxes],profiles,features:[bore('front',{...arches[1],v:1}),bore('front',hole,{axialRange:[1-rear,1]}),bore('top',topHole),...feet.map(c=>bore('top',c)),cut('top',rect(-.02,1.02,step,1.02),{kind:'pocket',depth:crown.a[1]})],explanation:['主视确定同心拱体、后部圆头立板及横孔；俯视两段横边分别限定板厚和前部削平台阶。','两端圆耳按实测外圆角和安装孔建模，竖孔与圆拱孔相交，保留真实相贯线。','左视按深度依次画立板、拱顶台阶和削平面；圆耳边遮挡拱孔，孔壁与相贯线分别判定虚实。']});
    }
   }
  }
 }
 return out;
}

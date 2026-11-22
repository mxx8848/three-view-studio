import { circleFit, maskLoops, simplify } from './upload-lines.js';
import { smoothProfile } from './upload-curves.js';
import { regularizeMeasuredContour } from './upload-contours.js';
import {recoverMeasuredPrimitives,recoverSupportedMeasuredArcs,joinMeasuredJunctions,measuredCircles,cleanPhotoPaths} from './upload-primitives.js';
import {joinMeasuredArcs,closeCircularRim,alignCurveOutline,fitClosedMeasuredRings,limitMeasuredDrift} from './upload-constraints.js';
import {refineForkDrawing} from './upload-fork-structure.js';

const rect=[[0,0],[1,0],[1,1],[0,1],[0,0]];
const length=points=>points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
const median=a=>a.sort((x,y)=>x-y)[Math.floor(a.length/2)];
export const viewSize=(size,role)=>[role==='side'?size.y:size.x,role==='top'?size.y:size.z];

function smoothNormalized(points,w,h) {
  const result=smoothProfile(points.map(p=>{const q=[p[0]*w,p[1]*h];if(p.curved)q.curved=true;return q;}),2);
  return result.points.map(p=>{const q=[p[0]/w,p[1]/h];if(p.curved)q.curved=true;return q;});
}

function solve(matrix,values) {
  const a=matrix.map((r,i)=>[...r,values[i]]),n=values.length;
  for(let col=0;col<n;col++) {
    let pivot=col;for(let i=col+1;i<n;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;
    if(Math.abs(a[pivot][col])<1e-10)return null;
    [a[col],a[pivot]]=[a[pivot],a[col]];const v=a[col][col];for(let j=col;j<=n;j++)a[col][j]/=v;
    for(let i=0;i<n;i++)if(i!==col){const v=a[i][col];for(let j=col;j<=n;j++)a[i][j]-=v*a[col][j];}
  }
  return a.map(r=>r[n]);
}

// Four straight outside edges define the photograph's projective distortion.
export function rectangleTransform(corners) {
  const matrix=[],values=[];
  corners.forEach(([x,y],i)=>{const [u,v]=rect[i];matrix.push([x,y,1,0,0,0,-u*x,-u*y]);values.push(u);matrix.push([0,0,0,x,y,1,-v*x,-v*y]);values.push(v);});
  const h=solve(matrix,values);if(!h)return null;
  return ([x,y])=>{const d=h[6]*x+h[7]*y+1;return [(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];};
}

function lineFit(segments,vertical) {
  let sw=0,sx=0,sy=0,sxx=0,sxy=0;
  for(const {a,b,len} of segments)for(const p of [a,b]){const x=p[vertical?1:0],y=p[vertical?0:1],w=len;sw+=w;sx+=w*x;sy+=w*y;sxx+=w*x*x;sxy+=w*x*y;}
  if(!sw)return null;const den=sw*sxx-sx*sx,m=Math.abs(den)>1e-8?(sw*sxy-sx*sy)/den:0;return {m,b:(sy-m*sx)/sw};
}

function drawingFrame(work,bounds,silhouette,inferred,partial=false) {
  // A closed interior cell must not shrink the drawing's coordinate frame.
  // Use the measured thick edges when they extend well beyond the filled cell;
  // the structural solver still has to explain all these edges independently.
  if(!inferred&&!partial) {
    const core=work.paths.filter(p=>p.lt==='v'&&p.length>3).flatMap(p=>p.points);
    if(core.length) {
      const lo=[0,1].map(i=>Math.min(...core.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...core.map(p=>p[i]))),span=hi.map((v,i)=>v-lo[i]);
      if(span[0]>bounds.w*1.45||span[1]>bounds.h*1.45) return {map:p=>p.map((v,i)=>(v-lo[i])/span[i]),type:'profile',outline:rect.map(p=>[...p]),expandedDatum:true,method:'按完整粗实线恢复坐标基准，局部封闭区域不代表整体外轮廓'};
    }
  }
  if(partial) {
    const visible=work.paths.filter(p=>p.lt==='v'&&p.length>3).flatMap(p=>p.points);
    if(visible.length) {
      const lo=[0,1].map(i=>Math.min(...visible.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...visible.map(p=>p[i])));
      // Thin reference axes can extend beyond an incomplete outline. Trim
      // those margins only when the surviving visible edges span both axes.
      if(hi[0]-lo[0]>bounds.w*.85&&hi[1]-lo[1]>bounds.h*.85)bounds={x:lo[0],y:lo[1],w:hi[0]-lo[0],h:hi[1]-lo[1]};
    }
    return {map:p=>[(p[0]-bounds.x)/bounds.w,(p[1]-bounds.y)/bounds.h],type:'partial',outline:[],method:'保留已有图线，补全缺失轮廓'};
  }
  if(inferred) {
    const points=work.paths.flatMap(p=>p.points),xs=points.map(p=>p[0]);
    const min=xs.length?Math.min(...xs):0,max=xs.length?Math.max(...xs):work.w;
    const center=(min+max)/2;
    return {map:p=>[(p[0]-center)/work.w+.5,p[1]/work.h],type:'inferred',outline:rect.map(p=>[...p]),method:'由另外两幅视图推导，保留参照线'};
  }
  const contour=maskLoops(silhouette.mask,silhouette.w,silhouette.h)[0],loop=contour?.points;
  const fit=loop&&circleFit(loop);
  const circularSpans=fit&&loop.slice(1).every((p,i)=>[.25,.5,.75].every(t=>{
    const q=loop[i],x=q[0]+t*(p[0]-q[0]),y=q[1]+t*(p[1]-q[1]);
    return Math.abs(Math.hypot(x-fit.cx,y-fit.cy)-fit.r)<Math.max(2,fit.r*.045);
  }));
  if(!inferred&&fit&&circularSpans&&fit.error<.045&&Math.abs(silhouette.w-silhouette.h)/Math.max(silhouette.w,silhouette.h)<.12) {
    // Filled silhouettes include the stroke's outer pixels. Anchor an
    // established round frame to its dense measured centreline instead, so
    // the rim, internal circles and cross-view dimensions use one metric.
    const measured=measuredCircles(work).filter(c=>c.spans.some(([a,b])=>b-a>Math.PI*1.95)&&Math.hypot(c.cx-bounds.x-fit.cx,c.cy-bounds.y-fit.cy)<3&&Math.abs(c.r-fit.r)<Math.max(3,(work.thickWidth||2)*2)).sort((a,b)=>b.r-a.r)[0];
    const center=measured?[measured.cx,measured.cy]:[bounds.x+fit.cx,bounds.y+fit.cy],r=measured?.r??fit.r;
    return {map:p=>[(p[0]-center[0])/(2*r)+.5,(p[1]-center[1])/(2*r)+.5],type:'circle',outline:Array.from({length:193},(_,i)=>[.5+.5*Math.cos(i*Math.PI/96),.5+.5*Math.sin(i*Math.PI/96)]),method:'圆形轮廓拟合'};
  }
  const segments=work.paths.filter(p=>p.lt==='v').flatMap(p=>p.points.slice(1).map((b,i)=>{const a=p.points[i];return {a,b,width:p.width,colored:p.colored,black:p.black,turning:[0,1].every(k=>Math.max(...p.points.map(q=>q[k]))-Math.min(...p.points.map(q=>q[k]))>Math.max(bounds.w,bounds.h)*.08),len:Math.hypot(b[0]-a[0],b[1]-a[1])};}));
  const horizontal=segments.filter(s=>Math.abs(s.b[1]-s.a[1])<Math.abs(s.b[0]-s.a[0])*.18&&s.len>bounds.w*.09);
  const vertical=segments.filter(s=>Math.abs(s.b[0]-s.a[0])<Math.abs(s.b[1]-s.a[1])*.18&&s.len>bounds.h*.09);
  const outer=(list,axis,start,span,end)=>list.filter(s=>Math.abs(((s.a[axis]+s.b[axis])/2-start)/span-end)<.12);
  const top=lineFit(outer(horizontal,1,bounds.y,bounds.h,0),false),bottom=lineFit(outer(horizontal,1,bounds.y,bounds.h,1),false);
  const left=lineFit(outer(vertical,0,bounds.x,bounds.w,0),true),right=lineFit(outer(vertical,0,bounds.x,bounds.w,1),true);
  const intersect=(h,v)=>{const x=(v.m*h.b+v.b)/(1-v.m*h.m);return [x,h.m*x+h.b];};
  const supported=(fit,segments,vertical)=>fit&&segments.every(s=>[s.a,s.b].every(p=>Math.abs(p[vertical?0:1]-fit.m*p[vertical?1:0]-fit.b)<Math.max(2,(work.thickWidth||1)*1.5)));
  if(top&&bottom&&left&&right&&supported(top,outer(horizontal,1,bounds.y,bounds.h,0),false)&&supported(bottom,outer(horizontal,1,bounds.y,bounds.h,1),false)&&supported(left,outer(vertical,0,bounds.x,bounds.w,0),true)&&supported(right,outer(vertical,0,bounds.x,bounds.w,1),true)&&contour?.area/(silhouette.w*silhouette.h)>.92) {
    const corners=[intersect(top,left),intersect(top,right),intersect(bottom,right),intersect(bottom,left)];
    if(corners.every(p=>p.every(Number.isFinite))&&corners[1][0]-corners[0][0]>bounds.w*.7&&corners[3][1]-corners[0][1]>bounds.h*.7) {
      const map=rectangleTransform(corners);
      if(map){const rectangle=contour?.area/(silhouette.w*silhouette.h)>.92;return {map,type:rectangle?'rectangle':'profile',outline:rectangle?rect.map(p=>[...p]):straightenPaths([{points:smoothNormalized((loop||rect).map(p=>map([p[0]+bounds.x,p[1]+bounds.y])),silhouette.w,silhouette.h)}])[0].points,method:'外框透视校正与直线约束'};}
    }
  }
  // Thin axes can be labelled visible at skeleton junctions. They must not
  // enlarge the frame if thick contour strokes already span both axes.
  // Raster widths are quantized (a 5-pixel modal stroke can have 3-pixel
  // straight cores after resizing). Keep those cores; 1-pixel axes must still
  // be excluded when a thick contour supplies the complete frame.
  const thick=segments.filter(s=>s.colored||s.width>=Math.max(2,Math.ceil(work.thickWidth*.8))||s.black&&s.turning&&s.len>Math.max(bounds.w,bounds.h)*.12).flatMap(s=>[s.a,s.b]);
  // At small black-line scales axes can have the same quantized width as
  // contours. A connected turning outline spanning the full drawing gives
  // stronger outside supports than isolated straight axis extensions.
  const turned=segments.filter(s=>s.black&&s.turning&&s.len>Math.max(bounds.w,bounds.h)*.08).flatMap(s=>[s.a,s.b]);
  if(turned.length&&[0,1].every(i=>Math.max(...turned.map(p=>p[i]))-Math.min(...turned.map(p=>p[i]))>[bounds.w,bounds.h][i]*.9)) {
    const lo=[0,1].map(i=>Math.min(...turned.map(p=>p[i]))),hi=[0,1].map(i=>Math.max(...turned.map(p=>p[i])));
    if(thick.some(p=>[0,1].some(i=>p[i]<lo[i]-2||p[i]>hi[i]+2))){thick.length=0;thick.push(...turned);}
  }
  const straightExtent=[0,1].map(i=>[Math.min(...thick.map(p=>p[i])),Math.max(...thick.map(p=>p[i]))]);
  const curvedExtent=[];
  // A raster arc can be thinner than adjacent straight strokes after scaling.
  // Its supported angular extrema still delimit the outside frame. Retain
  // only measured arc sectors; never extrapolate a short bend to a full ring.
  for(const c of measuredCircles(work))for(const [lo,hi] of c.spans)if(hi-lo>Math.PI/2) {
    const angles=[lo,hi];
    for(let k=Math.ceil(lo/(Math.PI/2));k*Math.PI/2<hi;k++)angles.push(k*Math.PI/2);
    const points=angles.map(a=>[c.cx+c.r*Math.cos(a),c.cy+c.r*Math.sin(a)]);
    // A fitted arc can overshoot an already measured tangent by a fraction
    // of the stroke width. Extend the frame only for a missing curved end,
    // rather than changing a complete straight-stroke datum by that noise.
    if(hi-lo>Math.PI*1.9)thick.push(...points);
    else curvedExtent.push(...points);
  }
  const uncertainty=Math.max(1,work.thickWidth*.5);
  if(curvedExtent.some(p=>[0,1].some(i=>p[i]<straightExtent[i][0]-uncertainty||p[i]>straightExtent[i][1]+uncertainty)))thick.push(...curvedExtent);
  const strong=thick.length&&[0,1].every(i=>Math.max(...thick.map(p=>p[i]))-Math.min(...thick.map(p=>p[i]))>[bounds.w,bounds.h][i]*.75);
  // A flood-filled cell can stop at an internal rib before a rounded nose.
  // Once thick measured strokes span both dimensions, retain their outside
  // extent too; clipping them to that cell truncates real arcs and changes
  // the common length scale of the two views.
  const visible=strong?thick:segments.flatMap(s=>[s.a,s.b]).filter(p=>p[0]>=bounds.x-3&&p[0]<=bounds.x+bounds.w+3&&p[1]>=bounds.y-3&&p[1]<=bounds.y+bounds.h+3);
  const x0=visible.length?Math.min(...visible.map(p=>p[0])):bounds.x,y0=visible.length?Math.min(...visible.map(p=>p[1])):bounds.y;
  const w=visible.length?Math.max(...visible.map(p=>p[0]))-x0:bounds.w,h=visible.length?Math.max(...visible.map(p=>p[1]))-y0:bounds.h;
  const map=p=>[(p[0]-x0)/Math.max(1,w),(p[1]-y0)/Math.max(1,h)];
  const outline=loop?smoothNormalized(loop.map(p=>map([p[0]+bounds.x,p[1]+bounds.y])),w,h):rect;
  return {map,type:'profile',outline,method:'局部直线与端点校正'};
}

// Snap only near-axis straight segments. A true incline or a circular arc is retained.
export function straightenPaths(paths,tolerance=.018) {
  const groups=[[],[]],copies=new Map(),key=p=>p.map(v=>v.toFixed(8)).join(',');
  for(const path of paths.filter(p=>!p.arc))for(const p of path.points){const k=key(p);if(!copies.has(k))copies.set(k,[]);copies.get(k).push(p);}
  for(const p of paths.filter(p=>!p.arc))for(let i=1;i<p.points.length;i++) {
    const a=p.points[i-1],b=p.points[i],dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
    if(a.curved||b.curved)continue;
    const axis=dx<dy*.18?0:dy<dx*.18?1:-1;if(axis<0)continue;
    const value=(a[axis]+b[axis])/2;let group=groups[axis].find(g=>Math.abs(g.value-value)<tolerance);
    if(!group){group={value,values:[],points:new Set()};groups[axis].push(group);}group.values.push({value,weight:Math.hypot(dx,dy)});for(const p of [...copies.get(key(a)),...copies.get(key(b))])group.points.add(p);
    // Long measured edges anchor the coordinate. Numerous short dash fragments
    // must not pull a wall away from its visible outline.
    const sorted=[...group.values].sort((a,b)=>a.value-b.value),half=sorted.reduce((s,v)=>s+v.weight,0)/2;
    let sum=0;for(const v of sorted){sum+=v.weight;if(sum>=half){group.value=v.value;break;}}
  }
  for(let axis=0;axis<2;axis++)for(const g of groups[axis]) {
    const value=Math.abs(g.value)<tolerance?0:Math.abs(g.value-1)<tolerance?1:g.value;
    for(const p of g.points)p[axis]=value;
  }
  return paths;
}

// Skeleton junctions split a straight incline into separate paths. Fit their
// shared run, then move every copy of the junction (including its branch).
export function straightenJunctions(paths,tolerance=.006) {
  const key=p=>p.map(v=>v.toFixed(8)).join(','),nodes=new Map(),protectedNodes=new Set(),segments=[];
  for(const path of paths)for(const p of path.points) {
    const k=key(p);if(!nodes.has(k))nodes.set(k,[]);nodes.get(k).push(p);
    if(path.arc||p.curved)protectedNodes.add(k);
  }
  for(const path of paths.filter(p=>!p.arc&&p.lt!=='ignore'))for(let i=1;i<path.points.length;i++) {
    const a=path.points[i-1],b=path.points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(a.curved||b.curved||len<.04)continue;
    segments.push({a:[...a],b:[...b],keys:[key(a),key(b)],lt:path.lt});
  }
  const groups=[];
  for(const s of segments) {
    const group=groups.find(g=>g.some(t=>{
      if(t.lt!==s.lt||!t.keys.some(k=>s.keys.includes(k)))return false;
      const u=[s.b[0]-s.a[0],s.b[1]-s.a[1]],v=[t.b[0]-t.a[0],t.b[1]-t.a[1]];
      return Math.abs(u[0]*v[1]-u[1]*v[0])<Math.hypot(...u)*Math.hypot(...v)*.045;
    }));
    if(group)group.push(s);else groups.push([s]);
  }
  for(const group of groups.filter(g=>g.length>1)) {
    const points=group.flatMap(s=>[s.a,s.b]);let a,b,longest=0;
    for(const p of points)for(const q of points){const d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d>longest){longest=d;a=p;b=q;}}
    const dx=b[0]-a[0],dy=b[1]-a[1],project=(p,k)=>{
      const branches=segments.filter(s=>!group.includes(s)&&s.keys.includes(k));
      if(Math.abs(dx)>1e-8&&branches.some(s=>Math.abs(s.a[0]-s.b[0])<1e-8))return [p[0],a[1]+(p[0]-a[0])*dy/dx];
      if(Math.abs(dy)>1e-8&&branches.some(s=>Math.abs(s.a[1]-s.b[1])<1e-8))return [a[0]+(p[1]-a[1])*dx/dy,p[1]];
      const t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(longest*longest);return [a[0]+t*dx,a[1]+t*dy];
    };
    const keys=new Set(group.flatMap(s=>s.keys));
    if([...keys].some(k=>{const p=nodes.get(k)[0],q=project(p,k),d=Math.hypot(q[0]-p[0],q[1]-p[1]);return d>tolerance||protectedNodes.has(k)&&d>1e-8;}))continue;
    for(const k of keys){const q=project(nodes.get(k)[0],k);for(const p of nodes.get(k)){p[0]=q[0];p[1]=q[1];}}
  }
  return paths;
}

// The raster fill follows stroke *edges*, while the drawing follows stroke
// centers. Use the measured straight spans for the solid too, intersecting
// neighbouring supports so the corrected perimeter stays closed.
export function alignOutlineToPaths(outline,paths,tolerance=.012) {
  const closed=outline.length>3&&Math.hypot(outline[0][0]-outline.at(-1)[0],outline[0][1]-outline.at(-1)[1])<1e-8;
  if(!closed)return outline;
  const points=outline.slice(0,-1),supports=[];
  const segments=paths.filter(p=>p.lt==='v'&&!p.arc).flatMap(p=>p.points.slice(1).map((b,i)=>[p.points[i],b])).filter(([a,b])=>!a.curved&&!b.curved);
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],u=[b[0]-a[0],b[1]-a[1]],len=Math.hypot(...u);
    let best=null;
    if(!a.curved&&!b.curved&&len>.025)for(const [c,d] of segments) {
      const v=[d[0]-c[0],d[1]-c[1]],l=Math.hypot(...v);if(l<.025)continue;
      if(Math.abs(u[0]*v[1]-u[1]*v[0])>len*l*.035)continue;
      const distance=p=>Math.abs((p[0]-c[0])*v[1]-(p[1]-c[1])*v[0])/l;
      const error=Math.max(distance(a),distance(b));if(error>tolerance)continue;
      const t=points=>((points[0]-c[0])*v[0]+(points[1]-c[1])*v[1])/(l*l);
      if(Math.max(Math.min(t(a),t(b)),0)>=Math.min(Math.max(t(a),t(b)),1))continue;
      if(!best||error<best.error)best={a:c,u:v,error};
    }
    supports.push(best||{a,u});
  }
  const result=points.map((p,i)=>{
    if(p.curved)return p;
    const prev=supports[(i+points.length-1)%points.length],next=supports[i],u=prev.u,v=next.u;
    const det=u[0]*v[1]-u[1]*v[0];if(Math.abs(det)<1e-10)return p;
    const dx=next.a[0]-prev.a[0],dy=next.a[1]-prev.a[1],t=(dx*v[1]-dy*v[0])/det;
    const q=[prev.a[0]+t*u[0],prev.a[1]+t*u[1]];
    return Math.hypot(q[0]-p[0],q[1]-p[1])<tolerance*3?q:p;
  });
  return [...result,[...result[0]]];
}

function arcPoints(points,circle,aspect) {
  const {u,v,r}=circle,ry=r*aspect;
  const distances=points.map(p=>Math.abs(Math.hypot(p[0]-u,(p[1]-v)/aspect)-r));
  if(distances.filter(d=>d<.035).length<points.length*.75)return null;
  if(points.slice(1).some((b,i)=>[.25,.5,.75].some(t=>{
    const a=points[i],x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]);
    return Math.abs(Math.hypot(x-u,(y-v)/aspect)-r)>.015;
  })))return null;
  const angles=points.map(p=>Math.atan2((p[1]-v)/ry,(p[0]-u)/r));
  for(let i=1;i<angles.length;i++){while(angles[i]-angles[i-1]>Math.PI)angles[i]-=2*Math.PI;while(angles[i]-angles[i-1]<-Math.PI)angles[i]+=2*Math.PI;}
  const from=angles[0],to=angles.at(-1),span=to-from;
  if(points.length===2&&Math.abs(span)>.65)return null;
  if(Math.abs(span)<.08)return null;
  const steps=Math.max(2,Math.ceil(Math.abs(span)*48));
  return Array.from({length:steps+1},(_,i)=>{const a=from+span*i/steps;return [u+r*Math.cos(a),v+ry*Math.sin(a)];});
}

function regularizeSlots(features,size) {
  for(const f of features.filter(f=>f.profile&&!f.structural)) {
    const [a,b]=viewSize(size,f.role),aspect=a/b,p=f.profile;
    const linked=features[f.joinedCircle];
    if(linked&&!linked.profile&&linked.role===f.role&&f.slotEdge!==undefined) {
      const x0=Math.min(f.slotEdge,linked.u),x1=Math.max(f.slotEdge,linked.u),ry=linked.r*aspect;
      f.profile=[[x0,linked.v-ry],[x1,linked.v-ry],[x1,linked.v+ry],[x0,linked.v+ry],[x0,linked.v-ry]];continue;
    }
    const lo=[Math.min(...p.map(q=>q[0])),Math.min(...p.map(q=>q[1]))],hi=[Math.max(...p.map(q=>q[0])),Math.max(...p.map(q=>q[1]))];
    for(const [index,c] of features.entries()) {
      if(c===f||c.profile||c.role!==f.role)continue;
      const ry=c.r*aspect;
      const near=p.filter(q=>Math.abs(Math.hypot(q[0]-c.u,(q[1]-c.v)/aspect)-c.r)<.04).length;
      const left=lo[0]<c.u-c.r*.8&&hi[0]<c.u+c.r*.25,right=hi[0]>c.u+c.r*.8&&lo[0]>c.u-c.r*.25;
      if(near<3||!left&&!right||Math.abs((lo[1]+hi[1])/2-c.v)>.06||Math.abs(hi[1]-lo[1]-2*ry)>.12)continue;
      const x=left?lo[0]:hi[0],x0=Math.min(x,c.u),x1=Math.max(x,c.u),y0=c.v-ry,y1=c.v+ry;
      f.profile=[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];f.joinedCircle=index;f.slotEdge=x;
      f.regularization='槽壁取直，与圆孔共用相切位置；切削区域重叠，消除薄壁';
      break;
    }
    if(f.joinedCircle===undefined){const ps=straightenPaths([{points:f.profile.map(q=>[...q])}]);f.profile=ps[0].points;}
  }
}

// Apply guide constraints after perimeter fitting, which can move junctions.
// Match measured runs to a datum; never translate a whole bent path or snap
// an unrelated edge merely because its endpoint is close to another endpoint.
export function alignDrawingGuides(drawing,features,tolerance=.018) {
  for(const role of ['front','top','side']) {
    const work=drawing[role];if(work.type==='inferred')continue;
    const anchors=[[],[]],copies=new Map(),key=p=>p.map(v=>v.toFixed(8)).join(',');
    const add=(axis,value,lo=-Infinity,hi=Infinity,priority=0)=>anchors[axis].push({value,lo,hi,priority});
    for(const path of work.paths.filter(p=>['t','h','c'].includes(p.lt)))for(const p of path.points){const k=key(p);if(!copies.has(k))copies.set(k,[]);copies.get(k).push(p);}
    for(const path of work.paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i];
      for(const axis of [0,1])if(!a.curved&&!b.curved&&Math.abs(a[axis]-b[axis])<1e-7&&Math.abs(a[1-axis]-b[1-axis])>.06)
        add(axis,a[axis],Math.min(a[1-axis],b[1-axis]),Math.max(a[1-axis],b[1-axis]));
    }
    for(const f of features.filter(f=>!f.profile)) {
      if(f.role===role){add(0,f.u,-Infinity,Infinity,1);add(1,f.v,-Infinity,Infinity,1);}
      else if(f.role==='top'&&role==='front')add(0,f.u,-Infinity,Infinity,1);
      else if(f.role==='top'&&role==='side')add(0,f.v,-Infinity,Infinity,1);
      else if(f.role==='front'&&role==='top')add(0,f.u,-Infinity,Infinity,1);
      else if(f.role==='front'&&role==='side')add(1,f.v,-Infinity,Infinity,1);
      else if(f.role==='side'&&role==='front')add(1,f.v,-Infinity,Infinity,1);
      else if(f.role==='side'&&role==='top')add(1,f.u,-Infinity,Infinity,1);
    }
    for(const c of work.curveDatums||[]){add(0,c.u,-Infinity,Infinity,2);add(1,c.v,-Infinity,Infinity,2);}
    // Keep a measured straight guide as one constraint. Junction copies can
    // otherwise receive different anchors from neighbouring short segments.
    const straightGuides=work.paths.filter(p=>['t','c'].includes(p.lt)&&!p.arc&&!p.points.some(q=>q.curved)).flatMap(path=>[0,1].flatMap(axis=>{
      const span=a=>Math.max(...path.points.map(p=>p[a]))-Math.min(...path.points.map(p=>p[a]));
      return span(axis)<.012&&span(1-axis)>.06?[{path,axis}]:[];
    }));
    const moves=[];
    for(const path of work.paths.filter(p=>['t','h','c'].includes(p.lt)))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i];
      for(const axis of [0,1]) {
        if(Math.abs(a[axis]-b[axis])>.01||Math.abs(a[1-axis]-b[1-axis])<.012)continue;
        const value=(a[axis]+b[axis])/2,lo=Math.min(a[1-axis],b[1-axis]),hi=Math.max(a[1-axis],b[1-axis]);
        const anchor=anchors[axis].filter(s=>Math.abs(s.value-value)<tolerance&&hi>=s.lo-tolerance&&lo<=s.hi+tolerance)
          .sort((a,b)=>b.priority-a.priority||Math.abs(a.value-value)-Math.abs(b.value-value))[0];
        if(anchor)for(const p of [a,b])moves.push({points:copies.get(key(p)),axis,value:anchor.value});
      }
    }
    for(const {points,axis,value} of moves)for(const p of points)p[axis]=value;
    for(const {path,axis} of straightGuides) {
      const value=median(path.points.map(p=>p[axis]));
      for(const p of path.points)p[axis]=value;
    }
  }
}

export function alignLengthDatums(drawing,datums,tolerance=.025) {
  for(const role of ['front','top']) {
    const work=drawing[role];if(work.type==='inferred')continue;
    const moves=new Map(),key=p=>p.map(v=>v.toFixed(8)).join(',');
    const snap=p=>{
      if(p.curved)return;
      const value=datums.filter(x=>Math.abs(x-p[0])<tolerance).sort((a,b)=>Math.abs(a-p[0])-Math.abs(b-p[0]))[0];
      if(value!==undefined)moves.set(key(p),value);
    };
    // A shoulder is often the end of a horizontal run in one view and a
    // vertical wall in the other. Register both representations to one datum.
    for(const path of work.paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i],dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
      if(!a.curved&&!b.curved&&(dx>.06&&dy<.006||dy>.06&&dx<.006)){snap(a);snap(b);}
    }
    for(const path of [...work.paths.filter(p=>!p.arc),{points:work.outline||[]}])for(const p of path.points) {
      const value=moves.get(key(p));if(value!==undefined&&!p.curved)p[0]=value;
    }
  }
}

// A measured semicircular crown concentric with an inner circle supplies a
// common shoulder height. Fit this relation only when the actual upper rim
// supports it; the cylinder and all adjoining lines then use the same datum.
export function alignConcentricCrown(work,features,size) {
  if(!work.contourRegularized)return [];
  const aspect=size.x/size.z;
  for(const f of features.filter(f=>f.role==='front'&&!f.profile)) {
    const ring=work.outline.slice(0,-1),upper=ring.filter(p=>p[1]<f.v+.025);
    if(upper.length<12)continue;
    const fit=circleFit(upper.map(p=>[p[0],p[1]/aspect]));
    if(!fit||fit.error>.025||Math.hypot(fit.cx-f.u,fit.cy-f.v/aspect)>.025||fit.r<f.r*1.4||fit.r>f.r*3)continue;
    const on=ring.map(p=>p[1]<f.v+.025&&Math.abs(Math.hypot(p[0]-fit.cx,p[1]/aspect-fit.cy)-fit.r)<.025);
    const start=on.findIndex((value,i)=>value&&!on[(i+on.length-1)%on.length]);if(start<0)continue;
    let end=start;while(on[(end+1)%on.length]&&(end+1)%on.length!==start)end=(end+1)%on.length;
    const a=ring[start],b=ring[end];if(Math.abs(a[0]-b[0])<fit.r*1.7)continue;
    const left=f.u-fit.r,right=f.u+fit.r,forward=a[0]<b[0];
    const arc=Array.from({length:129},(_,i)=>{const angle=forward?Math.PI+i*Math.PI/128:-i*Math.PI/128,p=[f.u+fit.r*Math.cos(angle),f.v+fit.r*aspect*Math.sin(angle)];p.curved=true;return p;});
    const rest=[];for(let i=(end+1)%ring.length;i!==start;i=(i+1)%ring.length)rest.push([...ring[i]]);
    const outline=[...arc,...rest,[...arc[0]]];
    // Replace the measured perimeter as a whole, keeping internal walls and
    // their shared endpoints. This prevents a second, offset incline.
    const paths=work.paths.filter(p=>!p.perimeter);
    const old=[a,b].map((p,i)=>({x:p[0],next:forward?(i?right:left):(i?left:right)}));
    for(const path of paths.filter(p=>!p.arc))for(const p of path.points) {
      for(const datum of old)if(Math.abs(p[0]-datum.x)<.02){p[0]=datum.next;if(Math.abs(p[1]-f.v)<.03)p[1]=f.v;}
    }
    for(const p of outline)if(!p.curved)for(const datum of old)if(Math.abs(p[0]-datum.x)<.02)p[0]=datum.next;
    // The lower end of an incline shares the base ledge's height. Contour
    // cleanup can move that corner even while its internal horizontal survives.
    for(const p of outline.filter(p=>!p.curved))for(const path of paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i];
      if(Math.abs(a[1]-b[1])<1e-7&&Math.abs(a[0]-b[0])>.06&&Math.abs(p[1]-a[1])<.04&&Math.min(Math.abs(p[0]-a[0]),Math.abs(p[0]-b[0]))<.025)p[1]=a[1];
    }
    work.outline=outline;
    work.paths=[...paths,{id:Math.max(...work.paths.map(p=>p.id))+1,lt:'v',width:work.thickWidth||2,length:length(outline),points:outline.map(p=>[...p]),perimeter:true}];
    return [left,right];
  }
  return [];
}

export function regularizeUploadDrawing(recon,linework,{mapFeatures=false}={}) {
  // A completion target can be marked partial after fitting. Keep its measured
  // coordinate frame on refresh; changing the lesson state must not move ink.
  const frames=Object.fromEntries(['front','top','side'].map(role=>{
    const f=recon.sectionFrames?.[role];
    return [role,f?{map:p=>[(p[0]-f.x)/f.w,(p[1]-f.y)/f.h],type:'profile',outline:f.outline,method:'密集源线拟合斜边，求相邻支撑线的交点'}:drawingFrame(linework[role],recon.silhouetteBounds[role],recon.silhouettes[role],recon.inferredRoles.includes(role),!recon.viewStates?.[role]?.closedFrame&&(recon.profileStructureFit?.frameKinds?.[role]??recon.viewStates?.[role]?.kind)==='partial')];
  }));
  // A surviving edge's endpoints are NOT the bounds of the missing object.
  // Transfer the two aligned sheet axes directly; depth changes orientation
  // at the 45-degree line and needs an observed full span to set its origin.
  for(const role of recon.inferredRoles){
    const state=recon.viewStates?.[role],box=recon.roles?.[role];
    if(!box?.partial||state?.kind!=='partial')continue;
    delete state.registered;
    const sources={front:[['top',0],['side',1]],top:[['front',0],['side',0]],side:[['top',1],['front',1]]}[role];
    const datums=sources.map(([other,axis],k)=>{
      if(linework[other].photoCorrection||linework[role].photoCorrection||recon.viewStates[other].kind!=='complete')return null;
      const f=frames[other].map,o=f([0,0]),a=f([1,0]),b=f([0,1]),step=axis?b[axis]-o[axis]:a[axis]-o[axis];
      if(step<=0||Math.abs((axis?a:b)[axis]-o[axis])>step*.005)return null;
      const span=1/step,pos=['x','y'][k];
      if(k===axis)return {span,origin:Math.floor(recon.roles[other][pos])-o[axis]/step-Math.floor(box[pos])};
      const observed=state.bounds[k?'h':'w'];
      return Math.abs(span-observed)<=2.25?{span,origin:state.bounds[pos]}:null;
    });
    if(datums.some(d=>!d))continue;
    const map=p=>p.map((v,i)=>(v-datums[i].origin)/datums[i].span);
    if(linework[role].paths.filter(p=>['v','h'].includes(p.lt)).some(p=>p.points.some(q=>map(q).some((v,k)=>v< -2.25/datums[k].span||v>1+2.25/datums[k].span))))continue;
    frames[role]={...frames[role],map,method:'从已知视图转移完整尺寸，按原图位置保留残线'};state.registered=true;
  }
  if(mapFeatures)for(const f of recon.features) {
    const bounds=recon.silhouetteBounds[f.role],frame=frames[f.role],raw=q=>[bounds.x+q[0]*bounds.w,bounds.y+q[1]*bounds.h];
    if(f.profile){f.profile=f.profile.map(q=>frame.map(raw(q)));if(f.role==='top'&&f.depth){const fb=recon.silhouetteBounds.front;f.depth=frames.front.map([fb.x+fb.w*.5,fb.y+fb.h*f.depth])[1];}}
    else {
      const [a,b]=viewSize(recon.modelSize,f.role),cx=bounds.x+f.u*bounds.w,cy=bounds.y+f.v*bounds.h,r=f.r*bounds.w;
      const samples=Array.from({length:48},(_,i)=>{const p=frame.map([cx+r*Math.cos(i*Math.PI/24),cy+r*Math.sin(i*Math.PI/24)]);return [p[0]*a,p[1]*b];});
      const fit=circleFit(samples);if(fit){f.u=fit.cx/a;f.v=fit.cy/b;f.r=fit.r/a;}
      if(Math.abs(f.v-.5)<.035)f.v=.5;if(Math.abs(f.u-.5)<.02)f.u=.5;
    }
  }
  regularizeSlots(recon.features,recon.modelSize);
  const drawing={};
  for(const role of ['front','top','side']) {
    const work=linework[role],frame=frames[role],[a,b]=viewSize(recon.modelSize,role),aspect=a/b;
    const circles=recon.features.filter(f=>f.role===role&&!f.profile&&f.kind!=='unknown');
    if(frame.type==='circle')circles.push({u:.5,v:.5,r:.5});
    const measuredPaths=cleanPhotoPaths(structuredClone(work.paths),work);fitClosedMeasuredRings(measuredPaths);
    const paths=measuredPaths.map(path=>{
      // Fit measured curves in source pixel coordinates. The normalized frame
      // can stretch X/Y independently; fitting there can turn circles into
      // incorrect arcs and discard their tangency before snapping straight runs.
      const span=axis=>Math.max(...path.points.map(p=>p[axis]))-Math.min(...path.points.map(p=>p[axis]));
      const axis=span(0)<2&&span(1)>10?0:span(1)<2&&span(0)>10?1:-1;
      const measured=axis>=0?[path.points[0],path.points.at(-1)].map(p=>{const q=[...p];q[axis]=path.points.reduce((s,p)=>s+p[axis],0)/path.points.length;return q;}):path.lt==='ignore'?path.points:smoothProfile(path.points,Math.max(work.w,work.h)<=210?1:2,{measuredPoints:path.measuredPoints,strokeWidth:path.width}).points;
      let points=measured.map(p=>{const q=frame.map(p);if(p.curved)q.curved=true;return q;}),arc=!!path.measuredRing,circleIndex=-1;
      if(path.lt==='v')for(const [i,c] of circles.entries()){const projected=arcPoints(points,c,aspect);if(projected){points=projected;arc=true;circleIndex=i;break;}}
      return {...path,lt:frame.type==='inferred'&&path.lt!=='ignore'?'c':path.lt,points,arc,circleIndex};
    });
    straightenPaths(paths);
    if(frame.type==='rectangle') {
      for(const path of paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<path.points.length;i++) {
        const a=path.points[i-1],b=path.points[i];
        for(const axis of [0,1])if(Math.abs(a[axis]-b[axis])<1e-7&&Math.abs(a[1-axis]-b[1-axis])>.06) {
          const value=(a[axis]+b[axis])/2,datum=Math.abs(value)<.03?0:Math.abs(value-1)<.03?1:undefined;
          if(datum!==undefined)for(const p of paths.flatMap(p=>p.points))if(Math.abs(p[axis]-value)<1e-7)p[axis]=datum;
        }
      }
    }
    straightenJunctions(paths);
    // A circular end face supplies the shaft axis. Thin near-axis strokes are
    // rectified separately from outlines and hidden hole walls.
    const shaft=recon.silhouettes.side&&frames.side.type==='circle';
    const axes=role==='side'&&frame.type==='circle'?[[0,.5],[1,.5]]:
      role==='front'&&shaft?[[1,.5]]:
      role==='top'&&shaft?[[1,.5]]:[];
    for(const [axis,value] of axes)for(const p of paths.filter(p=>p.lt==='t'||p.lt==='c')) {
      const other=1-axis,span=Math.max(...p.points.map(q=>q[other]))-Math.min(...p.points.map(q=>q[other]));
      if(span<.035||!p.points.every(q=>Math.abs(q[axis]-value)<.055))continue;
      for(const q of p.points)q[axis]=value;
      p.lt='c';
    }
    // Share the same hole-wall coordinates between corresponding views.
    for(const f of recon.features.filter(f=>!f.profile&&f.role==='front'&&f.kind==='through')) {
      if(role==='front')continue;
      const axis=role==='side'?1:0,center=axis?f.v:f.u,radius=f.r*(axis?recon.modelSize.x/recon.modelSize.z:1);
      for(const p of paths.filter(p=>['h','t'].includes(p.lt)&&!p.arc))for(let i=1;i<p.points.length;i++) {
        const a=p.points[i-1],b=p.points[i];if(Math.abs(a[axis]-b[axis])>.02||Math.abs(a[1-axis]-b[1-axis])<.012)continue;
        for(const value of [center-radius,center+radius])if(Math.abs((a[axis]+b[axis])/2-value)<.035)a[axis]=b[axis]=value;
      }
    }
    for(const f of recon.features.filter(f=>!f.profile&&f.role==='top'&&f.kind!=='unknown')) {
      const targets=role==='front'?[f.u-f.r,f.u+f.r]:role==='side'?[1-f.v-f.r*recon.modelSize.x/recon.modelSize.y,1-f.v+f.r*recon.modelSize.x/recon.modelSize.y]:[];
      for(const p of paths.filter(p=>!p.arc))for(let i=1;i<p.points.length;i++) {
        const a=p.points[i-1],b=p.points[i];if(a.curved||b.curved||Math.abs(a[0]-b[0])>.02||Math.abs(a[1]-b[1])<.012)continue;
        for(const x of targets)if(Math.abs((a[0]+b[0])/2-x)<.045)a[0]=b[0]=x;
      }
    }
    if(role==='front')for(const f of recon.features.filter(f=>f.profile&&f.role==='top'&&f.kind==='pocket')) {
      const x0=Math.min(...f.profile.map(p=>p[0])),x1=Math.max(...f.profile.map(p=>p[0]));
      for(const p of paths.filter(p=>!p.arc&&p.lt!=='v'))for(let i=1;i<p.points.length;i++) {
        const a=p.points[i-1],b=p.points[i];if(Math.abs(a[1]-b[1])<.02&&Math.abs((a[1]+b[1])/2-f.depth)<.04&&Math.min(a[0],b[0])>=x0-.04&&Math.max(a[0],b[0])<=x1+.05)a[1]=b[1]=f.depth;
      }
    }
    for(const f of recon.features.filter(f=>f.role===role&&f.joinedCircle!==undefined)) {
      const c=recon.features[f.joinedCircle];if(!c||c.profile)continue;
      const x0=Math.min(...f.profile.map(q=>q[0])),x1=Math.max(...f.profile.map(q=>q[0])),y0=f.profile[0][1],y1=f.profile[2][1];
      for(const p of paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<p.points.length;i++) {
        const a=p.points[i-1],b=p.points[i],dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]);
        if(dy<.025&&dx>.08&&Math.min(a[0],b[0])>=x0-.04&&Math.max(a[0],b[0])<=x1+.05) {
          const y=(a[1]+b[1])/2;if(Math.min(Math.abs(y-y0),Math.abs(y-y1))<.07){a[1]=b[1]=Math.abs(y-y0)<Math.abs(y-y1)?y0:y1;const left=a[0]<b[0]?a:b,right=left===a?b:a;left[0]=x0;right[0]=x1;}
        }
        if(dx<.025&&dy>.08&&Math.min(Math.abs(a[0]-x0),Math.abs(a[0]-x1))<.04){const x=Math.abs(a[0]-x0)<Math.abs(a[0]-x1)?x0:x1;if(Math.abs(x-c.u)>.02){a[0]=b[0]=x;const top=a[1]<b[1]?a:b,bottom=top===a?b:a;if(Math.abs(top[1]-y0)<.07)top[1]=y0;if(Math.abs(bottom[1]-y1)<.07)bottom[1]=y1;}}
      }
    }
    for(const p of paths){p.length=length(p.points)*Math.max(work.w,work.h);if(!p.arc&&!p.points.some(q=>q.curved))p.points=simplify(p.points,.001);}
    for(const [index,c] of circles.entries()) {
      const arcs=paths.filter(p=>p.arc&&p.circleIndex===index);
      // A partial circle connected to a slot must remain partial. Only close
      // it when the measured arcs cover nearly the entire circumference.
      const coverage=new Set();
      for(const path of arcs)for(const p of path.points)coverage.add(Math.floor(((Math.atan2((p[1]-c.v)/aspect,p[0]-c.u)+Math.PI*2)%(Math.PI*2))/(Math.PI*2)*72));
      if(coverage.size<70)continue;
      const first=arcs[0];first.points=Array.from({length:193},(_,i)=>[c.u+c.r*Math.cos(i*Math.PI/96),c.v+c.r*aspect*Math.sin(i*Math.PI/96)]);
      for(const p of arcs.slice(1))p.mergedInto=first.id;
    }
    const curveDatums=joinMeasuredArcs(paths,work.w,work.h);
    drawing[role]={...work,w:1,h:1,sourceSize:{w:work.w,h:work.h},sourceMap:[frame.map([0,0]),frame.map([1,0]),frame.map([0,1])],expandedDatum:frame.expandedDatum,paths:paths.filter(p=>p.mergedInto===undefined),curveDatums,outline:frame.outline,type:frame.type,method:frame.method};
    closeCircularRim(drawing[role]);
  }
  // Front/top length coordinates are shared after rectification.
  const refs=[];
  for(const role of ['front','top']) {
    const key=p=>p.map(v=>v.toFixed(8)).join(','),copies=new Map();
    for(const path of drawing[role].paths)for(const p of path.points){const k=key(p);if(!copies.has(k))copies.set(k,[]);copies.get(k).push(p);}
    for(const p of drawing[role].paths.filter(p=>!p.arc&&p.lt==='v'))for(let i=1;i<p.points.length;i++)if(Math.abs(p.points[i][0]-p.points[i-1][0])<.002&&Math.abs(p.points[i][1]-p.points[i-1][1])>.07)refs.push({x:p.points[i][0],points:[...copies.get(key(p.points[i-1])),...copies.get(key(p.points[i]))]});
  }
  const clusters=[];for(const ref of refs){let g=clusters.find(g=>Math.abs(g.x-ref.x)<.025);if(!g){g={x:ref.x,refs:[]};clusters.push(g);}g.refs.push(ref);g.x=median(g.refs.map(r=>r.x));}
  for(const g of clusters)for(const ref of g.refs)for(const p of ref.points)p[0]=g.x;
  for(const role of ['front','top','side'])if(drawing[role].type==='profile') {
    drawing[role].outline=alignOutlineToPaths(drawing[role].outline,drawing[role].paths);
    regularizeMeasuredContour(drawing[role],linework[role].w,linework[role].h);
  }
  for(const f of recon.features.filter(f=>f.profile&&!f.structural&&['front','top'].includes(f.role)))for(const g of clusters) {
    for(const p of f.profile)if(Math.abs(p[0]-g.x)<.025)p[0]=g.x;
    if(f.slotEdge!==undefined&&Math.abs(f.slotEdge-g.x)<.025)f.slotEdge=g.x;
  }
  alignLengthDatums(drawing,clusters.map(g=>g.x));
  const crownDatums=alignConcentricCrown(drawing.front,recon.features,recon.modelSize);
  if(crownDatums.length)alignLengthDatums(drawing,crownDatums);
  for(const work of Object.values(drawing))alignCurveOutline(work);
  alignDrawingGuides(drawing,recon.features);
  for(const role of ['front','top','side']) {
    const work=drawing[role];
    if(work.type!=='inferred')limitMeasuredDrift(work,linework[role].paths.map(p=>({...p,points:p.points.map(frames[role].map)})),linework[role].w,linework[role].h,Math.max(2,(linework[role].thickWidth||1)*1.5));
    if(!['inferred','partial'].includes(work.type)) {
      const measured=recoverMeasuredPrimitives(linework[role])||recoverSupportedMeasuredArcs(linework[role]);
      if(measured) {
        work.paths=measured.paths.map(path=>({...path,points:path.points.map(p=>{const q=frames[role].map(p);if(p.curved)q.curved=true;return q;})}));
        straightenPaths(work.paths,.004);
        work.curveDatums=measured.circles.map((c,index)=>{const p=frames[role].map([c.cx,c.cy]),x=frames[role].map([c.cx+c.r,c.cy]),y=frames[role].map([c.cx,c.cy+c.r]);return {u:p[0],v:p[1],rx:Math.abs(x[0]-p[0]),ry:Math.abs(y[1]-p[1]),ids:work.paths.filter(p=>p.measuredCircle===index).map(p=>p.id)};});
        for(const path of work.paths.filter(p=>p.measuredPrimitive)) {
          const c=measured.circles[path.measuredCircle],datum=work.curveDatums[path.measuredCircle],source=measured.paths.find(p=>p.id===path.id);
          path.points=source.points.map(p=>{const angle=Math.atan2(p[1]-c.cy,p[0]-c.cx),q=[datum.u+datum.rx*Math.cos(angle),datum.v+datum.ry*Math.sin(angle)];q.curved=true;return q;});
          const angles=source.points.map(p=>Math.atan2(p[1]-c.cy,p[0]-c.cx));
          for(let i=1;i<angles.length;i++){while(angles[i]-angles[i-1]>Math.PI)angles[i]-=2*Math.PI;while(angles[i]-angles[i-1]<-Math.PI)angles[i]+=2*Math.PI;}
          path.analyticArc={u:datum.u,v:datum.v,rx:datum.rx,ry:datum.ry,from:angles[0],to:angles.at(-1)};
        }
        if(work.type==='profile') {
          work.outline=alignOutlineToPaths(work.outline,work.paths,.02);
          regularizeMeasuredContour(work,linework[role].w,linework[role].h,{includeMeasuredArcs:true});
        }
        alignCurveOutline(work);
        work.measuredPrimitives=true;
        work.sourceFidelity={method:'dense measured primitives',beforePrimitiveRecovery:work.sourceFidelity};
      }
    }
  }
  for(const role of ['front','top','side']) {
    const work=drawing[role];if(work.type==='inferred')continue;
    joinMeasuredJunctions(work.paths.map(p=>({...p,measuredPoints:p.measuredPoints?.map(frames[role].map)})),Math.min(.008,2/Math.max(linework[role].w,linework[role].h)));
  }
  alignDrawingGuides(drawing,recon.features);
  for(const w of Object.values(drawing))if(w.photoCorrection&&w.type==='circle')for(const c of w.curveDatums||[]) {
    if(Math.hypot(c.u-.5,c.v-.5)>.008)continue;
    const delta=[.5-c.u,.5-c.v];
    for(const p of w.paths.filter(p=>c.ids.includes(p.id))) {
      for(const q of p.points){q[0]+=delta[0];q[1]+=delta[1];}
      if(p.analyticArc){p.analyticArc.u=.5;p.analyticArc.v=.5;}
    }c.u=c.v=.5;
  }
  alignDrawingGuides(drawing,recon.features);
  for(const w of Object.values(drawing))closeCircularRim(w);
  for(const [role,frame] of Object.entries(recon.sectionFrames||{}))drawing[role].outline=frame.outline.map(p=>[...p]);
  recon.drawing=drawing;
  refineForkDrawing(recon,linework);
  for(const [role,id,lt] of recon.profileStructureFit?.lineClasses||[]){const p=drawing[role].paths.find(p=>p.id===id);if(p&&!p.manualType){p.lt=lt;p.dashFragment=true;}}
  for(const [role,work] of Object.entries(drawing)){
    const manual=new Map(linework[role].paths.filter(p=>p.manualType).map(p=>[p.id,p.lt]));
    if(manual.size)for(const p of work.paths)if(manual.has(p.id)){p.lt=manual.get(p.id);p.manualType=true;}
  }
  return drawing;
}

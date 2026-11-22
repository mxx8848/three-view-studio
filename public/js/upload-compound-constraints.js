import {measuredCircles} from './upload-primitives.js';
import {tangentWebProfile} from './upload-compound.js';
import {measuredDashedCircles} from './upload-dashed-circles.js';

const axes=['x','y','z'];
const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
// Audit original skeleton coordinates, not coordinates already snapped to a
// candidate wall/rim during drawing cleanup. Recovered dash/axis semantics
// may transfer by path id; model-driven coordinate adjustments may not.
export function compoundSourceDrawing(recon,linework) {
 const drawing={};
 for(const [role,w] of Object.entries(recon.drawing)) {
  const raw=linework[role],map=w.sourceMap;
  if(recon.inferredRoles.includes(role)||!raw?.paths||map?.length!==3){drawing[role]=w;continue;}
  const [a,b,c]=map,semantics=new Map(w.paths.map(p=>[p.id,p]));
  drawing[role]={...w,paths:raw.paths.map(p=>({...p,lt:p.lt==='ignore'?'ignore':semantics.get(p.id)?.lt||p.lt,hiddenCircle:semantics.get(p.id)?.hiddenCircle,points:p.points.map(([x,y])=>a.map((v,i)=>v+x*(b[i]-v)+y*(c[i]-v)))}))};
 }
 return {...recon,drawing};
}
export function compoundAuditCost(audit) {
 const views=Object.values(audit.views);
 // Continuous error breaks threshold-score ties without introducing a
 // preference for arbitrary topology. Both terms use ONLY known views.
 return 1-audit.quality+.01*views.reduce((s,v)=>s+v.recall.meanErrorPixels+v.precision.meanErrorPixels,0)/Math.max(1,views.length);
}
export function compoundPixelScale(recon) {
 const scales=[];
 for(const [role,w] of Object.entries(recon.drawing)) {
  if(recon.inferredRoles.includes(role)||!w.sourceMap)continue;
  const [a,b,c]=w.sourceMap,du=Math.hypot(...b.map((v,i)=>v-a[i])),dv=Math.hypot(...c.map((v,i)=>v-a[i]));
  scales.push(du*(role==='side'?recon.modelSize.y:recon.modelSize.x),dv*(role==='top'?recon.modelSize.y:recon.modelSize.z));
 }
 return median(scales.filter(v=>Number.isFinite(v)&&v>0))||.002;
}

// Infer dash semantics from the ORIGINAL polar ink occupancy. A continuous
// thin circle and a solid ring cut at two intersections are counterexamples.
export function dashedCircleEvidence(work,circle) {
 const ink=work.inkMask||work.mask;if(!ink)return null;
 const count=Math.max(180,Math.ceil(2*Math.PI*circle.r)),occupied=[];
 for(let i=0;i<count;i++) {
  const angle=i*2*Math.PI/count;let hit=false;
  for(const dr of [-1,0,1]) {
   const x=Math.round(circle.cx+(circle.r+dr)*Math.cos(angle)),y=Math.round(circle.cy+(circle.r+dr)*Math.sin(angle));
   if(x>=0&&y>=0&&x<work.w&&y<work.h&&ink[y*work.w+x])hit=true;
  }
  occupied.push(hit);
 }
 const empty=occupied.findIndex(v=>!v);if(empty<0)return null;
 const runs=[];let length=0;
 for(let j=1;j<=count;j++) {
  if(!occupied[(empty+j)%count])length++;
  else if(length){runs.push(length);length=0;}
 }
 if(length)runs.push(length);
 const gaps=runs.filter(v=>v>=3),coverage=occupied.filter(Boolean).length/count;
 if(gaps.length<5||coverage<.25||coverage>.9)return null;
 const typical=median(gaps),regular=gaps.filter(v=>v>=typical*.45&&v<=typical*1.8).length/gaps.length;
 return regular>=.7?{gaps:gaps.length,coverage,typicalGapPixels:typical,regular}:null;
}

export function recoverCompoundHiddenArcs(recon,linework) {
 const changes=[];
 for(const role of ['front','top','side'].filter(r=>!recon.inferredRoles.includes(r))) {
  const raw=linework[role],w=recon.drawing[role];if(!raw||!w.sourceMap)continue;
  const [a,b,c]=w.sourceMap,ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;
  const source=p=>[(vy*(p[0]-a[0])-vx*(p[1]-a[1]))/det,(-uy*(p[0]-a[0])+ux*(p[1]-a[1]))/det];
  if(Math.abs(det)<1e-12)continue;
  const continuous=measuredCircles({...raw,paths:raw.paths.map(p=>({...p,lt:p.lt==='ignore'?'ignore':'v'}))});
  const circles=[...continuous,...measuredDashedCircles(raw).filter(c=>!continuous.some(v=>Math.hypot(c.cx-v.cx,c.cy-v.cy)<2&&Math.abs(c.r-v.r)<2))];
  const datums=circles.map(c=>({u:a[0]+c.cx*ux+c.cy*vx,v:a[1]+c.cx*uy+c.cy*vy,rx:Math.abs(c.r*ux),ry:Math.abs(c.r*vy)}));
  changes.push(...recoverCompoundCenterlines(w,datums).map(e=>({role,...e})));
  for(const circle of circles) {
   const evidence=dashedCircleEvidence(raw,circle);if(!evidence)continue;
   const ids=[];
   for(const path of w.paths) {
    if(!['v','t','h'].includes(path.lt)||path.width>raw.thickWidth*.8||path.points.length<3)continue;
    const ps=path.points.map(source);
    if(!ps.every(p=>Math.abs(Math.hypot(p[0]-circle.cx,p[1]-circle.cy)-circle.r)<1.6))continue;
    // Reject almost-straight strokes even if a short tangent accidentally
    // lies inside the circle's raster uncertainty band.
    const angles=ps.map(p=>Math.atan2(p[1]-circle.cy,p[0]-circle.cx));
    let turn=0;for(let i=1;i<angles.length;i++){let d=angles[i]-angles[i-1];if(d>Math.PI)d-=2*Math.PI;if(d< -Math.PI)d+=2*Math.PI;turn+=d;}
    if(Math.abs(turn)<.06)continue;
    path.lt='h';path.dashFragment=true;path.compoundLineEvidence={...evidence,cx:circle.cx,cy:circle.cy,r:circle.r};
    path.hiddenCircle={center:a.map((v,i)=>v+circle.cx*(b[i]-v)+circle.cy*(c[i]-v)),u:b.map((v,i)=>(v-a[i])*circle.r),v:c.map((v,i)=>(v-a[i])*circle.r)};
    ids.push(path.id);
   }
   if(ids.length)changes.push({role,circle:{cx:circle.cx,cy:circle.cy,r:circle.r},paths:ids,evidence});
  }
 }
 return changes;
}

// Skeleton junctions split a long centre dash into several visible fragments.
// Merge touching runs before checking the long-short-long pattern. A circle
// centre AND repeated dash-dot evidence are required; thinness alone is not.
export function recoverCompoundCenterlines(w,circles) {
 const groups=[],changes=[],[a,b,c]=w.sourceMap;
 const pixel=[Math.hypot(b[0]-a[0],b[1]-a[1]),Math.hypot(c[0]-a[0],c[1]-a[1])];
 for(const p of w.paths) {
  if(p.arc||!['v','h','t','c'].includes(p.lt)||p.width>=w.thickWidth*.8)continue;
  for(const axis of [0,1]) {
   const vs=p.points.map(q=>q[axis]);if(Math.max(...vs)-Math.min(...vs)>pixel[axis]*.6)continue;
   const at=vs.reduce((s,v)=>s+v,0)/vs.length;
   let g=groups.find(g=>g.axis===axis&&Math.abs(g.at-at)<pixel[axis]);
   if(!g){g={axis,at,paths:[],runs:[]};groups.push(g);}
   g.paths.push(p);const ends=p.points.map(q=>q[1-axis]);g.runs.push([Math.min(...ends),Math.max(...ends)]);
  }
 }
 const proven=[],shortLimit=Math.max(15,w.thickWidth*5);
 for(const g of groups) {
  const runs=[];for(const r of g.runs.sort((a,b)=>a[0]-b[0])){if(runs.length&&r[0]-runs.at(-1)[1]<pixel[1-g.axis]*1.5)runs.at(-1)[1]=Math.max(runs.at(-1)[1],r[1]);else runs.push([...r]);}
  g.merged=runs;
  if(runs.length<5)continue;
  const lengths=runs.map(r=>(r[1]-r[0])/pixel[1-g.axis]).sort((a,b)=>a-b),short=median(lengths.slice(0,3));
  if(short<2||short>shortLimit||lengths.filter(v=>v>=short*.65&&v<=short*1.5).length<2||lengths.filter(v=>v>short*3).length<2)continue;
  const centered=circles.some(c=>Math.abs(g.at-(g.axis?c.v:c.u))<pixel[g.axis]*1.5&&runs[0][0]<(g.axis?c.u-c.rx:c.v-c.ry)-pixel[1-g.axis]*2&&runs.at(-1)[1]>(g.axis?c.u+c.rx:c.v+c.ry)+pixel[1-g.axis]*2);
  if(!centered)continue;
  for(const p of g.paths)p.lt='c';
  proven.push(g);
  changes.push({paths:g.paths.map(p=>p.id),reason:'实测圆心与重复长短划共同支持的中心线'});
 }
 // The transverse centreline can be continuous where another circular rim
 // crosses its dot. Require an independently proven perpendicular dash-dot
 // axis, a concentric pair and a symmetric thin span across the circle.
 for(const g of groups.filter(g=>!proven.includes(g))) {
  const runs=g.merged;if(!runs?.length)continue;
  const lo=runs[0][0],hi=runs.at(-1)[1],px=pixel[1-g.axis];
  const pair=circles.filter(c=>Math.abs(g.at-(g.axis?c.v:c.u))<pixel[g.axis]*1.5&&proven.some(p=>p.axis!==g.axis&&Math.abs(p.at-(g.axis?c.u:c.v))<px*1.5));
  if(pair.length<2)continue;
  const outer=pair.toSorted((a,b)=>(g.axis?b.rx:b.ry)-(g.axis?a.rx:a.ry))[0],center=g.axis?outer.u:outer.v,radius=g.axis?outer.rx:outer.ry;
  if(Math.abs((lo+hi)/2-center)>px*1.5||hi-lo<2*radius-px*2)continue;
  const gaps=runs.slice(1).map((r,i)=>(r[0]-runs[i][1])/px);
  const centralDot=runs.some(r=>Math.abs((r[0]+r[1])/2-center)<px*1.5&&(r[1]-r[0])/px<shortLimit);
  const extendsRim=lo<center-radius-px*2&&hi>center+radius+px*2;
  if(!(extendsRim&&runs.length===1||centralDot&&gaps.length===2&&gaps.every(v=>v>=2&&v<shortLimit)&&Math.abs(gaps[0]-gaps[1])<Math.max(2,w.thickWidth*.7)))continue;
  for(const p of g.paths)p.lt='c';
  changes.push({paths:g.paths.map(p=>p.id),reason:'已证实长短划轴、同心圆与对称横向中心线共同支持'});
 }
 return changes;
}

// A hidden run often joins its last dash to a perpendicular hidden shoulder.
// The skeleton then makes one polyline and the old single-segment classifier
// leaves its final leg visible. Recover only on independently repeated dash
// supports, preserving every source coordinate and every thick visible wall.
export function recoverCompoundHiddenCorners(recon) {
 const changes=[];
 for(const role of ['front','top','side'].filter(r=>!recon.inferredRoles.includes(r))) {
  const w=recon.drawing[role],groups=[];
  const [origin,px,py]=w.sourceMap||[];if(!origin)continue;
  const pixel=[Math.abs(px[0]-origin[0]),Math.abs(py[1]-origin[1])];
  for(const path of w.paths.filter(p=>p.lt==='h'&&!p.arc))for(let i=1;i<path.points.length;i++) {
   const a=path.points[i-1],b=path.points[i],axis=[0,1].find(k=>Math.abs(a[k]-b[k])<pixel[k]*.4);if(axis===undefined)continue;
   const at=(a[axis]+b[axis])/2;
   let g=groups.find(g=>g.axis===axis&&Math.abs(g.at-at)<pixel[axis]);if(!g){g={axis,at,runs:[]};groups.push(g);}
   g.runs.push([Math.min(a[1-axis],b[1-axis]),Math.max(a[1-axis],b[1-axis])]);
  }
  const repeated=groups.filter(g=>{
   g.runs.sort((a,b)=>a[0]-b[0]);
   const lengths=g.runs.map(([a,b])=>(b-a)/pixel[1-g.axis]),typical=median(lengths);
   const gaps=g.runs.slice(1).map((r,i)=>(r[0]-g.runs[i][1])/pixel[1-g.axis]).filter(v=>v>=2&&v<=typical*2);
   return g.runs.length>=3&&gaps.length>=2&&typical<45;
  });
  for(const path of w.paths) {
   if(!['v','t'].includes(path.lt)||path.arc||path.width>=w.thickWidth*.8)continue;
   const supports=path.points.slice(1).map((b,i)=>{
    const a=path.points[i];if(Math.hypot((a[0]-b[0])/pixel[0],(a[1]-b[1])/pixel[1])<2)return true;
    return repeated.some(g=>Math.abs(a[g.axis]-b[g.axis])<pixel[g.axis]*.5&&Math.abs((a[g.axis]+b[g.axis])/2-g.at)<pixel[g.axis]&&Math.max(a[1-g.axis],b[1-g.axis])>=g.runs[0][0]-45*pixel[1-g.axis]&&Math.min(a[1-g.axis],b[1-g.axis])<=g.runs.at(-1)[1]+45*pixel[1-g.axis]);
   });
   if(supports.length&&supports.every(Boolean)){changes.push({role,path:path.id,from:path.lt,reason:'重复短划支撑的连接末段'});path.lt='h';path.dashFragment=true;}
  }
 }
 return changes;
}

// Relationships are considered only within measured raster uncertainty.
// No answer, inferred-view edge, or arbitrary target coordinate is an input.
export function constrainCompound(recon,hypothesis) {
 const h=structuredClone(hypothesis),s=recon.modelSize,pixel=compoundPixelScale(recon),tolerance=pixel*1.5,evidence=[];
 const originalCuts=new Map(h.features.filter(f=>!f.profile).map(f=>[f,{...f}]));
 const originalBodies=structuredClone(h.components||[]);
 const bodies=h.components||[],cuts=h.features.filter(f=>f.kind==='through'&&!f.profile),axis=f=>f.role==='top'?'z':f.role==='front'?'y':'x';
 const center=(f,a)=>f.role==='top'?a==='x'?f.u:1-f.v:f.role==='front'?a==='x'?f.u:1-f.v:a==='y'?1-f.u:1-f.v;
 const setCenter=(f,a,value)=>{if(f.role==='top'){if(a==='x')f.u=value;else f.v=1-value;}else if(f.role==='front'){if(a==='x')f.u=value;else f.v=1-value;}else{if(a==='y')f.u=1-value;else f.v=1-value;}};
 // A group needs evidence in two different projection directions. Aligning
 // arbitrary nearby cylinders from only one projection would erase offsets.
 for(const a of axes) {
  const entries=[...bodies.filter(b=>b.axis!==a).map(b=>({value:b[a],source:b.axis,set:v=>b[a]=v})),...cuts.filter(f=>axis(f)!==a).map(f=>({value:center(f,a),source:axis(f),set:v=>setCenter(f,a,v)}))];
  const used=new Set();
  for(const seed of entries) {
   if(used.has(seed))continue;
   const group=entries.filter(e=>!used.has(e)&&Math.abs(e.value-seed.value)*s[a]<tolerance);
   if(new Set(group.map(e=>e.source)).size<2)continue;
   const envelope=bodies.find(b=>b.axis!==a&&Math.abs(b.r*s.x-s[a]/2)<pixel&&Math.abs(b[a]-.5)*s[a]<tolerance);
   const value=envelope?envelope[a]:group.reduce((v,e)=>v+e.value,0)/group.length;
   for(const e of group){e.set(value);used.add(e);}
   evidence.push({relation:'common-axis-coordinate',axis:a,value,measurements:group.map(e=>e.value),maxAdjustmentPixels:Math.max(...group.map(e=>Math.abs(e.value-value)*s[a]/pixel))});
  }
 }
 // Intersecting equal-radius bores have a degenerate intersection. Keep the
 // exact equality once established; independently rounded radii create false
 // hyperbola branches at the crossing of otherwise straight generators.
 for(let i=0;i<cuts.length;i++)for(const b of cuts.slice(i+1)) {
  const a=cuts[i];if(axis(a)===axis(b))continue;
  const ra=a.r*(a.role==='side'?s.y:s.x),rb=b.r*(b.role==='side'?s.y:s.x);
  if(Math.abs(ra-rb)>tolerance)continue;
  const common=axes.find(k=>k!==axis(a)&&k!==axis(b));
  if(Math.abs(center(a,common)-center(b,common))*s[common]>tolerance)continue;
  const radius=(ra+rb)/2;
  a.r=radius/(a.role==='side'?s.y:s.x);b.r=radius/(b.role==='side'?s.y:s.x);
  evidence.push({relation:'equal-intersecting-bore-radii',roles:[a.role,b.role],radius,measurements:[ra,rb],maxAdjustmentPixels:Math.abs(ra-rb)/2/pixel});
 }
 for(const [f,old] of originalCuts)for(const slot of h.features.filter(g=>g.role===f.role&&g.profile)) {
  if(!slot.profile.every(([u,v])=>(Math.abs(u-(old.u-old.r))<1e-8||Math.abs(u-(old.u+old.r))<1e-8)&&(Math.abs(v)<1e-8||Math.abs(v-old.v)<1e-8)))continue;
  slot.profile=slot.profile.map(([u,v])=>[f.u+(u<old.u?-f.r:f.r),Math.abs(v-old.v)<1e-8?f.v:v]);
  evidence.push({relation:'slot-walls-tangent-to-measured-circle',role:f.role,center:[f.u,f.v]});
 }
 if(h.profiles?.length&&originalBodies.length===2&&originalBodies.every(b=>b.axis==='z')) {
  const [a,b]=originalBodies,old=tangentWebProfile({u:a.x,v:1-a.y},a.r,{u:b.x,v:1-b.y},b.r,s.y/s.x);
  for(const profile of h.profiles)if(old&&profile.points.length===4&&profile.points.every(p=>old.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8))) {
   const [c,d]=h.components,next=tangentWebProfile({u:c.x,v:1-c.y},c.r,{u:d.x,v:1-d.y},d.r,s.y/s.x);
   // Preserve the original winding and start vertex, including profiles
   // constructed with the two measured circles in the opposite order.
   profile.points=profile.points.map(p=>next[old.reduce((best,q,i)=>Math.hypot(p[0]-q[0],p[1]-q[1])<Math.hypot(p[0]-old[best][0],p[1]-old[best][1])?i:best,0)]);
  }
 }
 h.constraints=evidence;h.variant='joint-measured-constraints';
 return h;
}

// A transverse tube's planar mouth meets the circular base at its two
// generators in plan. Jointly fit the measured base radius, tube radii and
// mouth planes; rounding these five measurements independently opens a false
// sliver at the junction. This is a source-supported relation, not a rule for
// arbitrary tubes: both visible mouth walls and both generator endpoints
// must be near the measured base circle before it can be proposed.
export function fitCompoundMouths(recon,hypothesis,linework,{onReject=()=>{}}={}) {
 const reject=(reason,details)=>{onReject({reason,...details});return null;};
 const m=hypothesis.measurements;
 if(!m?.top?.envelope||!m.side?.lower||!m.side?.upper||!hypothesis.flange)return null;
 const source=compoundSourceDrawing(recon,linework),s=recon.modelSize,w=source.drawing.top;
 const envelope=m.top.envelope,aspect=s.y/s.x;
 const sourcePixel=compoundPixelScale(recon)/s.x,px=sourcePixel*Math.max(1,(w.thickWidth||3)/3);
 const centered=recon.drawing.top.type==='circle'&&Math.abs(envelope.u-.5)<px&&Math.abs(envelope.v-.5)*aspect<px;
 const cx=centered?.5:envelope.u,cy=centered?.5:envelope.v;
 const mouths=hypothesis.components.filter(b=>b.axis==='x').map(b=>{
  const left=b.lo<.5,at=left?b.lo:b.hi,groups=[];
  for(const p of w.paths.filter(p=>p.lt==='v'))for(let i=1;i<p.points.length;i++) {
   const a=p.points[i-1],q=p.points[i];
   if(Math.abs(a[0]-q[0])>px*1.5||Math.abs(a[0]-q[0])>Math.abs(a[1]-q[1])*.05||Math.abs((a[0]+q[0])/2-at)>px*2||Math.abs(a[1]-q[1])*aspect<px*2)continue;
   groups.push({at:(a[0]+q[0])/2,length:Math.abs(a[1]-q[1]),lo:Math.min(a[1],q[1]),hi:Math.max(a[1],q[1])});
  }
  if(!groups.length)return reject('missing-mouth-wall',{at});
  const total=groups.reduce((sum,g)=>sum+g.length,0),x=groups.reduce((sum,g)=>sum+g.at*g.length,0)/total;
  const radius=b.r,center=1-b.y;
  const ends=[center-radius/aspect,center+radius/aspect];
  // Skeleton junctions round the last one or two pixels of a long wall.
  // Its straight core proves the support; nearby original corner vertices
  // can supply the ends without extending the core by an arbitrary length.
  const corners=w.paths.filter(p=>p.lt==='v').flatMap(p=>p.points).filter(p=>Math.abs(p[0]-x)<px*2&&p[1]>=ends[0]-px*3/aspect&&p[1]<=ends[1]+px*3/aspect);
  const lo=Math.min(...groups.map(g=>g.lo),...corners.map(p=>p[1])),hi=Math.max(...groups.map(g=>g.hi),...corners.map(p=>p[1]));
  if(Math.abs(lo-ends[0])*aspect>px*3||Math.abs(hi-ends[1])*aspect>px*3||total*aspect<radius*1.7)return reject('incomplete-mouth-wall',{at,lo,hi,ends,total,radius,px});
  // Both corners must lie within three source pixels of the measured rim.
  if(ends.some(y=>Math.abs(Math.hypot(x-cx,(y-cy)*aspect)-envelope.r)>px*3))return reject('mouth-not-on-envelope',{at,x,ends,r:envelope.r,px});
  if(Math.abs(center-cy)*aspect>px*1.5)return reject('offset-mouth-axis',{at,center,cy,px});
  return {left,x,radius,original:at};
 });
 if(mouths.length!==2||mouths.some(m=>!m))return null;
 const x0=[centered?Math.min(.5,s.y/(2*s.x)):envelope.r,...mouths.map(m=>m.radius),...mouths.map(m=>m.x)];
 let x=[...x0];
 // Weighted projection onto the two exact circle equations, minimizing the
 // displacement from the independent source measurements at each iteration.
 const weights=[centered?0:1,1,1,1,1];
 for(let k=0;k<10;k++) {
  const f=mouths.map((_,i)=>(x[3+i]-cx)**2+x[1+i]**2-x[0]**2);
  const j=mouths.map((_,i)=>[-2*x[0],i===0?2*x[1]:0,i===1?2*x[2]:0,i===0?2*(x[3]-cx):0,i===1?2*(x[4]-cx):0]);
  const mat=j.map(a=>j.map(b=>a.reduce((sum,v,i)=>sum+v*weights[i]*b[i],0)));
  const rhs=f.map((v,i)=>v-j[i].reduce((sum,a,n)=>sum+a*(x[n]-x0[n]),0));
  const det=mat[0][0]*mat[1][1]-mat[0][1]*mat[1][0];if(Math.abs(det)<1e-15)return null;
  const lambda=[(rhs[0]*mat[1][1]-rhs[1]*mat[0][1])/det,(rhs[1]*mat[0][0]-rhs[0]*mat[1][0])/det];
  x=x0.map((v,i)=>v-weights[i]*j.reduce((sum,row,n)=>sum+row[i]*lambda[n],0));
 }
 if(x.some((v,i)=>!Number.isFinite(v)||Math.abs(v-x0[i])>px*1.5))return reject('measurement-displacement',{x0,x,px});
 const h=constrainCompound(recon,hypothesis);
 // Keep one supported centre for this circular base and the tube mouths.
 // Its source uncertainty is small; all connected cylinder axes share it.
 for(const b of h.components) {
  if(b.axis==='z') {b.x=cx;b.y=1-cy;if(b.hi<=h.flange.base)b.r=x[0];}
  else if(b.axis==='x')b.y=1-cy;
 }
 for(const f of h.features)if(!f.profile){if(f.role==='top'){f.u=cx;f.v=cy;}else if(f.role==='side')f.u=cy;}
 for(const [i,mouth] of mouths.entries()) {
  const body=h.components.find(b=>b.axis==='x'&&(mouth.left?b.lo<.5:b.hi>.5));
  body.r=x[1+i];if(mouth.left)body.lo=x[3+i];else body.hi=x[3+i];
  for(const f of h.features.filter(f=>f.role==='side'&&f.axialRange)) {
   for(let end=0;end<2;end++)if(Math.abs(f.axialRange[end]-mouth.original)<px)f.axialRange[end]=x[3+i];
   const oldRadius=mouth.radius*s.x/s.y;
   if(Math.abs(f.r-oldRadius)*s.y/s.x<px)f.r=x[1+i]*s.x/s.y;
   if(Math.abs((1-f.v)-body.z)*s.z<px*s.x*1.5)f.v=1-body.z;
  }
 }
 h.variant='joint-measured-mouths';
 h.constraints.push({relation:'measured-mouths-meet-base',sourceMeasurements:x0,parameters:x,center:[cx,cy],uncertaintyPixels:px/sourcePixel,maxAdjustmentPixels:Math.max(...x.map((v,i)=>Math.abs(v-x0[i])/sourcePixel)),residual:mouths.map((_,i)=>(x[3+i]-cx)**2+x[1+i]**2-x[0]**2)});
 return h;
}

// A long pair of exterior generators in the orthogonal elevation is a
// second, independent measurement of the vertical column's diameter. Fuse
// it with the circular plan only within their source-pixel uncertainty.
export function fitCompoundColumn(recon,hypothesis,linework) {
 const m=hypothesis.measurements?.top?.column;if(!m)return null;
 const source=compoundSourceDrawing(recon,linework),w=source.drawing.side,s=recon.modelSize;
 if(!w||recon.inferredRoles.includes('side'))return null;
 const sourcePixel=compoundPixelScale(recon),pixel=sourcePixel*Math.max(1,(w.thickWidth||3)/3),tol=pixel*2/s.y,center=.5;
 const groups=[];
 for(const p of w.paths.filter(p=>p.lt==='v'))for(let i=1;i<p.points.length;i++) {
  const a=p.points[i-1],b=p.points[i];
  if(Math.abs(a[0]-b[0])>tol*.5||Math.abs(a[1]-b[1])<.3||Math.min(a[1],b[1])>.02)continue;
  const at=(a[0]+b[0])/2;
  if(Math.abs(Math.abs(at-center)*s.y-m.r*s.x)>pixel*2)continue;
  groups.push(at);
 }
 const left=groups.filter(v=>v<center),right=groups.filter(v=>v>center);
 if(!left.length||!right.length)return null;
 const lo=median(left),hi=median(right),radius=(hi-lo)*s.y/2;
 if(Math.abs((lo+hi)/2-center)*s.y>pixel*1.5||Math.abs(radius-m.r*s.x)>pixel*1.5)return null;
 const h=structuredClone(hypothesis),column=h.components.find(b=>b.axis==='z'&&Math.abs(b.r-m.r)<1e-8&&b.hi===1);
 if(!column)return null;
 const joint=(radius+m.r*s.x)/2;column.r=joint/s.x;
 h.variant=`${hypothesis.variant||'original'}-column`;
 h.constraints=[...(h.constraints||[]),{relation:'column-plan-and-elevation',planRadius:m.r*s.x,elevationRadius:radius,radius:joint,supports:[lo,hi],uncertaintyPixels:pixel/sourcePixel,maxAdjustmentPixels:Math.abs(radius-m.r*s.x)/2/sourcePixel}];
 return h;
}

// The near end of a transverse bore can terminate within the central bore
// void instead of at the arbitrary body centre. Probe measured overlap limits;
// a rear blind wall and a truly connected bore remain distinct hypotheses.
export function compoundConnectionVariants(recon,hypothesis) {
 const h=constrainCompound(recon,hypothesis),out=[h],s=recon.modelSize;
 const main=h.features.find(f=>f.role==='top'&&!f.profile&&f.kind==='through');
 if(!main)return out;
 // Open transverse slots have a measured visible side and an independently
 // measured central bore. Limit overlap by the bore section at the farthest
 // slot wall; using half the radius alone can extend that wall into material.
 for(const [i,f] of h.features.entries()) {
  if(f.role!=='front'||!f.profile||!f.axialRange||f.kind!=='through')continue;
  const dx=Math.max(...f.profile.map(p=>Math.abs(p[0]-main.u)))*s.x;
  const clearance=Math.sqrt(Math.max(0,(main.r*s.x)**2-dx**2))/s.y,center=1-main.v;
  if(clearance<=compoundPixelScale(recon)/s.y)continue;
  for(const [direction,range] of [['front',[0,Math.min(1,center+clearance*.5)]],['rear',[Math.max(0,center-clearance*.5),1]]]) {
   const copy=structuredClone(h);copy.features[i].axialRange=range;copy.variant=`open-slot-${direction}`;
   copy.constraints.push({relation:'slot-meets-measured-bore',feature:i,direction,range,centralBore:{u:main.u,v:main.v,r:main.r}});out.push(copy);
  }
 }
 for(const [i,f] of h.features.entries()) {
  if(f.role!=='side'||!f.axialRange||f.profile)continue;
  const [lo,hi]=f.axialRange,center=main.u,edge=main.r;
  if(Math.abs(hi-center)<.025||Math.abs(lo-center)<.025) {
   // Diagnostic alternatives only: material equivalence is not established
   // by a centre coordinate or by similar line scores.
   const copy=structuredClone(h),next=copy.features[i];
   if(Math.abs(hi-center)<.025)next.axialRange[1]=Math.min(1,center+edge*.5);
   else next.axialRange[0]=Math.max(0,center-edge*.5);
   copy.variant=`connection-overlap-${i}`;copy.constraints.push({relation:'overlap-central-bore',feature:i,range:next.axialRange,physicalDepth:s.x*(next.axialRange[1]-next.axialRange[0])});out.push(copy);
  }
 }
 return out;
}

// The large circular end of a tangent link touches the plan's depth envelope
// and right support. Couple these measured tangencies before clipping the CSG
// blank; a subpixel circle overshoot otherwise removes whole generators.
export function fitTangentEnvelope(recon,hypothesis) {
 if(hypothesis.family!=='tangent-base-stepped-tube')return null;
 const h=constrainCompound(recon,hypothesis),s=recon.modelSize,pixel=compoundPixelScale(recon),b=h.components[0],old={...b};
 const radius=s.y/(2*s.x),x=1-radius;
 if(Math.abs(b.r-radius)*s.x>1.5*pixel||Math.abs(b.x-x)*s.x>1.5*pixel||Math.abs(b.y-.5)*s.y>1.5*pixel)return null;
 b.r=radius;b.x=x;b.y=.5;
 for(const f of h.features.filter(f=>f.role==='top'&&!f.profile&&Math.abs(f.u-old.x)*s.x<1.5*pixel&&Math.abs(1-f.v-old.y)*s.y<1.5*pixel)){f.u=x;f.v=.5;}
 const small=h.components[1];
 // The small outer arc also touches the left support. Its separately fitted
 // bore centre may differ by a pixel; using that centre for the outer skin
 // can put the skin outside the blank and invoke an unnecessary CSG clip.
 if(Math.abs(small.x-small.r)*s.x>1.5*pixel||Math.abs(small.y-.5)*s.y>1.5*pixel)return null;
 const smallX=small.x;small.x=small.r;small.y=.5;
 for(const f of h.features.filter(f=>f.role==='top'&&!f.profile&&Math.abs(f.u-smallX)*s.x<1.5*pixel)){f.u=small.x;f.v=.5;}
 h.profiles[0].points=tangentWebProfile({u:small.x,v:1-small.y},small.r,{u:b.x,v:1-b.y},b.r,s.y/s.x);
 h.variant='measured-tangent-envelope';
 h.constraints.push({relation:'circle-tangent-to-plan-envelope',radius,center:[x,.5],maxAdjustmentPixels:Math.max(Math.abs(old.r-radius)*s.x,Math.abs(old.x-x)*s.x,Math.abs(old.y-.5)*s.y)/pixel});
 return h;
}

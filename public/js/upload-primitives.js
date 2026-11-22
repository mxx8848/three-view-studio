import {circleFit,simplify} from './upload-lines.js';
import {cleanStrokeCorners} from './upload-curves.js';

const tau=Math.PI*2;
const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
const radial=(p,c)=>Math.abs(Math.hypot(p[0]-c.cx,p[1]-c.cy)-c.r);

// After a supported photograph warp, fit straight runs in pixel coordinates.
// Move shared graph nodes together, retain true inclines and dash intervals.
export function cleanPhotoPaths(paths,work,circles=[]) {
 if(!work.photoCorrection)return paths;
 const tolerance=Math.max(1.25,Math.min(2.25,(work.thickWidth||2)*.45)),groups=[[],[]],nodes=new Map();
 const key=p=>p.map(v=>v.toFixed(6)).join(',');
 for(const p of paths)for(const q of p.points){const k=key(q);if(!nodes.has(k))nodes.set(k,[]);nodes.get(k).push(q);}
 for(const path of paths){
  if(path.arc||path.points.some(p=>p.curved))continue;
  path.points=cleanStrokeCorners(simplify(path.points,tolerance*.45),tolerance);
 }
 nodes.clear();for(const p of paths)for(const q of p.points){const k=key(q);if(!nodes.has(k))nodes.set(k,[]);nodes.get(k).push(q);}
 // Fit a supported run as a whole: a one-pixel thinning hook must not split
 // an otherwise straight wall into several slightly different supports.
 for(const path of paths.filter(p=>!p.arc&&!p.points.some(q=>q.curved)))for(const axis of [0,1]){
  const ps=path.points;
  for(let start=0;start<ps.length-1;start++){
   let end=start,lo=ps[start][axis],hi=lo;
   while(end+1<ps.length){const v=ps[end+1][axis];if(Math.max(hi,v)-Math.min(lo,v)>tolerance*1.5)break;lo=Math.min(lo,v);hi=Math.max(hi,v);end++;}
   if(end>start&&Math.abs(ps[end][1-axis]-ps[start][1-axis])>Math.max(10,tolerance*8)){
    const at=median(ps.slice(start,end+1).map(q=>q[axis]));
    for(let i=start;i<=end;i++)for(const q of nodes.get(key(ps[i]))||[ps[i]])q[axis]=at;
    start=end-1;
   }
  }
 }
 for(const path of paths.filter(p=>!p.arc))for(let i=1;i<path.points.length;i++) {
  const a=path.points[i-1],b=path.points[i],dx=Math.abs(a[0]-b[0]),dy=Math.abs(a[1]-b[1]),axis=dx<dy*.09?0:dy<dx*.09?1:-1;
  if(axis<0||Math.max(dx,dy)<4||a.curved||b.curved)continue;
  const value=(a[axis]+b[axis])/2;if(Math.abs(a[axis]-b[axis])>tolerance*2)continue;
  let g=groups[axis].find(g=>Math.abs(g.at-value)<tolerance);if(!g){g={at:value,s:[]};groups[axis].push(g);}g.s.push({a,b,path,len:Math.max(dx,dy)});
 }
 for(const axis of [0,1])for(const g of groups[axis]){
  const at=g.s.reduce((s,q)=>s+(q.a[axis]+q.b[axis])/2*q.len,0)/g.s.reduce((s,q)=>s+q.len,0);
  for(const s of g.s)for(const p of [s.a,s.b])for(const q of nodes.get(key(p))||[p])if(!q.curved)q[axis]=at;
  const thin=g.s.filter(s=>s.path.width<(work.thickWidth||2)*.85),runs=thin.map(s=>[Math.min(s.a[1-axis],s.b[1-axis]),Math.max(s.a[1-axis],s.b[1-axis])]).sort((a,b)=>a[0]-b[0]);
  if(thin.filter(s=>s.path.lt==='h').length>=2&&runs.filter((r,i)=>i&&r[0]-runs[i-1][1]>1.5).length>=2)for(const s of thin)if(s.path.points.every(p=>Math.abs(p[axis]-at)<tolerance)){s.path.lt='h';s.path.dashFragment=true;}
 }
 alignMeasuredSupports(paths,circles,work.thickWidth||2);
 for(const circle of circles)for(const axis of [0,1]){
  const at=axis?circle.cy:circle.cx,other=axis?circle.cx:circle.cy;
  const supports=paths.filter(p=>!p.arc&&p.points.length>1&&p.points.every(q=>Math.abs(q[axis]-at)<tolerance));
  const values=supports.flatMap(p=>p.points.map(q=>q[1-axis]));
  if(values.length&&Math.min(...values)<other-circle.r-1&&Math.max(...values)>other+circle.r+1)for(const p of supports){p.lt='c';p.dashFragment=true;for(const q of p.points)q[axis]=at;}
 }
 // Repeated collinear short strokes inherit a line class only from their
 // measured train, never from the model being tested.
 return paths;
}

// Keep measured dash gaps, but give their corner fragments the same support
// and line type. Thinning often adds a one-pixel diagonal at a right angle.
export function alignMeasuredSupports(paths,circles,strokeWidth=2) {
 const tolerance=Math.max(.8,Math.min(2,strokeWidth*.4)),segments=[];
 for(const path of paths) {
  if(path.arc||path.points.some(p=>p.curved))continue;
  path.points=cleanStrokeCorners(simplify(path.points,tolerance*.5),tolerance);
  for(let i=1;i<path.points.length;i++) {
   const a=path.points[i-1],b=path.points[i];
   const dx=Math.abs(b[0]-a[0]),dy=Math.abs(b[1]-a[1]);
   const axis=dx<=tolerance&&dy>tolerance*3?0:dy<=tolerance&&dx>tolerance*3?1:-1;
   if(axis>=0)segments.push({path,a,b,axis,at:(a[axis]+b[axis])/2,length:Math.max(dx,dy)});
  }
 }
 for(const axis of [0,1]) {
  const sorted=segments.filter(s=>s.axis===axis).sort((a,b)=>a.at-b.at),groups=[];
  for(const s of sorted) {
   const last=groups.at(-1);
   if(last&&s.at-last[0].at<=tolerance)last.push(s);else groups.push([s]);
  }
  for(const group of groups) {
   const at=group.reduce((v,s)=>v+s.at*s.length,0)/group.reduce((v,s)=>v+s.length,0);
   for(const s of group)s.a[axis]=s.b[axis]=at;
   const thin=group.filter(s=>['t','h','c'].includes(s.path.lt));
   const center=circles.find(c=>Math.abs((axis?c.cy:c.cx)-at)<=tolerance);
   const hidden=thin.filter(s=>s.path.lt==='h').length>=2;
   for(const s of thin) {
    if(center){s.kind='c';s.a[axis]=s.b[axis]=axis?center.cy:center.cx;}
    else if(hidden)s.kind='h';
   }
  }
 }
 // A corner belongs to a hidden stroke when either leg has repeated dash
 // evidence; never reclassify a visible contour or bridge the dash spaces.
 for(const path of paths.filter(p=>['t','h','c'].includes(p.lt))) {
  const own=segments.filter(s=>s.path===path),kinds=own.map(s=>s.kind).filter(Boolean);
  if(kinds.includes('c')&&own.length===1){path.lt='c';path.dashFragment=true;}
  else if(kinds.includes('h')){path.lt='h';path.dashFragment=true;}
 }
 return paths;
}

// Independent line fits must still share the skeleton's original junctions.
// Intersect the fitted supports; averaging endpoints would tilt straight walls.
export function joinMeasuredJunctions(paths,tolerance=3) {
 const nodes=new Map();
 for(const path of paths.filter(p=>!p.arc&&!p.points.some(q=>q.curved)&&p.lt==='v'&&p.points.length>=2&&p.measuredPoints?.length)) {
  const original=path.measuredPoints;
  for(const end of [0,1]) {
   const raw=end?original.at(-1):original[0],at=end?path.points.length-1:0,p=path.points[at],other=path.points[end?at-1:1];
   if(Math.hypot(p[0]-raw[0],p[1]-raw[1])>tolerance*2||Math.hypot(p[0]-other[0],p[1]-other[1])<tolerance*2)continue;
   const key=raw.join(',');if(!nodes.has(key))nodes.set(key,[]);nodes.get(key).push({p,other});
  }
 }
 for(const group of nodes.values()) {
  if(group.length<2)continue;
  let q;
  for(let i=0;i<group.length&&!q;i++)for(let j=i+1;j<group.length&&!q;j++) {
   const a=group[i].p,b=group[j].p,u=group[i].other.map((v,k)=>v-a[k]),v=group[j].other.map((n,k)=>n-b[k]),det=u[0]*v[1]-u[1]*v[0];
   if(Math.abs(det)<Math.hypot(...u)*Math.hypot(...v)*.15)continue;
   const t=((b[0]-a[0])*v[1]-(b[1]-a[1])*v[0])/det,c=[a[0]+t*u[0],a[1]+t*u[1]];
   if(group.every(({p})=>Math.hypot(p[0]-c[0],p[1]-c[1])<=tolerance))q=c;
  }
  if(q)for(const {p} of group){p[0]=q[0];p[1]=q[1];}
 }
 return paths;
}

// Use the dense measured skeleton, before polygon simplification. At a tangent
// its short branch is unreliable; the rest of the circumference supplies the fit.
export function measuredCircles(work) {
 const paths=work.paths.filter(p=>p.lt==='v'&&p.measuredPoints?.length>8);
 const pixels=paths.flatMap(p=>p.measuredPoints),stride=Math.max(1,Math.ceil(pixels.length/2400));
 let samples=pixels.filter((_,i)=>i%stride===0);
 const tolerance=Math.max(.85,Math.min(2.5,(work.thickWidth||2)*.24)),found=[];
 // Short fragments have biased individual fits at raster junctions. Seed
 // compatible fragment pairs together, rather than relying on a random triple
 // to land on a small remaining arc after the first circle has been removed.
 const supports=paths.map(path=>({points:path.measuredPoints,fit:circleFit(path.measuredPoints,5)})).filter(s=>s.fit&&s.fit.error<.025&&s.fit.r>8);
 const seeds=supports.map(s=>s.fit);
 // A notch arc can share one skeleton path with its straight mouth wall.
 // Seed local dense runs as well as whole paths; the angular-occupancy and
 // radial-support checks below still have to validate every resulting circle.
 for(const path of paths) {
  const ps=path.measuredPoints;
  for(const fraction of [.35,.55,.75]) {
   const length=Math.max(12,Math.floor(ps.length*fraction)),step=Math.max(4,Math.floor(length/3));
   for(let start=0;start+length<=ps.length;start+=step) {
    const fit=circleFit(ps.slice(start,start+length),5);
    if(fit&&fit.error<.025&&fit.r>8)seeds.push(fit);
   }
  }
 }
 for(let i=0;i<supports.length;i++)for(let j=i+1;j<supports.length;j++) {
  const a=supports[i],b=supports[j],r=Math.max(a.fit.r,b.fit.r);
  if(Math.hypot(a.fit.cx-b.fit.cx,a.fit.cy-b.fit.cy)>r*.3||Math.abs(a.fit.r-b.fit.r)>r*.25)continue;
  const fit=circleFit([...a.points,...b.points],5);if(fit)seeds.push(fit);
 }
 let random=1234567;
 const next=n=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random%n;};
 for(let round=0;round<6&&samples.length>25;round++) {
  const candidates=[...seeds];
  if(!round)for(const p of paths){const ps=p.measuredPoints,trim=Math.min(Math.floor(ps.length/5),Math.ceil((p.width||2)*2));const f=circleFit(ps.slice(trim,ps.length-trim),5);if(f)candidates.push(f);}
  for(let k=0;k<700;k++){const f=circleFit([samples[next(samples.length)],samples[next(samples.length)],samples[next(samples.length)]],3);if(f)candidates.push(f);}
  let best;
  for(const c of candidates){
   if(c.r<Math.max(5,(work.thickWidth||2)*2.5)||c.r>Math.max(work.w,work.h)*1.2||c.cx< -work.w||c.cx>2*work.w||c.cy< -work.h||c.cy>2*work.h)continue;
   const near=samples.filter(p=>radial(p,c)<tolerance),bins=new Set(near.map(p=>Math.floor(((Math.atan2(p[1]-c.cy,p[0]-c.cx)+tau)%tau)*72/tau)));
   if(bins.size<23||near.length<Math.max(24,c.r*1.5/stride))continue;
   const score=bins.size+Math.min(near.length,400)*.06;
   if(!best||score>best.score)best={...c,score};
  }
  if(!best)break;
  for(let k=0;k<4;k++){const ps=samples.filter(p=>radial(p,best)<tolerance*1.5),f=circleFit(ps,5);if(f)best={...best,...f};}
  // Angular occupancy distinguishes a semicircle from a complete ring. Bridge
  // only short losses at raster graph junctions, never an unmeasured quadrant.
  const n=Math.max(48,Math.ceil(tau*best.r/2)),occupied=new Uint8Array(n);
  for(const p of pixels)if(radial(p,best)<tolerance*1.7)occupied[Math.floor(((Math.atan2(p[1]-best.cy,p[0]-best.cx)+tau)%tau)*n/tau)%n]=1;
  // Thinning can collapse a tangent ring onto its adjoining wall. Validate
  // those lost angular samples against the original ink, not a guessed gap.
  if(work.inkMask&&occupied.reduce((sum,v)=>sum+v,0)>n*.7)for(let i=0;i<n;i++) {
   const angle=(i+.5)*tau/n,x=Math.round(best.cx+best.r*Math.cos(angle)),y=Math.round(best.cy+best.r*Math.sin(angle));
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
    const xx=x+dx,yy=y+dy;
    if(xx>=0&&xx<work.w&&yy>=0&&yy<work.h&&work.inkMask[yy*work.w+xx])occupied[i]=1;
   }
  }
  const gapLimit=Math.min(Math.floor(n*.045),Math.ceil((work.thickWidth||2)*4/2));
  const original=occupied.slice();
  for(let i=0;i<n;i++)if(original[i]){let j=1;while(j<n&&!original[(i+j)%n])j++;if(j<=gapLimit)for(let k=1;k<j;k++)occupied[(i+k)%n]=1;}
  const spans=[];
  if(occupied.every(Boolean))spans.push([0,tau]);
  else {const start=occupied.findIndex(v=>!v);let from=null;for(let k=1;k<=n;k++){const i=(start+k)%n;if(occupied[i]&&from===null)from=start+k;if((!occupied[i]||k===n)&&from!==null){const end=start+k; if((end-from)*tau/n>1.2)spans.push([from*tau/n,end*tau/n]);from=null;}}}
  // The sides of a small square can vote for several arcs of an inscribed
  // circle. Before replacing a corner with an arc, look for one connected
  // stroke that follows the radius while measurably bending away from its
  // chord. Separate straight tangencies do not provide that evidence.
  const shortPartial=spans.length&&best.r<8*(work.thickWidth||2)&&spans.every(([a,b])=>b-a<Math.PI);
  if(spans.length&&(!shortPartial||paths.some(p=>containsCircularBend(p.measuredPoints,best,tolerance)))){
   found.push({...best,spans,tolerance});
  }
  samples=samples.filter(p=>radial(p,best)>tolerance*2);
 }
 return found;
}

function containsCircularBend(points,c,tolerance){
 let run=[];
 const bends=()=>{
  if(run.length<7)return false;
  const [x,y]=run[0],last=run.at(-1),dx=last[0]-x,dy=last[1]-y,length=Math.hypot(dx,dy);
  if(length<.75*c.r)return false;
  const middle=run[Math.floor(run.length/2)];
  return Math.abs((middle[0]-x)*dy-(middle[1]-y)*dx)>length*Math.max(1.1,tolerance);
 };
 for(const p of points){
  if(radial(p,c)<=tolerance*1.4){run.push(p);continue;}
  if(bends())return true;
  run=[];
 }
 return bends();
}

export function recoverMeasuredPrimitives(work) {
 // Mixed long inclines require the original shared-junction graph. A circle
 // replacement must not detach a sloping rib from its established contour.
 if(work.paths.some(p=>p.lt==='v'&&p.points.slice(1).some((b,i)=>{
  const a=p.points[i],dx=Math.abs(b[0]-a[0]),dy=Math.abs(b[1]-a[1]);
  return Math.min(dx,dy)>Math.max(dx,dy)*.2&&Math.hypot(dx,dy)>Math.max(work.w,work.h)*.15;
 })))return null;
 const circles=measuredCircles(work);
 if(!circles.length)return null;
 // An ellipse can supply two locally circular halves with incompatible
 // centres. Leave it to the existing ellipse metric instead of inventing rings.
 for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++) {
  const a=circles[i],b=circles[j],d=Math.hypot(a.cx-b.cx,a.cy-b.cy);
  if(Math.abs(a.r-b.r)<Math.max(a.r,b.r)*.15&&d>Math.max(a.tolerance,b.tolerance)*2&&d<Math.max(a.r,b.r)*.3)return null;
  if(d<Math.max(1.5,a.tolerance,b.tolerance)){b.cx=a.cx;b.cy=a.cy;}
 }
 // A tangent wall also lies close to the circle for a short distance. Its
 // ink must not enlarge a semicircle beyond the actual tangent junction.
 for(const c of circles)for(const span of c.spans)if(span[1]-span[0]<tau-.05)for(const end of [0,1]) {
  const angle=span[end],cardinal=Math.round(angle/(Math.PI/2))*Math.PI/2;
  if(Math.abs(angle-cardinal)>.35)continue;
  const axis=Math.abs(Math.cos(cardinal))>.5?0:1,other=1-axis,center=axis?c.cy:c.cx,along=axis?c.cx:c.cy,at=center+c.r*(axis?Math.sin(cardinal):Math.cos(cardinal));
  const supported=work.paths.some(p=>p.lt==='v'&&p.points.slice(1).some((b,i)=>{
   const a=p.points[i];return Math.abs(a[axis]-b[axis])<2&&Math.abs(a[other]-b[other])>Math.max(8,work.thickWidth*3)&&Math.abs((a[axis]+b[axis])/2-at)<Math.max(2,work.thickWidth*.7)&&along>=Math.min(a[other],b[other])-work.thickWidth*5&&along<=Math.max(a[other],b[other])+work.thickWidth*5;
  }));
  if(supported)span[end]=cardinal;
 }
 const onArc=(p,c)=>{const a=(Math.atan2(p[1]-c.cy,p[0]-c.cx)+tau)%tau;return c.spans.some(([lo,hi])=>[a,a+tau,a+tau*2].some(t=>t>=lo-.04&&t<=hi+.04));};
 const inkSupports=(a,b)=>{
  if(!work.inkMask)return false;
  const n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])));let supported=0,gap=0;
  for(let i=0;i<=n;i++) {
   const x=Math.round(a[0]+(b[0]-a[0])*i/n),y=Math.round(a[1]+(b[1]-a[1])*i/n);let found=false;
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<work.w&&y+dy<work.h&&work.inkMask[(y+dy)*work.w+x+dx])found=true;
   if(found){supported++;gap=0;}else if(++gap>Math.max(2,work.thickWidth*2))return false;
  }
  return supported/(n+1)>.85;
 };
 const paths=[];
 for(const source of work.paths){
  const ps=source.measuredPoints;
  if(!ps||source.lt==='ignore'){paths.push({...source,points:source.points.map(p=>[...p])});continue;}
  if(['t','h','c'].includes(source.lt)) {
   const span=axis=>Math.max(...ps.map(p=>p[axis]))-Math.min(...ps.map(p=>p[axis]));
   const axis=span(0)<=4&&span(1)>span(0)*2?0:span(1)<=4&&span(0)>span(1)*2?1:-1;
   if(axis>=0){
    const at=median(ps.map(p=>p[axis]));
    const datums=circles.flatMap(c=>{const center=axis?c.cy:c.cx;return [center-c.r,center,center+c.r];});
    const nearest=datums.sort((a,b)=>Math.abs(a-at)-Math.abs(b-at))[0];
    const value=Math.abs(nearest-at)<Math.max(3,source.width)?nearest:at;
    const points=[ps[0].slice(),ps.at(-1).slice()];points.forEach(p=>p[axis]=value);
    paths.push({...source,points});continue;
   }
  }
  if(source.lt!=='v'){paths.push({...source,points:source.points.map(p=>[...p])});continue;}
  const curved=ps.map((p,i)=>circles.some(c=>{
   if(radial(p,c)>Math.max(c.tolerance*2,(source.width||2)*1.3)||!onArc(p,c))return false;
   const a=ps[Math.max(0,i-4)],b=ps[Math.min(ps.length-1,i+4)],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
   return len&&Math.abs((p[0]-c.cx)*dx+(p[1]-c.cy)*dy)/(c.r*len)<.65;
  }));
  if(curved.filter(Boolean).length>ps.length*.65) {
   // A short straight mouth attached to a long semicircle must survive.
   let run=0,longest=0;
   for(const isCurve of curved){run=isCurve?0:run+1;longest=Math.max(longest,run);}
   if(longest<Math.max(4,(source.width||2)*1.5))continue;
  }
  let start=0,end=ps.length-1;
  while(start<end&&curved[start])start++;
  while(end>start&&curved[end])end--;
  let points=ps.slice(start,end+1);
  if(points.length<3)continue;
  const span=axis=>Math.max(...points.map(p=>p[axis]))-Math.min(...points.map(p=>p[axis]));
  const axis=span(0)<=Math.max(4,source.width*2)&&span(1)>Math.max(5,source.width*4)?0:span(1)<=Math.max(4,source.width*2)&&span(0)>Math.max(5,source.width*4)?1:-1;
  if(axis>=0){
   let at=median(points.map(p=>p[axis]));points=[points[0].slice(),points.at(-1).slice()];points.forEach(p=>p[axis]=at);
   // Intersect a measured straight wall with its neighbouring circle. Moving
   // every point on the wall together avoids the little oblique tangent tails.
   for(const [i,original] of [[0,ps[0]],[1,ps.at(-1)]])for(const c of circles){
    const center=axis?c.cy:c.cx,other=axis?c.cx:c.cy;
    if(Math.abs(Math.abs(at-center)-c.r)<Math.max(1.5,source.width*.6)&&Math.abs(original[1-axis]-other)<source.width*6) {
      at=center+Math.sign(at-center)*c.r;points.forEach(p=>p[axis]=at);
      const tangent=axis?[other,at]:[at,other];if(onArc(tangent,c))points[i]=tangent;
      continue;
    }
    const disc=c.r*c.r-(at-center)**2;if(disc<0)continue;
    const hits=[other-Math.sqrt(disc),other+Math.sqrt(disc)].map(v=>axis?[v,at]:[at,v]);
    const q=hits.sort((a,b)=>Math.hypot(a[0]-original[0],a[1]-original[1])-Math.hypot(b[0]-original[0],b[1]-original[1]))[0];
    if(onArc(q,c)&&Math.hypot(q[0]-original[0],q[1]-original[1])<Math.max(source.width*4,5))points[i]=q;
   }
  }else points=cleanStrokeCorners(simplify(points,.65),Math.max(1.5,(source.width||2)*.6));
  paths.push({...source,points});
 }
 for(let pass=0;pass<2;pass++) {
 for(const path of paths.filter(p=>p.lt==='v'))path.points=simplify(path.points,Math.max(.3,(path.width||2)*.15));
 for(const path of paths.filter(p=>p.lt==='v'))for(let i=1;i<path.points.length;i++) {
  const a=path.points[i-1],b=path.points[i];
  for(const axis of [0,1])if(Math.abs(a[axis]-b[axis])<2&&Math.abs(a[1-axis]-b[1-axis])>Math.max(10,work.thickWidth*3))for(const c of circles) {
   const center=axis?c.cy:c.cx,other=axis?c.cx:c.cy,at=(a[axis]+b[axis])/2;
   if(Math.abs(Math.abs(at-center)-c.r)>Math.max(1.5,work.thickWidth*.6))continue;
   const tangent=axis?[other,center+Math.sign(at-center)*c.r]:[center+Math.sign(at-center)*c.r,other];
   if(!onArc(tangent,c))continue;
   a[axis]=b[axis]=tangent[axis];
   const end=Math.abs(a[1-axis]-other)<Math.abs(b[1-axis]-other)?a:b;
   if(Math.abs(end[1-axis]-other)<work.thickWidth*6||Math.abs(end[1-axis]-other)<c.r*.55&&inkSupports(end,tangent))end[1-axis]=other;
  }
 }
 }
 for(const path of paths.filter(p=>p.lt==='v'))for(const reverse of [false,true]) {
  if(reverse)path.points.reverse();
  while(path.points.length>2) {
   const [a,b,c]=path.points.slice(-3),dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy,t=((c[0]-a[0])*dx+(c[1]-a[1])*dy)/(length||1);
   if(t<0||t>1||Math.hypot(c[0]-a[0]-t*dx,c[1]-a[1]-t*dy)>.15)break;
   path.points.pop();
  }
  if(reverse)path.points.reverse();
 }
 let id=Math.max(0,...work.paths.map(p=>p.id))+1;
 for(const [circleIndex,c] of circles.entries())for(const [lo,hi] of c.spans){
  let from=lo,to=hi;
  if(hi-lo<tau-.05)for(const end of [0,1]) {
   const angle=end?hi:lo,position=[c.cx+c.r*Math.cos(angle),c.cy+c.r*Math.sin(angle)];
   const endpoints=paths.filter(p=>p.lt==='v').flatMap(p=>[p.points[0],p.points.at(-1)]);
   const near=endpoints.filter(p=>radial(p,c)<Math.max(2,c.tolerance*2)&&Math.hypot(p[0]-position[0],p[1]-position[1])<Math.max(4,work.thickWidth*3)).sort((a,b)=>Math.hypot(a[0]-position[0],a[1]-position[1])-Math.hypot(b[0]-position[0],b[1]-position[1]))[0];
   if(near){let a=Math.atan2(near[1]-c.cy,near[0]-c.cx);a+=Math.round((angle-a)/tau)*tau;
    const old=near.slice(),q=[c.cx+c.r*Math.cos(a),c.cy+c.r*Math.sin(a)];
    for(const p of endpoints)if(Math.hypot(p[0]-old[0],p[1]-old[1])<1e-7){p[0]=q[0];p[1]=q[1];}
    if(end)to=a;else from=a;
   }
  }
  const n=Math.max(16,Math.ceil((hi-lo)*c.r));
  const points=Array.from({length:n+1},(_,i)=>{const a=from+(to-from)*i/n,p=[c.cx+c.r*Math.cos(a),c.cy+c.r*Math.sin(a)];p.curved=true;return p;});
  paths.push({id:id++,lt:'v',points,width:work.thickWidth,arc:true,measuredPrimitive:true,measuredCircle:circleIndex});
 }
 alignMeasuredSupports(paths,circles,work.thickWidth||2);
 joinMeasuredJunctions(paths,Math.max(1.5,(work.thickWidth||2)*.75));
 return {paths:cleanPhotoPaths(paths,work,circles),circles};
}

// Mixed sloping outlines retain their original junction graph. Recover only
// supported circular spans here; never refit the attached inclined edges or
// extend a partial arc across its missing angular range.
export function recoverSupportedMeasuredArcs(work) {
 const circles=measuredCircles(work);
 if(!circles.length)return null;
 const paths=work.paths.map(path=>({...path,points:path.points.map(p=>[...p])}));
 let count=0;
 for(const path of paths) {
  if(path.lt!=='v'||!(path.measuredPoints?.length>=9))continue;
  const ps=path.measuredPoints;
  const circle=circles.find(c=>ps.every(p=>radial(p,c)<Math.max(c.tolerance*2,(path.width||2)*.7)));
  if(!circle)continue;
  // An almost straight tangent fragment is not itself a circular arc.
  const angles=ps.map(p=>Math.atan2(p[1]-circle.cy,p[0]-circle.cx));
  for(let i=1;i<angles.length;i++){while(angles[i]-angles[i-1]>Math.PI)angles[i]-=tau;while(angles[i]-angles[i-1]<-Math.PI)angles[i]+=tau;}
  if(Math.max(...angles)-Math.min(...angles)<.3)continue;
  const onSpan=angle=>circle.spans.some(([lo,hi])=>{const a=angle+Math.round(((lo+hi)/2-angle)/tau)*tau;return a>=lo-.06&&a<=hi+.06;});
  if(!angles.every(onSpan))continue;
  path.points=ps.map((p,i)=>{const q=[circle.cx+circle.r*Math.cos(angles[i]),circle.cy+circle.r*Math.sin(angles[i])];q.curved=true;return q;});
  path.arc=true;path.measuredPrimitive=true;path.measuredCircle=circles.indexOf(circle);count++;
 }
 return count?{paths,circles}:null;
}

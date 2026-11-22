import { thinBinary } from './recognize.js';

export function simplify(points, epsilon = 1) {
  if (points.length <= 2) return points;
  const a = points[0], b = points.at(-1), dx = b[0]-a[0], dy = b[1]-a[1];
  let far = 0, index = 0;
  for (let i=1; i<points.length-1; i++) {
    const t = Math.max(0, Math.min(1, ((points[i][0]-a[0])*dx+(points[i][1]-a[1])*dy)/(dx*dx+dy*dy || 1)));
    const d = Math.hypot(points[i][0]-a[0]-t*dx, points[i][1]-a[1]-t*dy);
    if (d>far) { far=d; index=i; }
  }
  return far>epsilon ? [...simplify(points.slice(0,index+1),epsilon).slice(0,-1),...simplify(points.slice(index),epsilon)] : [a,b];
}

export function extractUploadLines({mask,colorMask,darkMask,blackMask,w,h}) {
  // Distance to background records measured stroke width before thinning.
  const distance = new Float32Array(mask.length);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*w+x;
    distance[i]=!mask[i]?0:Math.min(x?distance[i-1]+1:1,y?distance[i-w]+1:1,x&&y?distance[i-w-1]+Math.SQRT2:1e6);
  }
  for(let y=h-1;y>=0;y--) for(let x=w-1;x>=0;x--) {
    const i=y*w+x;
    if(mask[i]) distance[i]=Math.min(distance[i],x+1<w?distance[i+1]+1:1,y+1<h?distance[i+w]+1:1,x+1<w&&y+1<h?distance[i+w+1]+Math.SQRT2:1e6);
  }
  // Preserve thin diagonal answer dashes during simultaneous thinning.
  const skeleton=thinBinary(mask,w,h,colorMask?.some(v=>v)?'guo':'zhang');
  if(!colorMask?.some(v=>v))restoreLostObliqueStrokes(mask,skeleton,w,h);
  const neighbors=i=>{
    const x=i%w,y=Math.floor(i/w),out=[];
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if(!dx&&!dy||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h) continue;
      if(dx&&dy&&(skeleton[y*w+x+dx]||skeleton[(y+dy)*w+x])) continue;
      const j=(y+dy)*w+x+dx;if(skeleton[j])out.push(j);
    }
    return out;
  };
  const seen=new Set(), paths=[],dots=[];
  const edge=(a,b)=>a<b?a+':'+b:b+':'+a;
  const trace=(start,next)=>{
    const ids=[start];let previous=start,current=next;
    seen.add(edge(previous,current));
    for(let guard=0;guard<mask.length;guard++) {
      ids.push(current);const ns=neighbors(current);
      if(ns.length!==2)break;
      const n=ns.find(v=>v!==previous);
      if(seen.has(edge(current,n)))break;
      seen.add(edge(current,n));previous=current;current=n;
    }
    if(ids.length<2)return;
    const widths=ids.map(i=>Math.max(1,2*distance[i]-1)).sort((a,b)=>a-b);
    const width=widths[Math.floor(widths.length*.5)];
    const points=simplify(ids.map(i=>[i%w,Math.floor(i/w)]),Math.max(w,h)<=210?.55:1.1);
    const length=points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
    const colorCount=colorMask?ids.filter(i=>colorMask[i]).length:0;
    // A grey axis can share its first two pixels with a coloured outline.
    // Look inside short strokes as well as at the junction itself.
    const colored=colorCount>=2&&colorCount/ids.length>.25&&
      (ids.length<5||ids.slice(2,-2).some(i=>colorMask[i]));
    if(length<3&&!colored&&!(neighbors(start).length>=3&&neighbors(current).length>=3)){
      dots.push({points,width,length});return;
    }
    const dark=!!darkMask&&ids.filter(i=>darkMask[i]).length/ids.length>.75;
    const black=!!blackMask&&ids.filter(i=>blackMask[i]).length/ids.length>.65;
    paths.push({id:paths.length,points,measuredPoints:ids.map(i=>[i%w,Math.floor(i/w)]),width,length,lt:'v',colored,dark,black});
  };
  for(let i=0;i<skeleton.length;i++) if(skeleton[i]&&neighbors(i).length!==2) for(const n of neighbors(i)) if(!seen.has(edge(i,n)))trace(i,n);
  for(let i=0;i<skeleton.length;i++) if(skeleton[i]) for(const n of neighbors(i)) if(!seen.has(edge(i,n)))trace(i,n);
  for(let i=0;i<skeleton.length;i++)if(skeleton[i]&&!neighbors(i).length)dots.push({points:[[i%w,Math.floor(i/w)],[i%w+.1,Math.floor(i/w)]],width:1,length:.1});
  // Simultaneous thinning can erase all four pixels of an isolated 2x2 dot.
  for(let y=1;y<h-2;y++)for(let x=1;x<w-2;x++){
    const i=y*w+x;if(!mask[i]||mask[i-1]||mask[i-w]||!mask[i+1]||!mask[i+w]||!mask[i+w+1])continue;
    if([0,1,w,w+1].some(d=>skeleton[i+d])||[-w-1,-w+1,-w+2,2,w-1,w+2,2*w-1,2*w,2*w+1,2*w+2].some(d=>mask[i+d]))continue;
    dots.push({points:[[x,y+.5],[x+1,y+.5]],width:2,length:1});
  }
  const weighted=paths.filter(p=>p.length>8).sort((a,b)=>a.width-b.width);
  const total=weighted.reduce((s,p)=>s+p.length,0);
  const quantile=q=>{let sum=0;for(const p of weighted){sum+=p.length;if(sum>=total*q)return p.width;}return 1;};
  const thin=quantile(.2),thick=quantile(.85);
  const fine=quantile(.08);
  const threshold=thick>thin*1.4?(thin+thick)/2:thin>fine*1.4?(thin+fine)/2:0;
  for(const path of paths) path.lt=threshold&&path.width<threshold?'t':'v';
  // Answer curves often use a thin coloured pen. Colour is measured ink,
  // not evidence for a centreline. Repeated dash gaps are still checked below.
  for(const path of paths)if(path.colored||path.dark&&(Math.max(w,h)<=210||path.black))path.lt='v';
  // Raster diagonals and circles can measure thinner than axis-aligned strokes
  // of the same pen. A supported curved stroke must not disappear as a guide.
  for(const path of paths.filter(p=>p.lt==='t'&&p.width>=thick*.55&&p.points.length>=5)) {
    const fit=circleFit(path.points,5);
    if(fit&&fit.error<.035&&fit.r>4&&path.length/fit.r>.5&&path.length/fit.r<Math.PI*2.3)path.lt='v';
  }
  // Raster sampling can make a clear continuous boundary one pixel thinner
  // than another side. Its role as the outside of a closed region outweighs
  // that width estimate; internal guides and open reference lines stay fine.
  if(paths.some(p=>p.lt==='t')) {
    const exterior=new Uint8Array(w*h),queue=new Int32Array(w*h);let head=0,tail=0;
    const push=i=>{if(!mask[i]&&!exterior[i]){exterior[i]=1;queue[tail++]=i;}};
    for(let x=0;x<w;x++){push(x);push((h-1)*w+x);}
    for(let y=0;y<h;y++){push(y*w);push(y*w+w-1);}
    while(head<tail){const i=queue[head++],x=i%w,y=Math.floor(i/w);if(x)push(i-1);if(x+1<w)push(i+1);if(y)push(i-w);if(y+1<h)push(i+w);}
    const enclosed=mask.reduce((sum,value,i)=>sum+(!value&&!exterior[i]?1:0),0);
    if(enclosed>w*h*.02)for(const path of paths.filter(p=>p.lt==='t'&&p.length>thick*3)) {
      const radius=Math.max(2,Math.min(12,Math.ceil(thick+1)));let supported=0,total=0;
      for(let i=1;i<path.points.length;i++) {
        const a=path.points[i-1],b=path.points[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
        for(let t=0;t<steps;t++) {
          const x=Math.round(a[0]+(b[0]-a[0])*(t+.5)/steps),y=Math.round(a[1]+(b[1]-a[1])*(t+.5)/steps);
          let inside=false,outside=false;
          for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++) {
            const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h){outside=true;continue;}
            const j=yy*w+xx;if(!mask[j]){if(exterior[j])outside=true;else inside=true;}
          }
          total++;if(inside&&outside)supported++;
        }
      }
      if(supported/total>.8)path.lt='v';
    }
  }
  // Recognize repeated collinear short strokes as a dashed candidate. Keep gaps.
  for(const horizontal of [true,false]) {
    const lines=paths.flatMap(path=>path.points.slice(1).map((b,i)=>({...path,path,points:[path.points[i],b],length:Math.hypot(b[0]-path.points[i][0],b[1]-path.points[i][1])}))).filter(p=>Math.abs(p.points[0][horizontal?1:0]-p.points[1][horizontal?1:0])<2);
    const groups=[];
    for(const p of lines) {
      const at=(p.points[0][horizontal?1:0]+p.points[1][horizontal?1:0])/2;
      let group=groups.find(g=>Math.abs(g.at-at)<2);if(!group){group={at,paths:[]};groups.push(group);}group.paths.push(p);
    }
    for(const group of groups) {
      // Junctions split a continuous edge into short paths too. Only actual
      // white gaps between merged intervals provide evidence for a dashed line.
      const axis=horizontal?0:1,runs=[];
      for(const p of group.paths.sort((a,b)=>Math.min(...a.points.map(q=>q[axis]))-Math.min(...b.points.map(q=>q[axis])))) {
        const lo=Math.min(...p.points.map(q=>q[axis])),hi=Math.max(...p.points.map(q=>q[axis]));
        const last=runs.at(-1);
        if(last&&lo-last.hi<=2){last.hi=Math.max(last.hi,hi);last.paths.push(p);}
        else runs.push({lo,hi,paths:[p]});
      }
      classifyRhythm(runs, p=>p.path.points.length===2&&p.width<thick*1.3?p.path:null,Math.max(w,h)*.17);
      // True dots may disappear during skeleton tracing. Include isolated ink
      // only when it completes a repeating long-short-long-short cadence.
      const tiny=dots.filter(d=>!d.promoted&&d.points.every(q=>Math.abs(q[1-axis]-group.at)<1.25)).map(d=>({lo:Math.min(...d.points.map(q=>q[axis])),hi:Math.max(...d.points.map(q=>q[axis])),paths:[{path:d}]}));
      const withDots=[...runs,...tiny].sort((a,b)=>a.lo-b.lo);
      classifyCentreRhythm(withDots,p=>p.path);
      // A short centreline through a mounting hole may show only
      // long-dot-long. Both long strokes must pass through a junction;
      // a lone row of unequal dashes is insufficient.
      for(let i=2;i<runs.length;i++){
        const [a,b,c]=runs.slice(i-2,i+1),la=a.hi-a.lo,lb=b.hi-b.lo,lc=c.hi-c.lo,g=b.lo-a.hi,j=c.lo-b.hi;
        const parts=r=>r.paths.filter(p=>p.path.points.length===2&&Math.abs(p.points[0][axis]-p.points[1][axis])>3);
        if(parts(a).length<2||parts(c).length<2||Math.min(la,lc)<10||lb<=0||lb>Math.min(la,lc)*.33||Math.max(la,lc)>Math.min(la,lc)*1.5||Math.min(g,j)<2||Math.max(g,j)>Math.min(g,j)*1.8||Math.max(g,j)>Math.min(la,lc)*.6)continue;
        for(const r of [a,b,c])for(const p of parts(r))markRun({paths:[p]},p=>p.path,'c');
      }
      for(const r of tiny)for(const {path:d} of r.paths)if(d.lt==='c'){d.promoted=true;d.id=paths.length;paths.push(d);}
      const lengths=runs.map(r=>r.hi-r.lo),span=horizontal?w:h,at=group.at/(horizontal?h:w),totalLength=group.paths.reduce((s,p)=>s+p.length,0),lightLength=group.paths.filter(p=>!p.dark&&!p.colored).reduce((s,p)=>s+p.length,0);
      // Light, alternating long/short axial strokes are centre lines. A
      // uniform hidden-wall dash train must retain its hidden-line meaning.
      if(darkMask&&runs.length>=3&&at>.1&&at<.9&&runs.at(-1).hi-runs[0].lo>span*.8&&Math.max(...lengths)>span*.22&&Math.min(...lengths)<span*.055&&Math.max(...lengths)>Math.min(...lengths)*2.5&&lightLength>totalLength*.75)
        for(const p of group.paths.filter(p=>p.path.points.length===2&&!p.dark&&!p.colored)){p.path.lt='c';p.path.dashFragment=true;}
    }
  }
  classifyObliqueDashes(paths);
  classifyDashedCorners(paths);
  excludeClippedCornerInk(paths,mask,w,h);
  return {w,h,paths,inkMask:mask,thinWidth:thin,thickWidth:thick};
}

// Two hidden edges sometimes share a continuous L-shaped corner dash. Its
// two legs must each continue towards a separate, measured train of dashes.
function classifyDashedCorners(paths){
  const axisOf=(a,b)=>[0,1].find(k=>Math.abs(a[k]-b[k])<=1.3&&Math.abs(a[1-k]-b[1-k])>=3);
  const groups=[[],[]];
  for(const p of paths.filter(p=>p.lt==='h'))for(let i=1;i<p.points.length;i++){
    const a=p.points[i-1],b=p.points[i],k=axisOf(a,b);
    if(k!==undefined)groups[k].push({at:(a[k]+b[k])/2,lo:Math.min(a[1-k],b[1-k]),hi:Math.max(a[1-k],b[1-k])});
  }
  const continues=(corner,tip,k)=>{
    const axis=1-k,sign=Math.sign(tip[axis]-corner[axis]),length=Math.abs(tip[axis]-corner[axis]);
    const beyond=groups[k].filter(r=>Math.abs(r.at-tip[k])<1.6).map(r=>({
      gap:sign>0?r.lo-tip[axis]:tip[axis]-r.hi,span:r.hi-r.lo
    })).filter(r=>r.gap>1&&r.span>=2).sort((a,b)=>a.gap-b.gap);
    if(beyond.length<2)return false;
    const dash=beyond[0];
    return dash.gap<=dash.span*.9+2&&length>=dash.span*.4&&length<=dash.span*2.2&&beyond[1].gap<=dash.gap+3*dash.span+3;
  };
  for(const p of paths.filter(p=>!p.manualType&&!p.arc&&['v','t'].includes(p.lt)&&p.points.length===3)){
    const [a,corner,b]=p.points,k=axisOf(a,corner),j=axisOf(corner,b);
    if(k!==undefined&&j!==undefined&&k!==j&&continues(corner,a,k)&&continues(corner,b,j)){p.lt='h';p.dashFragment=true;}
  }
}

// A crop can include the tip of a neighbouring diagram in one corner.
// Check the entire connected ink component, not just a short traced path:
// a corner belonging to the part connects to its much larger outline.
function excludeClippedCornerInk(paths,mask,w,h){
 const span=Math.min(w,h),limit=Math.max(5,span*.17);
 if(!paths.some(p=>p.lt==='v'&&p.length>span*.35))return;
 const clipped=new Set();
 for(const sx of [0,w-1])for(const sy of [0,h-1]){
  const ix=sx?-1:1,iy=sy?-1:1,seen=new Set();
  function inspect(start){
   if(!mask[start]||seen.has(start))return;
   const ids=[start];seen.add(start);let meetsX=false,meetsY=false,inside=true;
   for(let i=0;i<ids.length;i++){
    const p=ids[i],x=p%w,y=Math.floor(p/w);
    meetsX||=x===sx;meetsY||=y===sy;
    if(Math.abs(x-sx)>limit||Math.abs(y-sy)>limit){inside=false;continue;}
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
     const xx=x+dx,yy=y+dy,j=yy*w+xx;
     if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[j]&&!seen.has(j)){seen.add(j);ids.push(j);}
    }
   }
   if(inside&&meetsX&&meetsY)for(const p of ids)clipped.add(p);
  }
  for(let j=0;j<=limit;j++){inspect(sy*w+sx+ix*j);inspect((sy+iy*j)*w+sx);}
 }
 for(const p of paths)if(p.measuredPoints?.length&&p.measuredPoints.every(([x,y])=>clipped.has(y*w+x))){
  p.lt='ignore';p.clippedCorner=true;
 }
}

function markRun(run,unwrap,lt){
 for(const item of run.paths){const p=unwrap(item);if(p&&p.lt!=='c'){p.lt=lt;p.dashFragment=true;}}
}
function classifyRhythm(runs,unwrap,maxLength=Infinity) {
 // Check consecutive triples. A broad gap ends the train; other short edges
 // on the same support do not inherit the classification.
 for(let i=2;i<runs.length;i++){
  const rs=runs.slice(i-2,i+1),ls=rs.map(r=>r.hi-r.lo).sort((a,b)=>a-b),g=[rs[1].lo-rs[0].hi,rs[2].lo-rs[1].hi].sort((a,b)=>a-b);
  if(ls[0]<1||ls[2]>maxLength||ls[2]>ls[1]*2.15||ls[0]<ls[1]*.35||g[0]<2||g[1]>Math.max(4,ls[1]*1.85)||g[1]>g[0]*2.4)continue;
  for(const r of rs)markRun(r,unwrap,'h');
 }
}
function classifyCentreRhythm(runs,unwrap){
 for(let i=3;i<runs.length;i++){
  const rs=runs.slice(i-3,i+1),ls=rs.map(r=>r.hi-r.lo),g=rs.slice(1).map((r,j)=>r.lo-rs[j].hi);
  const long=ls[0]>ls[1]?[ls[0],ls[2]]:[ls[1],ls[3]],short=ls[0]>ls[1]?[ls[1],ls[3]]:[ls[0],ls[2]];
  if(Math.min(...long)<9||Math.max(...long)>Math.min(...long)*1.65||Math.max(...short)>.33*Math.min(...long)||Math.min(...g)<2||Math.max(...g)>Math.min(...g)*1.8||Math.max(...g)>Math.min(...long)*.72)continue;
  if(rs.some(r=>r.paths.some(p=>{const path=unwrap(p);return !path||path.points.length>2;})))continue;
  for(const r of rs)markRun(r,unwrap,'c');
 }
}

// Some two-pixel diagonal components vanish under simultaneous Zhang-Suen
// deletion. Restore only isolated straight oblique components missing from
// that skeleton; keep the established tracing of loops and junctions.
function restoreLostObliqueStrokes(mask,skeleton,w,h) {
 const reference=thinBinary(mask,w,h,'guo'),seen=new Uint8Array(mask.length);
 for(let start=0;start<reference.length;start++)if(reference[start]&&!seen[start]) {
  const ids=[start];seen[start]=1;
  for(let at=0;at<ids.length;at++) {const i=ids[at],x=i%w,y=Math.floor(i/w);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy,j=yy*w+xx;if(xx>=0&&yy>=0&&xx<w&&yy<h&&reference[j]&&!seen[j]){seen[j]=1;ids.push(j);}}
  }
  if(ids.length<6)continue;
  const ps=ids.map(i=>[i%w,Math.floor(i/w)]),mean=[0,1].map(k=>ps.reduce((s,p)=>s+p[k],0)/ps.length);
  let xx=0,xy=0,yy=0;for(const p of ps){const x=p[0]-mean[0],y=p[1]-mean[1];xx+=x*x;xy+=x*y;yy+=y*y;}
  const a=Math.atan2(2*xy,xx-yy)/2,u=[Math.cos(a),Math.sin(a)];
  if(Math.min(Math.abs(u[0]),Math.abs(u[1]))<.3||ps.some(p=>Math.abs((p[0]-mean[0])*u[1]-(p[1]-mean[1])*u[0])>1.6))continue;
  const nearby=i=>{const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&skeleton[i+dy*w+dx])return true;return false;};
  if(ids.filter(nearby).length>=ids.length*.5)continue;
  for(const i of ids){const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)skeleton[i+dy*w+dx]=0;}
  for(const i of ids)skeleton[i]=1;
 }
}

// Recognize oblique dash trains from separated, collinear measured ink, even
// when a one-pixel diagonal has the same width as a coloured outer contour.
// Never join the gaps or infer hidden edges from a single short segment.
export function classifyObliqueDashes(paths) {
 const candidates=paths.flatMap(path=>{
  if(path.arc||path.lt==='c')return [];
  const ps=path.measuredPoints||path.points,trim=ps.length>8?Math.min(4,Math.floor(ps.length*.15)):0,core=trim?ps.slice(trim,-trim):ps;
  const mean=[0,1].map(i=>core.reduce((s,p)=>s+p[i],0)/core.length);
  let xx=0,xy=0,yy=0;for(const p of core){const x=p[0]-mean[0],y=p[1]-mean[1];xx+=x*x;xy+=x*y;yy+=y*y;}
  const angle=Math.atan2(2*xy,xx-yy)/2;
  let u=[Math.cos(angle),Math.sin(angle)];if(u[0]<0)u=u.map(x=>-x);
  const ts=ps.map(p=>(p[0]-mean[0])*u[0]+(p[1]-mean[1])*u[1]);
  const a=mean.map((v,i)=>v+Math.min(...ts)*u[i]),b=mean.map((v,i)=>v+Math.max(...ts)*u[i]),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
  if(len<6||Math.min(Math.abs(dx),Math.abs(dy))<len*.25)return [];
  // A junction can contribute one off-support endpoint. The dense stroke
  // still has to be straight over at least 90% of its measured samples.
  if(ps.filter(p=>Math.abs((p[0]-a[0])*u[1]-(p[1]-a[1])*u[0])<Math.max(1.6,Math.min(3,path.width*.65))).length<ps.length*.9)return [];
  return [{path,a,b,u,len}];
 });
 const visited=new Set();
 for(const seed of [...candidates].sort((a,b)=>b.len-a.len)) {
  if(visited.has(seed.path))continue;
  const group=candidates.filter(c=>!!c.path.colored===!!seed.path.colored&&Math.abs(c.u[0]*seed.u[1]-c.u[1]*seed.u[0])<(c.len<12?.22:.14)&&[c.a,c.b].every(p=>Math.abs((p[0]-seed.a[0])*seed.u[1]-(p[1]-seed.a[1])*seed.u[0])<Math.max(2.2,Math.min(3.5,c.path.width*.7))));
  const runs=[];
  for(const c of group.map(c=>({...c,ts:[c.a,c.b].map(p=>p[0]*seed.u[0]+p[1]*seed.u[1])})).sort((a,b)=>Math.min(...a.ts)-Math.min(...b.ts))) {
   const lo=Math.min(...c.ts),hi=Math.max(...c.ts),last=runs.at(-1);
   if(last&&lo-last.hi<=2.2){last.hi=Math.max(last.hi,hi);last.paths.push(c.path);}else runs.push({lo,hi,paths:[c.path]});
  }
  classifyCentreRhythm(runs,p=>p);
  classifyRhythm(runs,p=>p);
  for(const c of group)if(c.path.dashFragment)visited.add(c.path);
 }
}

// Trace filled-mask boundaries on pixel cell edges, not a low-resolution voxel silhouette.
export function maskLoops(mask,w,h,epsilon=.8) {
  const edges=new Map();
  const add=(x,y,a,b)=>{const key=x+','+y;if(!edges.has(key))edges.set(key,[]);edges.get(key).push([a,b]);};
  const at=(x,y)=>x>=0&&y>=0&&x<w&&y<h&&mask[y*w+x];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(at(x,y)) {
    if(!at(x,y-1))add(x,y,x+1,y);
    if(!at(x+1,y))add(x+1,y,x+1,y+1);
    if(!at(x,y+1))add(x+1,y+1,x,y+1);
    if(!at(x-1,y))add(x,y+1,x,y);
  }
  const loops=[];
  while(edges.size) {
    const start=edges.keys().next().value.split(',').map(Number), pts=[start];let p=start;
    for(let guard=0;guard<=w*h*4;guard++){
      const key=p.join(','),ns=edges.get(key);if(!ns?.length)break;
      p=ns.pop();if(!ns.length)edges.delete(key);pts.push(p);
      if(p[0]===start[0]&&p[1]===start[1])break;
    }
    if(pts.length>8) {
      const cut=Math.floor(pts.length/2);
      const outline=[...simplify(pts.slice(0,cut+1),epsilon).slice(0,-1),...simplify(pts.slice(cut),epsilon)];
      const area=Math.abs(outline.slice(1).reduce((v,p,i)=>v+outline[i][0]*p[1]-p[0]*outline[i][1],0))/2;
      if(area>8)loops.push({points:outline,area});
    }
  }
  return loops.sort((a,b)=>b.area-a.area);
}

export function circleFit(points,minPoints=8) {
  if(points.length<minPoints)return null;
  // Algebraic circle fit, centered to improve conditioning.
  const mx=points.reduce((s,p)=>s+p[0],0)/points.length,my=points.reduce((s,p)=>s+p[1],0)/points.length;
  let xx=0,yy=0,xy=0,bx=0,by=0;
  for(const p of points){const x=p[0]-mx,y=p[1]-my,q=x*x+y*y;xx+=x*x;yy+=y*y;xy+=x*y;bx+=x*q/2;by+=y*q/2;}
  const det=xx*yy-xy*xy;if(Math.abs(det)<1e-8)return null;
  const cx=mx+(bx*yy-by*xy)/det,cy=my+(by*xx-bx*xy)/det;
  const r=points.reduce((s,p)=>s+Math.hypot(p[0]-cx,p[1]-cy),0)/points.length;
  const error=Math.sqrt(points.reduce((s,p)=>s+(Math.hypot(p[0]-cx,p[1]-cy)-r)**2,0)/points.length)/r;
  return {cx,cy,r,error};
}

export function detectCircularFeatures(linework,bounds,inferredRoles=[]) {
  const found=[];
  for(const [role,work] of Object.entries(linework))for(const path of work.paths) {
    if(inferredRoles.includes(role))continue;
    if(path.points.length<5||path.length<25)continue;
    const fit=circleFit(path.points,5);
    if(!fit||fit.error>.045||fit.r<Math.min(work.w,work.h)*.035||fit.r>Math.min(work.w,work.h)*.43)continue;
    // Sparse corners of a rectangular slot can be cocircular. The measured
    // spans between them must also support the circle, not just its vertices.
    if(path.points.slice(1).some((b,i)=>[.25,.5,.75].some(t=>{
      const a=path.points[i],x=a[0]+t*(b[0]-a[0]),y=a[1]+t*(b[1]-a[1]);
      return Math.abs(Math.hypot(x-fit.cx,y-fit.cy)-fit.r)>Math.max(3,fit.r*.035);
    })))continue;
    const chord=Math.hypot(path.points[0][0]-path.points.at(-1)[0],path.points[0][1]-path.points.at(-1)[1]);
    if(path.length/fit.r<1.4||chord>fit.r*2.1)continue;
    const b=bounds[role];if(!b)continue;
    const u=(fit.cx-b.x)/b.w,v=(fit.cy-b.y)/b.h,r=fit.r/b.w;
    if(u-r<.02||u+r>.98||v-fit.r/b.h<.02||v+fit.r/b.h>.98)continue;
    if(found.some(f=>f.role===role&&Math.hypot(f.u-u,f.v-v)<.035&&Math.abs(f.r-r)<.035))continue;
    found.push({role,u,v,r,kind:'unknown'});
  }
  // Tangent end caps joined by two straight walls describe one long slot,
  // not two separate circular holes. Do not let its end-cap candidates warp
  // the measured slot into overlapping complete circles.
  const capsuleCaps=new Set();
  for(let i=0;i<found.length;i++)for(let j=i+1;j<found.length;j++) {
    const a=found[i],b=found[j];if(a.role!==b.role||Math.abs(a.r-b.r)>.025)continue;
    const boundsForRole=bounds[a.role],work=linework[a.role];
    const ca=[a.u*boundsForRole.w,a.v*boundsForRole.h],cb=[b.u*boundsForRole.w,b.v*boundsForRole.h],radius=(a.r+b.r)*boundsForRole.w/2;
    const supportTolerance=Math.max(3,radius*.08);
    const axis=Math.abs(ca[1]-cb[1])<supportTolerance?0:Math.abs(ca[0]-cb[0])<supportTolerance?1:-1;if(axis<0||Math.abs(ca[axis]-cb[axis])<radius*.5)continue;
    const other=1-axis;
    const walls=[-1,1].every(sign=>work.paths.filter(p=>['v','t','h'].includes(p.lt)).some(p=>p.points.slice(1).some((q,k)=>{
      const u=p.points[k],level=boundsForRole[other?'y':'x']+(ca[other]+cb[other])/2+sign*radius;
      return Math.abs(q[other]-u[other])<supportTolerance&&Math.abs((q[other]+u[other])/2-level)<supportTolerance&&Math.abs(q[axis]-u[axis])>Math.abs(ca[axis]-cb[axis])*.5;
    })));
    if(walls){capsuleCaps.add(a);capsuleCaps.add(b);}
  }
  for(let i=found.length-1;i>=0;i--)if(capsuleCaps.has(found[i]))found.splice(i,1);
  for(const feature of found) {
    if(feature.role==='front'&&linework.top&&bounds.top&&!inferredRoles.includes('top')) {
      const tb=bounds.top,work=linework.top;
      const supports=[feature.u-feature.r,feature.u+feature.r].every(u=>{
        const spans=work.paths.filter(p=>p.lt==='h').flatMap(p=>p.points.slice(1).map((b,i)=>[p.points[i],b]))
          .filter(([a,b])=>Math.abs(a[0]-b[0])<3&&[a,b].every(p=>Math.abs((p[0]-tb.x)/tb.w-u)<.035))
          .map(([a,b])=>[Math.min(a[1],b[1]),Math.max(a[1],b[1])]).sort((a,b)=>a[0]-b[0]);
        // Both walls must be dashed, follow the circle's diameter, and reach
        // both ends of the depth. A short blind-hole pair is insufficient.
        if(spans.length<3)return false;
        const covered=spans.reduce((s,[a,b])=>s+b-a,0)/tb.h;
        return covered>.45&&spans[0][0]<=tb.y+tb.h*.12&&spans.at(-1)[1]>=tb.y+tb.h*.88;
      });
      if(supports){feature.kind='through';feature.evidence='主视圆口与俯视贯穿全深度的两条隐藏孔壁对应，判为沿深度贯通的圆孔；可改判';}
    }
    if(feature.role!=='top')continue;
    const b=bounds.top;
    const check=(role,lo,hi)=>{
      const sb=bounds[role],work=linework[role];
      return [lo,hi].every(u=>{
        const points=work.paths.filter(p=>p.lt==='h'||p.lt==='t').flatMap(p=>p.points)
          .filter(p=>Math.abs((p[0]-sb.x)/sb.w-u)<.065);
        if(points.length<2)return false;
        return (Math.max(...points.map(p=>p[1]))-Math.min(...points.map(p=>p[1])))/sb.h>.55;
      });
    };
    if(check('front',feature.u-feature.r,feature.u+feature.r)
      &&check('side',feature.v-feature.r*b.w/b.h,feature.v+feature.r*b.w/b.h)) {
      feature.kind='through';feature.evidence='主视与左视的两组隐藏孔壁均支持贯通';
    }
    if(inferredRoles.includes('side')) {
      const front=linework.front,fb=bounds.front;
      const supports=[feature.u-feature.r,feature.u+feature.r].every(u=>{
        const x=fb.x+u*fb.w,levels=[];
        for(const p of front.paths.filter(p=>p.lt==='v'))for(let i=1;i<p.points.length;i++) {
          const a=p.points[i-1],b=p.points[i];if(Math.abs(b[0]-a[0])<1||x<Math.min(a[0],b[0])||x>Math.max(a[0],b[0]))continue;
          levels.push(a[1]+(b[1]-a[1])*(x-a[0])/(b[0]-a[0]));
        }
        if(levels.length<2)return false;
        const lo=Math.min(...levels),hi=Math.max(...levels),height=hi-lo;
        const hits=front.paths.filter(p=>p.lt==='h'||p.lt==='t').flatMap(p=>p.points).filter(p=>Math.abs(p[0]-x)<fb.w*.05&&p[1]>=lo-fb.h*.04&&p[1]<=hi+fb.h*.04);
        return height>fb.h*.12&&hits.length>=2&&Math.min(...hits.map(p=>p[1]))<=lo+height*.15&&Math.max(...hits.map(p=>p[1]))>=hi-height*.15;
      });
      if(supports){feature.kind='through';feature.evidence='俯视圆口与主视贯穿局部实体高度的两条隐藏孔壁对应；由两图推导，可改判';}
    }
  }
  return found;
}

export function detectPocketRegions(linework,bounds) {
  const found=[];
  for(const [role,work] of Object.entries(linework)) {
    const {w,h}=work,barrier=new Uint8Array(w*h);
    for(const path of work.paths.filter(p=>p.lt==='v'))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i],length=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1]));
      const radius=Math.max(1,Math.round(path.width/2));
      for(let t=0;t<=length;t++) {
        const x=Math.round(a[0]+(b[0]-a[0])*t/(length||1)),y=Math.round(a[1]+(b[1]-a[1])*t/(length||1));
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)if(x+dx>=0&&y+dy>=0&&x+dx<w&&y+dy<h)barrier[(y+dy)*w+x+dx]=1;
      }
    }
    const seen=new Uint8Array(w*h),regions=[];
    for(let seed=0;seed<barrier.length;seed++)if(!barrier[seed]&&!seen[seed]) {
      const queue=[seed];seen[seed]=1;let border=false;
      for(let head=0;head<queue.length;head++) {
        const p=queue[head],x=p%w,y=Math.floor(p/w);if(!x||!y||x===w-1||y===h-1)border=true;
        for(const next of [x?p-1:-1,x+1<w?p+1:-1,y?p-w:-1,y+1<h?p+w:-1])if(next>=0&&!barrier[next]&&!seen[next]){seen[next]=1;queue.push(next);}
      }
      if(!border&&queue.length>w*h*.004)regions.push(queue);
    }
    regions.sort((a,b)=>b.length-a.length);
    for(const region of regions.slice(1)) {
      if(region.length>regions[0].length*.8)continue;
      const mask=new Uint8Array(w*h);for(const p of region)mask[p]=1;
      const loop=maskLoops(mask,w,h,1.2)[0];if(!loop)continue;
      const fit=circleFit(loop.points);if(fit&&fit.error<.05)continue;
      const b=bounds[role];
      const feature={role,kind:'unknown',profile:loop.points.map(p=>[(p[0]-b.x)/b.w,(p[1]-b.y)/b.h]),depth:.4,u:.5,v:.5,r:.1};
      if(role==='top') {
        const fb=bounds.front,lo=Math.min(...feature.profile.map(p=>p[0])),hi=Math.max(...feature.profile.map(p=>p[0]));
        const segments=[];
        for(const path of linework.front.paths.filter(p=>p.lt==='h'||p.lt==='t'))for(let i=1;i<path.points.length;i++) {
          const a=path.points[i-1],b=path.points[i];
          if(Math.abs(a[1]-b[1])>3||Math.abs(a[0]-b[0])<6)continue;
          segments.push({y:((a[1]+b[1])/2-fb.y)/fb.h,lo:(Math.min(a[0],b[0])-fb.x)/fb.w,hi:(Math.max(a[0],b[0])-fb.x)/fb.w});
        }
        for(const segment of segments) {
          const group=segments.filter(s=>Math.abs(s.y-segment.y)<.025);
          const left=Math.min(...group.map(s=>s.lo)),right=Math.max(...group.map(s=>s.hi));
          if(segment.y>.08&&segment.y<.45&&Math.abs(left-lo)<.07&&right>=hi-.04&&right<hi+.4) {
            feature.kind='pocket';feature.depth=segment.y;feature.evidence='俯视封闭槽形与主视水平槽底线对应；切深为图上估计，可修改';break;
          }
        }
      }
      found.push(feature);
    }
  }
  return found.slice(0,5);
}

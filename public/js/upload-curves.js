import {circleFit,simplify} from './upload-lines.js';

// Decide from the dense skeleton, not the few vertices retained by RDP.
// Several raster stair steps can accidentally lie on a circle. A straight
// stroke must have small orthogonal residuals across its whole measured run.
export function isMeasuredStraight(points,strokeWidth=2) {
  if(!points||points.length<12||points.some(p=>p.curved))return false;
  const tolerance=Math.max(.85,Math.min(3,strokeWidth*.3));
  const trim=Math.min(6,Math.floor(points.length*.08)),core=points.slice(trim,points.length-trim);
  const center=[0,1].map(k=>core.reduce((s,p)=>s+p[k],0)/core.length);
  let xx=0,xy=0,yy=0;
  for(const p of core){const x=p[0]-center[0],y=p[1]-center[1];xx+=x*x;xy+=x*y;yy+=y*y;}
  const angle=.5*Math.atan2(2*xy,xx-yy),u=[Math.cos(angle),Math.sin(angle)];
  const residuals=points.map(p=>(p[0]-center[0])*u[1]-(p[1]-center[1])*u[0]);
  const span=Math.hypot(points.at(-1)[0]-points[0][0],points.at(-1)[1]-points[0][1]);
  if(span<12*tolerance||Math.max(...residuals.map(Math.abs))>2*tolerance)return false;
  const rms=Math.sqrt(residuals.reduce((s,d)=>s+d*d,0)/points.length);
  if(rms>=tolerance*.65)return false;
  // A shallow genuine arc can also fit inside the stroke's width. Prefer it
  // when the dense circular model explains the pixels substantially better.
  const circle=circleFit(points,5);
  if(circle) {
    const radialRms=Math.sqrt(points.reduce((s,p)=>s+(Math.hypot(p[0]-circle.cx,p[1]-circle.cy)-circle.r)**2,0)/points.length);
    if(rms>.15&&radialRms<rms*.5)return false;
  }
  return true;
}

// Thinning leaves tiny bevels where two long strokes meet. Recover their
// intersection only within the measured pixel tolerance; keep real short steps.
export function cleanStrokeCorners(points,tolerance=1.5) {
  const out=points.map(p=>{const q=[...p];if(p.curved)q.curved=true;return q;});
  const closed=out.length>3&&Math.hypot(out[0][0]-out.at(-1)[0],out[0][1]-out.at(-1)[1])<1e-8;
  if(closed)out.pop();
  let changed=true;
  while(changed&&out.length>3) {
    changed=false;
    for(let i=closed?0:1;i<(closed?out.length:out.length-2);i++) {
      const n=out.length,a=out[(i+n-1)%n],b=out[i],c=out[(i+1)%n],d=out[(i+2)%n];
      if([a,b,c,d].some(p=>p.curved))continue;
      const u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-c[0],d[1]-c[1]],lu=Math.hypot(...u),lv=Math.hypot(...v);
      if(Math.hypot(c[0]-b[0],c[1]-b[1])>2*tolerance||Math.min(lu,lv)<6*tolerance)continue;
      const det=u[0]*v[1]-u[1]*v[0];
      if(Math.abs(det)<lu*lv*.15)continue;
      const t=((c[0]-a[0])*v[1]-(c[1]-a[1])*v[0])/det,q=[a[0]+t*u[0],a[1]+t*u[1]];
      if(Math.max(Math.hypot(q[0]-b[0],q[1]-b[1]),Math.hypot(q[0]-c[0],q[1]-c[1]))>2*tolerance)continue;
      out[i]=q;
      out.splice((i+1)%n,1);changed=true;break;
    }
  }
  if(closed)out.push([...out[0]]);
  return out;
}

// Fit only measured runs whose radial residual and turning direction agree.
// Sharp corners and straight inclines remain polyline vertices.
export function smoothProfile(points,tolerance=1.5,{preserveJunctions=true,measuredPoints,strokeWidth=2}={}) {
  if(points.some(p=>p.curved))return {points:cleanStrokeCorners(points,tolerance),arcs:0};
  if(isMeasuredStraight(measuredPoints,strokeWidth))return {points:[[...points[0]],[...points.at(-1)]],arcs:0};
  // Junctions already split small arcs into only five or six measured points.
  // Simplifying those again removes the evidence needed to fit their curve.
  // On small scans, simplifying an already circular quarter arc can leave
  // only its endpoints and one midpoint. Test its measured evidence first.
  const measuredCircle=points.length<=96&&circleFit(points,5)?.error<.02;
  const reduced=cleanStrokeCorners(points.length<=12||measuredCircle?points:simplify(points,tolerance),tolerance),out=[];
  let arcs=0;
  for(let i=0;i<reduced.length;) {
    let match=null;
    // Bound the search on noisy scans: considering every remaining suffix at
    // every vertex makes long, non-circular contours cubic in point count.
    for(let end=Math.min(reduced.length-1,i+96);end>=i+4;end--) {
      const run=reduced.slice(i,end+1),fit=circleFit(run,5);
      if(!fit||fit.error>.02||fit.r<tolerance*4)continue;
      if(run.some(p=>Math.abs(Math.hypot(p[0]-fit.cx,p[1]-fit.cy)-fit.r)>tolerance))continue;
      // Vertices alone are insufficient: rectangular corners can be cocircular.
      // The fitted curve must also stay near the measured straight spans.
      if(run.slice(1).some((p,j)=>[.25,.5,.75].some(t=>{
        const a=run[j],x=a[0]+t*(p[0]-a[0]),y=a[1]+t*(p[1]-a[1]);
        return Math.abs(Math.hypot(x-fit.cx,y-fit.cy)-fit.r)>tolerance*1.5;
      })))continue;
      const angles=run.map(p=>Math.atan2(p[1]-fit.cy,p[0]-fit.cx));
      for(let j=1;j<angles.length;j++){while(angles[j]-angles[j-1]>Math.PI)angles[j]-=Math.PI*2;while(angles[j]-angles[j-1]<-Math.PI)angles[j]+=Math.PI*2;}
      const span=angles.at(-1)-angles[0],sign=Math.sign(span);
      if(Math.abs(span)<.45||Math.abs(span)>Math.PI*1.95||angles.slice(1).some((a,j)=>(a-angles[j])*sign<-.025))continue;
      const chord=Math.hypot(run[0][0]-run.at(-1)[0],run[0][1]-run.at(-1)[1]);
      if(chord<6*tolerance||fit.r*(1-Math.cos(Math.abs(span)/2))<1.5*tolerance)continue;
      const count=Math.max(8,Math.ceil(Math.abs(span)*fit.r/2));
      const arc=Array.from({length:count+1},(_,j)=>{const a=angles[0]+span*j/count,p=[fit.cx+fit.r*Math.cos(a),fit.cy+fit.r*Math.sin(a)];p.curved=true;return p;});
      // Preserve graph junctions shared by neighbouring paths.
      if(preserveJunctions){arc[0]=run[0];arc[count]=run.at(-1);}
      match={end,arc};break;
    }
    if(match){out.push(...match.arc.slice(0,-1));if(!preserveJunctions)reduced[match.end]=match.arc.at(-1);i=match.end;arcs++;}
    else {out.push(reduced[i]);i++;}
  }
  return {points:out,arcs};
}

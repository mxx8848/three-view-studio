// Source-only hypotheses for finite troughs, inclined faces and arch supports.
// Parameters come from measured datums; answer images are never inputs here.
import {hiddenSupports} from './upload-joint-solver.js';
import {circleFit} from './upload-lines.js';
import {forkStructureHypotheses} from './upload-fork-structure.js';
import {supportStructureHypotheses} from './upload-support-structures.js';
import {layeredStructureHypotheses} from './upload-layered-structures.js';
const rect=(l,r,t,b)=>[[l,t],[r,t],[r,b],[l,b],[l,t]];
const cut=(role,profile,extra={})=>({role,profile,kind:'through',structural:true,...extra});
const lines=w=>w.paths.filter(p=>!p.arc&&p.lt==='v').flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
const verticals=w=>lines(w).filter(l=>Math.abs(l.a[0]-l.b[0])<.004&&Math.abs(l.a[1]-l.b[1])>.06);
const horizontals=w=>lines(w).filter(l=>Math.abs(l.a[1]-l.b[1])<.004&&Math.abs(l.a[0]-l.b[0])>.06);
const circle=(role,c,extra={})=>({role,u:c.u,v:c.v,r:c.rx,kind:'through',structural:true,...extra});
const box={lo:[0,0,0],hi:[1,1,1]};

// A supported straight slot wall must not retain the raster skeleton's
// horizontal/vertical steps. Fit its dense source samples away from junctions,
// then intersect that support with the measured lip and floor levels.
export function straightenSectionWalls(recon) {
 if(recon.profileStructureFit?.selected==='rounded-web-stepped-wedge') {
  const w=recon.drawing.front,c=recon.bodyProfiles[0].corner;
  // Keep a quarter-round as an arc even when thinning split it at its
  // horizontal tangent; leave the circular bore's independent paths intact.
  const arc=Array.from({length:49},(_,i)=>{const t=-Math.PI/2-i*Math.PI/96;return [c.u+c.rx*Math.cos(t),c.v+c.ry*Math.sin(t)];});
  const near=p=>p[0]>=c.u-c.rx-.015&&p[0]<=c.u+.015&&p[1]>=-.02&&p[1]<=c.v+.02;
  const replace=ps=>{
   const ids=ps.map((p,i)=>near(p)?i:-1).filter(i=>i>=0);if(ids.length<3)return ps;
   const start=ids[0],end=ids.at(-1);if(end-start+1!==ids.length)return ps;
   const run=ps[start][0]>ps[end][0]?arc:[...arc].reverse();return [...ps.slice(0,start),...run,...ps.slice(end+1)];
  };
  for(const path of w.paths.filter(p=>p.lt==='v'&&!p.arc))path.points=replace(path.points);
  w.outline=replace(w.outline);
  for(const path of w.paths.filter(p=>p.lt==='v'&&!p.arc))for(const p of path.points) {
   if(Math.abs(p[0]-(c.u-c.rx))<.012&&p[1]>=c.v-.025&&p[1]<=recon.bodyProfiles[0].points[0][1]+.01){p[0]=c.u-c.rx;if(Math.abs(p[1]-c.v)<.025)p[1]=c.v;}
   if(Math.abs(p[0]-c.u)<.015&&Math.abs(p[1])<.01)p[0]=c.u;
  }
  const profile=recon.bodyProfiles[1].points,a=profile[2],b=profile[1],xAt=y=>a[0]+(b[0]-a[0])*(y-a[1])/(b[1]-a[1]);
  for(const path of w.paths.filter(p=>p.lt==='v'&&!p.arc)) {
   const ids=path.points.map((p,i)=>p[1]>=-.005&&p[1]<=b[1]+.005&&Math.abs(p[0]-xAt(p[1]))<.02?i:-1).filter(i=>i>=0);
   if(ids.length<2)continue;const start=ids[0],end=ids.at(-1);if(end-start+1!==ids.length)continue;
   const old=path.points.slice(start,end+1),ends=[old[0],old.at(-1)].map(p=>[xAt(p[1]),p[1]]);path.points.splice(start,end-start+1,...ends);
   for(const other of w.paths)if(other!==path&&!other.arc)for(const p of other.points)for(let i=0;i<2;i++){const from=i?old.at(-1):old[0];if(Math.hypot(p[0]-from[0],p[1]-from[1])<1e-7){p[0]=ends[i][0];p[1]=ends[i][1];}}
  }
  const bore=recon.features.find(f=>f.role==='front'&&!f.profile),side=recon.drawing.side;
  for(const path of side.paths.filter(p=>!p.arc&&p.points.length===2))if(path.points.every(p=>Math.abs(p[1]-bore.v)<.01))path.lt='c';
  return;
 }
 if(recon.profileStructureFit?.selected!=='arched-inclined-trapezoid-trough')return;
 const w=recon.drawing.side,slot=recon.features.find(f=>f.role==='side'&&f.profile),[o,u,v]=w.sourceMap;
 const top=slot.profile[2][1],bottom=slot.profile[3][1],fits=[];
 for(const [lip,foot] of [[slot.profile[5],slot.profile[4]],[slot.profile[2],slot.profile[3]]]) {
  const at=y=>lip[0]+(foot[0]-lip[0])*(y-top)/(bottom-top);
  for(const path of w.paths.filter(p=>!p.arc&&p.lt==='v')) {
   const indexes=path.points.map((p,i)=>p[1]>=top-.015&&p[1]<=bottom+.015&&Math.abs(p[0]-at(p[1]))<.025?i:-1).filter(i=>i>=0);
   if(indexes.length<4)continue;
   const start=indexes[0],end=indexes.at(-1),old=path.points.slice(start,end+1);
   if(Math.max(...old.map(p=>p[1]))-Math.min(...old.map(p=>p[1]))<(bottom-top)*.8)continue;
   const dense=path.measuredPoints?.map(([x,y])=>o.map((a,i)=>a+x*(u[i]-a)+y*(v[i]-a)))||old;
   const samples=dense.filter(p=>p[1]>top+.04&&p[1]<bottom-.04&&Math.abs(p[0]-at(p[1]))<.025);
   if(samples.length<5)continue;
   const mean=axis=>samples.reduce((n,p)=>n+p[axis],0)/samples.length,x=mean(0),y=mean(1),den=samples.reduce((n,p)=>n+(p[1]-y)**2,0);
   if(den<1e-8)continue;
   const slope=samples.reduce((n,p)=>n+(p[1]-y)*(p[0]-x),0)/den,fit=t=>[x+slope*(t-y),t];
   if(samples.some(p=>Math.abs(p[0]-fit(p[1])[0])*w.sourceSize.w>1.5))continue;
   const a=fit(top),b=fit(bottom),ends=old[0][1]<old.at(-1)[1]?[a,b]:[b,a];
   // Join shared corners in the adjacent horizontal runs too.
   for(const other of w.paths)if(other!==path&&!other.arc)for(const p of other.points)for(const [from,to] of [[old[0],ends[0]],[old.at(-1),ends[1]]])if(Math.hypot(p[0]-from[0],p[1]-from[1])<1e-7){p[0]=to[0];p[1]=to[1];}
   path.points.splice(start,end-start+1,...ends);fits.push({id:path.id,samples:samples.length,maxResidual:Math.max(...samples.map(p=>Math.abs(p[0]-fit(p[1])[0])*w.sourceSize.w))});
  }
 }
 if(fits.length===2)for(const path of w.paths.filter(p=>!p.arc))for(const p of path.points)if(p[0]>=slot.profile[4][0]-.02&&p[0]<=slot.profile[3][0]+.02&&Math.abs(p[1]-bottom)<.02)p[1]=bottom;
 w.straightWallFits=fits;
}
function polygonVertices(points) {
 const out=[];
 for(const p of points)if(!out.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.006))out.push(p);
 let changed=true;
 while(changed&&out.length>3){changed=false;for(let i=0;i<out.length;i++){const a=out[(i+out.length-1)%out.length],b=out[i],c=out[(i+1)%out.length],dx=c[0]-a[0],dy=c[1]-a[1];if(Math.abs((b[0]-a[0])*dy-(b[1]-a[1])*dx)/Math.hypot(dx,dy)<.006){out.splice(i,1);changed=true;break;}}}
 return out;
}

export function measuredRectangles(w) {
 const raw=w.paths.filter(p=>!p.arc&&['v','h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({p:[p.points[i],b],lt:p.lt==='t'?'h':p.lt})));
 const ss=hiddenSupports(raw,w.sourceSize).map(l=>({a:l.p[0],b:l.p[1]}));
 const levels=axis=>ss.filter(l=>Math.abs(l.a[axis]-l.b[axis])<.004&&Math.abs(l.a[1-axis]-l.b[1-axis])>.015).map(l=>(l.a[axis]+l.b[axis])/2).sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>.006);
 const [xs,ys]=[levels(0),levels(1)];
 const coverage=(axis,value,lo,hi)=>{
  const tol=Math.max(.006,1.5/(axis?w.sourceSize.h:w.sourceSize.w));
  const runs=ss.filter(l=>Math.abs(l.a[axis]-value)<tol&&Math.abs(l.b[axis]-value)<tol).map(l=>[Math.min(l.a[1-axis],l.b[1-axis]),Math.max(l.a[1-axis],l.b[1-axis])]).sort((a,b)=>a[0]-b[0]);
  let end=lo,covered=0;
  for(const [a,b] of runs){if(a>end+.035)continue;covered+=Math.max(0,Math.min(hi,b)-Math.max(lo,a,end));end=Math.max(end,b);}
  return covered/(hi-lo)>.65&&end>=hi-.012;
 };
 const out=[];
 for(let i=0;i<xs.length;i++)for(const r of xs.slice(i+1)) {
  const l=xs[i];if(r-l<.08||Math.abs(l+r-1)>.025)continue;
  for(let j=0;j<ys.length;j++)for(const b of ys.slice(j+1)) {
   const t=ys[j];if(b-t<.08||Math.abs(t+b-1)>.025)continue;
   if(coverage(0,l,t,b)&&coverage(0,r,t,b)&&coverage(1,t,l,r)&&coverage(1,b,l,r))out.push({l,r,t,b});
  }
 }
 return out;
}

export function measuredCaps(w,radius) {
 const groups=[];
 const ss=w.paths.filter(p=>!p.arc&&['v','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
 for(const l of ss.filter(l=>Math.abs(l.a[1]-l.b[1])<.004&&Math.abs(l.a[0]-l.b[0])>.015)) {
  const y=l.a[1];let g=groups.find(g=>Math.abs(g.y-y)<.008);
  if(!g){g={y,xs:[]};groups.push(g);}g.xs.push(l.a[0],l.b[0]);
 }
 const good=groups.filter(g=>Math.abs(Math.min(...g.xs)-(.5-radius))<.015&&Math.abs(Math.max(...g.xs)-(.5+radius))<.015).sort((a,b)=>a.y-b.y);
 for(const a of good)for(const b of good)if(a.y<.4&&b.y>.6&&Math.abs(a.y+b.y-1)<.025)return {t:a.y,b:b.y};
}

export function interruptedHiddenRim(w) {
 const ss=w.paths.filter(p=>!p.arc&&['h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
 const groups=[];
 for(const l of ss.filter(l=>Math.abs(l.a[0]-l.b[0])<.004&&l.a[0]>.2&&l.a[0]<.8&&Math.min(l.a[1],l.b[1])>.2&&Math.max(l.a[1],l.b[1])<.8)) {
  let g=groups.find(g=>Math.abs(g.x-l.a[0])<.006);if(!g){g={x:l.a[0],ys:[]};groups.push(g);}g.ys.push(l.a[1],l.b[1]);
 }
 for(const a of groups.filter(g=>g.x<.4))for(const b of groups.filter(g=>Math.abs(g.x+a.x-1)<.025)) {
  const t=Math.min(...a.ys,...b.ys),end=Math.max(...a.ys,...b.ys);
  const caps=[t,end].every(y=>ss.some(l=>Math.abs(l.a[1]-y)<.012&&Math.abs(l.b[1]-y)<.012&&Math.abs(l.a[0]-l.b[0])>.02&&Math.min(Math.abs(l.a[0]-a.x),Math.abs(l.b[0]-a.x))<.02));
  if(a.ys.length>=6&&b.ys.length>=6&&caps&&Math.abs(t+end-1)<.025)return {l:a.x,r:b.x,t,b:end};
 }
}

// Fit the dense source skeleton along each polygon support, trimming junction
// neighbourhoods. Intersections recover true corners instead of rounded or
// shortened thinning endpoints. This pass is limited to the inclined family.
export function measureSectionFrames(recon,linework) {
 const hypotheses=sectionStructureHypotheses(recon,linework);
 if(hypotheses.some(h=>h.family==='rounded-web-stepped-wedge')) {
  const w=recon.drawing.side,[o,u,v]=w.sourceMap,vs=verticals(w),left=Math.min(...vs.filter(l=>Math.abs(l.a[1]-l.b[1])>.25).map(l=>l.a[0])),right=Math.max(...vs.map(l=>l.a[0]));
  if(left>.005&&left<.05&&right>.95) {
   const raw=(x,y)=>[(x-o[0])/(u[0]-o[0]),(y-o[1])/(v[1]-o[1])],lo=raw(left,0),hi=raw(right,1);
   recon.sectionFrames={side:{x:lo[0],y:lo[1],w:hi[0]-lo[0],h:hi[1]-lo[1],outline:w.outline.map(p=>[(p[0]-left)/(right-left),p[1]])}};return true;
  }
 }
 if(hypotheses.some(h=>h.family==='arched-support-end-recess-counterbores')) {
  const w=recon.drawing.front,[o,u,v]=w.sourceMap,c=w.curveDatums.toSorted((a,b)=>b.rx-a.rx)[0];
  const top=c.v-c.ry;
  if(top<-.005&&top>-.04) {
   const x=-o[0]/(u[0]-o[0]),y=(top-o[1])/(v[1]-o[1]),width=1/(u[0]-o[0]),height=(1-top)/(v[1]-o[1]);
   const outline=w.outline.map(p=>[p[0],(p[1]-top)/(1-top)]);
   recon.sectionFrames={front:{x,y,w:width,h:height,outline}};return true;
  }
 }
 const arched=hypotheses.some(h=>h.family==='arched-inclined-trapezoid-trough');
 if(!arched&&!hypotheses.some(h=>h.family==='inclined-dovetail-blind-trough'))return false;
 const frames={};
 for(const role of arched?['front']:['front','side']) {
  const w=recon.drawing[role],[o,u,v]=w.sourceMap;
  if(Math.abs(u[1]-o[1])+Math.abs(v[0]-o[0])>1e-8)return false;
  const raw=p=>[(p[0]-o[0])/(u[0]-o[0]),(p[1]-o[1])/(v[1]-o[1])],rough=polygonVertices(w.outline).map(raw);
  const measured=linework[role].paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points);
  const supports=[];
  for(let i=0;i<rough.length;i++) {
   const a=rough[i],b=rough[(i+1)%rough.length],d=b.map((x,k)=>x-a[k]),len=Math.hypot(...d);
   const ps=measured.filter(p=>{const t=p.reduce((s,x,k)=>s+(x-a[k])*d[k],0)/(len*len);return t>.15&&t<.85&&Math.abs((p[0]-a[0])*d[1]-(p[1]-a[1])*d[0])/len<Math.max(2.5,linework[role].thickWidth);});
   if(ps.length<5)return false;
   const c=[0,1].map(k=>ps.reduce((s,p)=>s+p[k],0)/ps.length),xx=ps.reduce((s,p)=>s+(p[0]-c[0])**2,0),yy=ps.reduce((s,p)=>s+(p[1]-c[1])**2,0),xy=ps.reduce((s,p)=>s+(p[0]-c[0])*(p[1]-c[1]),0),angle=Math.atan2(2*xy,xx-yy)/2;
   supports.push({p:c,d:[Math.cos(angle),Math.sin(angle)]});
  }
  const polygon=supports.map((b,i)=>{const a=supports[(i+supports.length-1)%supports.length],det=a.d[0]*b.d[1]-a.d[1]*b.d[0];if(Math.abs(det)<.1)return null;const t=((b.p[0]-a.p[0])*b.d[1]-(b.p[1]-a.p[1])*b.d[0])/det;return a.p.map((v,k)=>v+t*a.d[k]);});
  if(polygon.some((p,i)=>!p||Math.hypot(...p.map((v,k)=>v-rough[i][k]))>Math.max(5,linework[role].thickWidth*2)))return false;
  const lo=[0,1].map(k=>Math.min(...polygon.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...polygon.map(p=>p[k]))),span=hi.map((v,k)=>v-lo[k]);
  const outline=polygon.map(p=>p.map((v,k)=>(v-lo[k])/span[k]));outline.push(outline[0]);
  frames[role]={x:lo[0],y:lo[1],w:span[0],h:span[1],outline};
 }
 recon.sectionFrames=frames;return true;
}

export function sectionStructureHypotheses(recon,linework) {
 const {front,top,side}=recon.drawing,s=recon.modelSize,out=[...forkStructureHypotheses(recon,linework),...supportStructureHypotheses(recon),...layeredStructureHypotheses(recon)];
 // Rounded rear web with a finite cross-hole, a rising right-hand wedge,
 // and a lower step at its forward end. Both depth limits are observed in
 // the end elevation; a circle alone cannot establish this construction.
 if(linework&&!recon.inferredRoles.includes('front')&&!recon.inferredRoles.includes('side')) {
  const bore=(front.curveDatums||[]).find(c=>c.u>.15&&c.u<.6&&c.v>.1&&c.v<.5&&c.rx>.04&&c.rx<.15);
  const slopes=lines(front).filter(l=>bore&&Math.min(l.a[0],l.b[0])>bore.u+.05&&Math.abs(l.a[0]-l.b[0])>.05&&Math.abs(l.a[1]-l.b[1])>.1);
  const base=horizontals(side).find(l=>l.a[1]>.6&&l.a[1]<.9&&Math.abs(l.a[0]-l.b[0])>.3);
  const upper=horizontals(side).find(l=>l.a[1]<.025&&Math.min(l.a[0],l.b[0])<.04&&Math.max(l.a[0],l.b[0])>.15);
  const step=horizontals(side).find(l=>l.a[1]>.15&&l.a[1]<.6&&Math.max(l.a[0],l.b[0])>.97&&Math.min(l.a[0],l.b[0])>.2);
  const wall=verticals(side).find(l=>l.a[0]>.08&&l.a[0]<.4&&Math.min(l.a[1],l.b[1])<.03&&Math.max(l.a[1],l.b[1])>.1);
  if(bore&&slopes.length>=1&&base&&upper&&step&&wall) {
   const thickness=wall.a[0],stepDepth=Math.min(step.a[0],step.b[0]),baseV=base.a[1],stepV=step.a[1];
   const hidden=side.paths.filter(p=>!p.arc&&(['h','t'].includes(p.lt)||p.lt==='v'&&p.points.length===2&&Math.abs(p.points[0][0]-p.points[1][0])<thickness*.6)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
   const supported=y=>{
    const runs=hidden.filter(l=>Math.abs(l.a[1]-y)<.025&&Math.abs(l.b[1]-y)<.025&&Math.min(l.a[0],l.b[0])<thickness+.015).map(l=>[Math.min(l.a[0],l.b[0]),Math.max(l.a[0],l.b[0])]).sort((a,b)=>a[0]-b[0]);
    return runs.length>=2&&runs.some((r,i)=>i&&r[0]-runs[i-1][1]>.015)&&runs.reduce((n,[a,b])=>n+b-a,0)>thickness*.5;
   };
   const [o,u,v]=front.sourceMap,map=([x,y])=>o.map((a,i)=>a+x*(u[i]-a)+y*(v[i]-a));
   const points=linework.front.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points).filter(p=>{const q=map(p);return q[0]>.08&&q[0]<bore.u-.018&&q[1]>-.015&&q[1]<bore.v-.025&&Math.hypot((q[0]-bore.u)*s.x,(q[1]-bore.v)*s.z)>bore.rx*s.x*1.4;});
   const fit=points.length>12?circleFit(points,5):null;
   if(fit&&fit.error<.015&&supported(bore.v-bore.ry)&&supported(bore.v+bore.ry)&&stepDepth>thickness+.08) {
    const c=map([fit.cx,fit.cy]),R=Math.abs(map([fit.cx+fit.r,fit.cy])[0]-c[0]);
    const tolerance=Math.max(.01,2/front.sourceSize.w);
    if(R>bore.rx*1.4&&Math.abs(c[0]-bore.u)<tolerance&&Math.abs(c[1]-bore.v)<.025&&Math.abs(c[1]-R*s.x/s.z)<.025) {
     const vertices=front.paths.filter(p=>p.lt==='v'&&!p.arc).flatMap(p=>p.points).map(p=>[...p]);const bottom=vertices.filter(p=>p[0]>bore.u+.1&&p[0]<.95&&Math.abs(p[1]-baseV)<.025).sort((a,b)=>a[0]-b[0])[0],topPoint=vertices.filter(p=>p[0]>bore.u+.15&&p[0]<.95&&p[1]<.02).sort((a,b)=>a[1]-b[1])[0];
     if(bottom&&topPoint&&bottom[0]<topPoint[0]&&Math.abs(bottom[1]-baseV)<.025&&topPoint[1]<.03) {
      // Junction thinning shortens the ramp at both ends. Fit its interior
      // support and intersect the observed top/base datums instead of using
      // those rounded endpoints as dimensions.
      const at=y=>topPoint[0]+(bottom[0]-topPoint[0])*y/baseV;
      const samples=linework.front.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points).map(map).filter(p=>p[1]>.08&&p[1]<baseV-.08&&Math.abs(p[1]-stepV)>.025&&Math.abs(p[0]-at(p[1]))<.025);
      if(samples.length<12)return out;
      if(samples.length>=12) {
       const mx=samples.reduce((n,p)=>n+p[0],0)/samples.length,my=samples.reduce((n,p)=>n+p[1],0)/samples.length,den=samples.reduce((n,p)=>n+(p[1]-my)**2,0),m=samples.reduce((n,p)=>n+(p[1]-my)*(p[0]-mx),0)/den;
       if(!Number.isFinite(m)||m>=0||samples.some(p=>Math.abs(p[0]-mx-m*(p[1]-my))*front.sourceSize.w>1.5))return out;
       topPoint[0]=mx-m*my;topPoint[1]=0;bottom[0]=mx+m*(baseV-my);bottom[1]=baseV;
      }
      const radius=c[1]*s.z/s.x,z=1-c[1],left=c[0]-radius,range=[1-thickness,1],target=recon.inferredRoles.includes('top')?'top':'side';
      const arc=Array.from({length:65},(_,i)=>{const t=Math.PI+i*Math.PI/128;return [c[0]+radius*Math.cos(t),c[1]+c[1]*Math.sin(t)];});
      const rear=[[0,baseV],[left,baseV],...arc,[1,0],[1,1],[0,1],[0,baseV]],forward=[[0,baseV],[bottom[0],baseV],[topPoint[0],0],[1,0],[1,1],[0,1],[0,baseV]];
      out.push({family:'rounded-web-stepped-wedge',target,components:[{axis:'y',x:c[0],y:.5,z,r:radius,lo:range[0],hi:1,analyticOnly:true}],boxes:[{lo:[0,0,0],hi:[1,1,1-baseV]},{lo:[left,range[0],0],hi:[1,1,z],analyticOnly:true},{lo:[c[0],range[0],0],hi:[1,1,1],analyticOnly:true}],profiles:[{role:'front',points:rear,meshOnly:true,corner:{u:c[0],v:c[1],rx:radius,ry:c[1]},lo:range[0],hi:1},{role:'front',points:forward,lo:0,hi:range[0]+1e-5}],features:[circle('front',bore,{axialRange:range}),cut('top',rect(-.02,1.02,stepDepth,1.02),{kind:'pocket',depth:stepV})],roundedCorner:{u:c[0],v:c[1],rx:radius,ry:c[1]},explanation:['主视图的圆角与圆孔确定后部带孔立板；左视图的竖线和两条孔壁虚线限定板厚，横孔只贯穿立板。','按左视图的深度分段，将主视截面分别拉伸为后立板和前部斜台；台阶再限定前段高度，不能把立板或高台拉满整个底座。','俯视图按长对正传递斜面的上下端点，再用左视图传递板厚和台阶深度；孔壁仅在立板厚度范围内画虚线。']});
     }
    }
   }
  }
 }
 if(recon.inferredRoles.includes('top')) {
  const roof=(side.curveDatums||[]).find(c=>c.rx>.45&&Math.abs(c.u-.5)<.025&&Math.abs(c.v-c.ry)<.025);
  const bore=(side.curveDatums||[]).find(c=>roof&&c.rx>.08&&c.rx<roof.rx*.7&&Math.hypot(c.u-roof.u,c.v-roof.v)<.02);
  const f=polygonVertices(front.outline||[]),ss=lines(front);
  const slope=ss.find(l=>Math.abs(l.a[0]-l.b[0])>.12&&Math.abs(l.a[1]-l.b[1])>.12);
  const steps=f.filter(p=>p[0]>.15&&p[0]<.95&&p[1]>.06&&p[1]<.8).sort((a,b)=>a[0]-b[0]);
  if(roof&&bore&&slope&&steps.length>=3) {
   const levels=horizontals(front).filter(l=>l.a[1]>.05&&l.a[1]<(roof.v+.04)&&Math.abs(l.a[0]-l.b[0])>.08).sort((a,b)=>b.a[1]-a.a[1]);
   const shoulder=levels[0],upper=levels.find(l=>l.a[1]<shoulder.a[1]-.08);
   const floors=horizontals(side).filter(l=>l.a[1]>roof.v+.1&&l.a[1]<.9&&Math.min(l.a[0],l.b[0])>.2&&Math.max(l.a[0],l.b[0])<.8);
   if(shoulder&&upper&&floors.length) {
    const measuredFloor=floors[0].a[1],floorXs=floors.filter(l=>Math.abs(l.a[1]-measuredFloor)<.008).flatMap(l=>[l.a[0],l.b[0]]),a=Math.min(...floorXs),b=Math.max(...floorXs);
    const lip=side.paths.filter(p=>!p.arc&&p.lt==='v').flatMap(p=>p.points).filter(p=>Math.abs(p[1]-roof.v)<.025&&p[0]>.08&&p[0]<.92&&Math.abs(p[0]-roof.u)>bore.rx+.015);
    const left=lip.filter(p=>p[0]<a).sort((p,q)=>q[0]-p[0])[0],right=lip.filter(p=>p[0]>b).sort((p,q)=>p[0]-q[0])[0];
    const end=Math.max(shoulder.a[0],shoulder.b[0]),back=Math.max(upper.a[0],upper.b[0]);
    const hidden=front.paths.filter(p=>!p.arc&&['h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
    // The two elevations measure the same floor. Jointly fit their supported
    // levels rather than giving a stair-stepped short section absolute weight.
    const floorRuns=hidden.filter(l=>Math.abs(l.a[1]-l.b[1])<.004&&Math.abs(l.a[1]-measuredFloor)<.035&&Math.max(l.a[0],l.b[0])<end+.02);
    const weight=floorRuns.reduce((n,l)=>n+Math.abs(l.a[0]-l.b[0]),0);
    const floor=weight>.15?(measuredFloor+floorRuns.reduce((n,l)=>n+l.a[1]*Math.abs(l.a[0]-l.b[0]),0)/weight)/2:measuredFloor;
    const supported=y=>hidden.filter(l=>Math.abs(l.a[1]-y)<.025&&Math.abs(l.b[1]-y)<.025).reduce((n,l)=>n+Math.abs(l.a[0]-l.b[0]),0)>(1-end)*.55;
    const inclined=(lip,base)=>lip&&side.paths.filter(p=>!p.arc&&p.lt==='v').flatMap(p=>p.points).filter(p=>p[1]>roof.v+.04&&p[1]<measuredFloor-.03&&Math.abs(p[0]-(lip[0]+(base-lip[0])*(p[1]-roof.v)/(measuredFloor-roof.v)))<.025).length>=4;
    if(left&&right&&inclined(left,a)&&inclined(right,b)&&b-a>.08&&end<back-.05&&supported(bore.v-bore.ry)&&supported(bore.v+bore.ry)&&supported(floor)) {
     const topV=upper.a[1],R=s.y/(2*s.x),z=1-R*s.x/s.z;
     if(Math.abs(z-(1-roof.v))*side.sourceSize.h>2||Math.abs(roof.u-.5)*side.sourceSize.w>1)return out;
     const slopePoints=[slope.a,slope.b].sort((a,b)=>a[0]-b[0]),p=slopePoints[0],q=slopePoints[1],nose=f.filter(p=>p[0]<.03).sort((a,b)=>a[1]-b[1])[0];
     // Start the upper cutter in the air ahead of the arch. Coincident cutter
     // and arch caps otherwise leave zero-thickness triangular skins in CSG.
     out.push({family:'arched-inclined-trapezoid-trough',target:'top',components:[{axis:'x',x:.5,y:.5,z,r:R,lo:end,hi:1}],boxes:[{lo:[0,0,0],hi:[1,1,z]}],features:[circle('side',bore,{axialRange:[end,1]}),cut('side',[[left[0],-.02],[right[0],-.02],[right[0],roof.v],[b,floor],[a,floor],[left[0],roof.v],[left[0],-.02]],{axialRange:[0,end]}),cut('front',[[0,-.02],[q[0],-.02],[q[0],1-z],nose,[0,-.02]]),cut('front',rect(end-.001,back,-.02,topV))],explanation:['左视图的圆拱和圆孔确定后部拱壁与沿长度方向贯穿后壁的横孔，主视台阶限定拱壁和削平段的长度。','左视图的两条斜槽壁与共同槽底确定梯形槽截面，主视图的隐藏槽底和终止壁确定槽只开到后壁前端；前部斜面与槽壁相交形成俯视图两条斜线。','按长对正传递台阶与斜面端点，借助 45° 转向线传递槽口和槽底宽度。圆孔在后壁俯视投影中画成两条虚线，不能把整个槽切成贯通孔。']});
    }
   }
  }
 }
 if(recon.inferredRoles.includes('side')) {
  const roof=(front.curveDatums||[]).find(c=>c.rx>.12&&c.rx<.4&&Math.abs(c.u-.5)<.025&&Math.abs(c.v-c.ry)<.025);
  const bore=(front.curveDatums||[]).find(c=>roof&&c.rx<roof.rx*.8&&c.rx>roof.rx*.2&&Math.hypot(c.u-roof.u,c.v-roof.v)<.015);
  if(roof&&bore) {
   const l=roof.u-roof.rx,r=roof.u+roof.rx;
   const walls=[l,r].map(x=>verticals(front).find(t=>Math.abs(t.a[0]-x)<.015&&Math.min(t.a[1],t.b[1])<roof.v+.04&&Math.max(t.a[1],t.b[1])>roof.v+.1));
   if(walls.every(Boolean)) {
    const baseV=walls.reduce((sum,t)=>sum+Math.max(t.a[1],t.b[1]),0)/2;
    const slopes=lines(front).filter(t=>Math.abs(t.a[0]-t.b[0])>.1&&Math.abs(t.a[1]-t.b[1])>.1);
    const diagonalAt=(x,y)=>slopes.some(t=>{const dx=t.b[0]-t.a[0],dy=t.b[1]-t.a[1],u=((x-t.a[0])*dx+(y-t.a[1])*dy)/(dx*dx+dy*dy);return u>-.06&&u<1.06&&Math.abs((x-t.a[0])*dy-(y-t.a[1])*dx)/Math.hypot(dx,dy)<.02;});
    const wingLevels=x=>horizontals(top).filter(t=>Math.min(t.a[0],t.b[0])<x+.015&&Math.max(t.a[0],t.b[0])>x-.015&&t.a[1]>.05&&t.a[1]<.95).map(t=>t.a[1]).sort((a,b)=>a-b).filter((v,i,a)=>!i||v-a[i-1]>.01);
    const a=wingLevels(l/2),b=wingLevels((1+r)/2);
    const ends=[l,r].every(x=>verticals(top).filter(t=>Math.abs(t.a[0]-x)<.015).reduce((sum,t)=>sum+Math.abs(t.a[1]-t.b[1]),0)>.9);
    // A raster corner can split the notch ceiling into short collinear runs.
    // Require measured coverage of the complete ceiling, including those runs.
    const ceilings=lines(front).filter(t=>Math.abs(t.a[1]-t.b[1])<.004&&t.a[1]>baseV+.05&&t.a[1]<.98);
    const notch=ceilings.map(t=>{
     const runs=ceilings.filter(q=>Math.abs(q.a[1]-t.a[1])<.004),xs=runs.flatMap(q=>[q.a[0],q.b[0]]);
     return {a:[Math.min(...xs),t.a[1]],b:[Math.max(...xs),t.a[1]],coverage:runs.reduce((sum,q)=>sum+Math.abs(q.a[0]-q.b[0]),0)};
    }).find(t=>Math.abs(t.a[0]-l)<.025&&Math.abs(t.b[0]-r)<.025&&t.coverage>(r-l)*.9);
    const through=[bore.u-bore.rx,bore.u+bore.rx].every(x=>{
     const runs=top.paths.filter(p=>['h','t'].includes(p.lt)&&!p.arc).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b}))).filter(t=>Math.abs(t.a[0]-x)<.015&&Math.abs(t.b[0]-x)<.015&&Math.abs(t.a[1]-t.b[1])>.015);
     return runs.length>=2&&Math.min(...runs.flatMap(t=>[t.a[1],t.b[1]]))<.04&&Math.max(...runs.flatMap(t=>[t.a[1],t.b[1]]))>.96;
    });
    if(ends&&notch&&through&&a.length===2&&b.length===2&&a.every((v,i)=>Math.abs(v-b[i])<.015)&&diagonalAt(l/2,(roof.v+baseV)/2)&&diagonalAt((1+r)/2,(roof.v+baseV)/2)) {
     // An interior overlap avoids coincident box caps in CSG. It lies inside
     // the union and changes none of the measured exterior supports.
     const t=(a[0]+b[0])/2,end=(a[1]+b[1])/2,z=1-roof.v,base=1-baseV,overlap=1e-5;
     out.push({family:'round-lug-finite-side-ribs',target:'side',components:[{axis:'y',x:roof.u,y:.5,z,r:roof.rx,lo:0,hi:1}],boxes:[{lo:[0,0,0],hi:[1,1,base]},{lo:[l,0,base-overlap],hi:[r,1,z]},{lo:[0,1-end,base-overlap],hi:[l+overlap,1-t,z]},{lo:[r-overlap,1-end,base-overlap],hi:[1,1-t,z]}],features:[circle('front',bore),cut('front',rect(l,r,notch.a[1],1)),cut('front',[[0,0],[l,0],[l,roof.v],[0,baseV],[0,0]]),cut('front',[[r,0],[1,0],[1,baseV],[r,roof.v],[r,0]])],explanation:['主视图的半圆顶、直立壁和圆孔确定沿深度贯通的圆头立座及横孔，底部矩形缺口贯穿底座。','俯视图两侧各有两条横向实线，限定斜肋的前后端面。斜肋只占中间这一段深度，不能把主视图的三角形沿整个深度拉伸。','左视外框由立座高度和底座深度确定；在两条肋端面之间画出肋顶与立壁的接合线，两侧端面落在底座上。横孔上下孔壁及底部缺口顶面按实际遮挡画虚线。']});
    }
   }
  }
 }
 if(recon.inferredRoles.includes('front')) {
  const outer=(top.curveDatums||[]).filter(c=>c.rx>.25&&c.u<.48&&Math.abs(c.v-.5)<.03).sort((a,b)=>b.rx-a.rx)[0];
  const bore=(top.curveDatums||[]).find(c=>outer&&c.rx<outer.rx*.7&&c.rx>.05&&Math.hypot(c.u-outer.u,c.v-outer.v)<.02);
  const roof=(side.curveDatums||[]).find(c=>c.rx>.45&&Math.abs(c.u-.5)<.025);
  const trough=(side.curveDatums||[]).find(c=>roof&&c.rx<roof.rx*.7&&c.rx>.06&&Math.abs(c.u-roof.u)<.02&&c.v>roof.v+.08);
  if(outer&&bore&&roof&&trough&&Math.abs(bore.rx*s.x-trough.rx*s.y)<s.x*.015) {
   const rim=verticals(top).filter(l=>l.a[0]>.55&&l.a[0]<.98).sort((a,b)=>a.a[0]-b.a[0]);
   const shoulder=rim.find(l=>Math.min(l.a[1],l.b[1])<.03&&Math.max(l.a[1],l.b[1])<.45);
   const stop=rim.find(l=>Math.abs(Math.min(l.a[1],l.b[1])-(trough.u-trough.rx))<.025&&Math.max(l.a[1],l.b[1])>.48);
   const walls=[trough.u-trough.rx,trough.u+trough.rx].every(y=>horizontals(top).some(l=>Math.abs(l.a[1]-y)<.025&&Math.abs(l.a[0]-l.b[0])>.25));
   if(shoulder&&stop&&stop.a[0]>shoulder.a[0]+.03&&walls) {
    const z=1-trough.v,lo=shoulder.a[0],end=stop.a[0],R=s.y/(2*s.x),roofZ=1-s.y/(2*s.z);
    // Tangent bounding planes are measured too. Enforce them only when the
    // unconstrained arc endpoints already agree to less than two pixels.
    if(Math.abs(outer.u-R)*top.sourceSize.w>2||Math.abs(outer.rx-R)*top.sourceSize.w>2||Math.abs(roofZ-(1-roof.v))*side.sourceSize.h>2)return out;
    const jointR=(bore.rx+trough.rx*s.y/s.x)/2,jointV=(bore.v+trough.u)/2;
    const coaxial=Math.abs(bore.v-trough.u)*side.sourceSize.w<1.5&&Math.abs(bore.rx-trough.rx*s.y/s.x)*top.sourceSize.w<1.5;
    const b=coaxial?{...bore,rx:jointR,v:jointV}:bore,t=coaxial?{...trough,rx:jointR*s.x/s.y,u:jointV}:trough;
    out.push({family:'d-base-blind-u-trough-bore',target:'front',components:[{axis:'x',x:.5,y:.5,z:roofZ,r:R,lo,hi:1},{axis:'z',x:R,y:.5,z:.5,r:R,lo:0,hi:z}],boxes:[{lo:[lo,0,0],hi:[1,1,roofZ]},{lo:[R,0,0],hi:[1,1,z]}],features:[circle('top',b),circle('side',t,{axialRange:[0,end]}),cut('top',rect(0,end,t.u-t.rx,t.u+t.rx),{kind:'pocket',depth:t.v})],explanation:['俯视图的半圆端外形与直边确定 D 形底座，左视图的外圆弧确定后部拱壁。','俯视槽的终止直边确定横向 U 槽为盲槽；后部保留壁厚，不能切成通槽。','圆孔沿高度贯穿底座，与 U 槽圆柱面相交。相贯线由两圆柱方程的公共点确定，再投到主视图；被实体遮挡的槽底边画虚线。']});
   }
  }
 }
 if(recon.inferredRoles.includes('top')) {
  const c=(front.curveDatums||[]).find(c=>Math.abs(c.v)<.025&&c.rx>.06&&c.rx<.35);
  const f=polygonVertices(front.outline||[]),q=polygonVertices(side.outline||[]);
  const topEnds=f.filter(p=>p[1]<.025),slope=q.find(p=>p[0]>.1&&p[0]<.9&&p[1]<.025);
  const notch=f.filter(p=>p[1]>.3&&p[1]<.95&&p[0]>.1&&p[0]<.9);
  // A dovetail mouth must have two actual inclined walls and a common floor.
  if(c&&topEnds.length>=2&&slope&&notch.length===2&&Math.abs(notch[0][1]-notch[1][1])<.015) {
   const floor=notch[0][1],ends=f.filter(p=>p[1]>.98).sort((a,b)=>a[0]-b[0]);
   const hidden=side.paths.filter(p=>['h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b})));
   const stops=hidden.filter(l=>Math.abs(l.a[0]-l.b[0])<.004&&Math.abs(l.a[1]-l.b[1])>.04&&l.a[0]>.04&&l.a[0]<slope[0]-.04);
   if(ends.length===4&&stops.length>=2) {
    const stop=stops.sort((a,b)=>a.a[0]-b.a[0])[0].a[0],left=Math.min(...topEnds.map(p=>p[0])),right=Math.max(...topEnds.map(p=>p[0])),ns=notch.sort((a,b)=>a[0]-b[0]);
    const trough=Math.abs(c.v)*front.sourceSize.h<2?{...c,v:0}:c;
    out.push({family:'inclined-dovetail-blind-trough',target:'top',components:[],boxes:[box],features:[cut('front',[[0,0],[left,0],ends[0],[0,1],[0,0]]),cut('front',[[right,0],[1,0],[1,1],ends[3],[right,0]]),cut('front',[ns[0],ns[1],ends[2],ends[1],ns[0]]),cut('side',[[slope[0],0],[1,0],[1,1],[slope[0],0]]),circle('front',trough,{axialRange:[0,1-stop]})],explanation:['主视图确定左右斜边和下部燕尾槽，左视图确定沿深度倾斜的后表面。三组斜面共同约束实体。','上部半圆是横向圆柱槽的截面。左视图的虚线终止壁确定槽的起点，槽另一端开在斜面上。','圆柱槽与斜面相交，在俯视图形成曲线；逐点联立圆柱面和斜面求交，再用 45° 转向线传递深度。燕尾槽被上方材料遮挡的棱边画虚线，开口边画实线。']});
   }
  }
 }
 if(recon.inferredRoles.includes('side')) {
  const arcs=(front.curveDatums||[]).filter(c=>Math.abs(c.u-.5)<.02&&Math.abs(c.v-1)<.02).sort((a,b)=>b.rx-a.rx);
  const ends=(top.curveDatums||[]).filter(c=>c.rx>.1&&c.rx<.23&&Math.abs(c.v-.5)<.02).sort((a,b)=>a.u-b.u);
  const holes=(top.curveDatums||[]).filter(c=>c.rx>.025&&c.rx<.1&&Math.abs(c.v-.5)<.02).sort((a,b)=>a.u-b.u);
  const rims=measuredRectangles(top);
  if(arcs.length===3&&ends.length===2&&holes.length===2) {
   const main=measuredCaps(top,arcs[0].rx);
   const small=measuredCaps(top,arcs[1].rx);
   const cavity=rims.find(r=>(r.r-r.l)/2>arcs[1].rx+.012&&(r.r-r.l)/2<arcs[0].rx-.012&&r.t>.1&&r.t<.3);
   const boss=rims.find(r=>r.l>.3&&r.l<.4&&r.t>.23&&r.t<.35);
   const aperture=rims.find(r=>r.l>.4&&r.l<.47&&r.t>.32&&r.t<.47);
   const ledges=horizontals(front).filter(l=>l.a[1]>.5&&l.a[1]<.85&&Math.min(l.a[0],l.b[0])<.02);
   if(main&&small&&cavity&&boss&&aperture&&ledges.length) {
    const h=1-ledges[0].a[1],R=ends.reduce((v,c)=>v+c.ry*s.y/s.x,0)/2,y=.5;
    const components=[{axis:'y',x:arcs[0].u,y:.5,z:1-arcs[0].v,r:arcs[0].rx,lo:1-main.b,hi:1-main.t},{axis:'y',x:arcs[1].u,y:.5,z:1-arcs[1].v,r:arcs[1].rx,lo:1-small.b,hi:1-small.t},...[R,1-R].map(x=>({axis:'z',x,y,z:.5,r:R,lo:0,hi:h}))];
    out.push({family:'stepped-arch-foot-boss-aperture',target:'side',components,boxes:[{lo:[R,y-R*s.x/s.y,0],hi:[1-R,y+R*s.x/s.y,h]},{lo:[boss.l,1-boss.b,0],hi:[boss.r,1-boss.t,1]}],features:[circle('front',arcs[2]),circle('front',{u:arcs[0].u,v:arcs[0].v,rx:(cavity.r-cavity.l)/2},{axialRange:[1-cavity.b,1-cavity.t]}),cut('top',rect(aperture.l,aperture.r,aperture.t,aperture.b)),...holes.map(c=>circle('top',c))],explanation:['主视图的同心半圆弧确定分段拱体与台阶孔，俯视图中各段端面确定它们沿深度的范围。','两侧圆耳构成底脚，圆心处是沿高度贯通的安装孔；顶部矩形凸台另有矩形贯通口，不能把所有封闭矩形都解释成凹槽。','先按高平齐转移拱顶、凸台和底脚高度，再用俯视图经 45° 转向线传递各段深度。内孔与凸台开口的遮挡棱边用虚线表示。']});
   }
  }
  const outer=(front.curveDatums||[]).find(c=>c.rx>.22&&c.rx<.4&&Math.abs(c.u-.5)<.025&&c.v>.2&&c.v<.8);
  const frontHole=(front.curveDatums||[]).find(c=>outer&&c.rx<outer.rx*.4&&Math.hypot(c.u-outer.u,c.v-outer.v)<.025);
  const topHole=(top.curveDatums||[]).find(c=>c.rx>.03&&c.rx<.12&&Math.abs(c.u-.5)<.025&&Math.abs(c.v-.5)<.025);
  // Inner and outer arcs of one counterbore share a mouth centre. Primitive
  // recovery may now expose both; one end still represents only one notch.
  const notchArcs=(top.curveDatums||[]).filter(c=>c.rx>.08&&c.rx<.2&&(c.u<.02||c.u>.98));
  const notches=[notchArcs.filter(c=>c.u<.02),notchArcs.filter(c=>c.u>.98)].map(a=>a.sort((a,b)=>b.rx-a.rx)[0]).filter(Boolean);
  if(linework&&outer&&frontHole&&topHole&&notches.length===2) {
   const map=(role,p)=>{const[a,b,c]=recon.drawing[role].sourceMap;return a.map((v,k)=>v+p[0]*(b[k]-v)+p[1]*(c[k]-v));};
   const shallow=linework.front.paths.filter(p=>p.lt==='v'&&p.measuredPoints?.length>12).map(p=>({p,fit:circleFit(p.measuredPoints,5)})).filter(({fit})=>fit&&fit.error<.015&&fit.cy<0&&fit.r>linework.front.w*.2);
   const points=shallow.flatMap(({p})=>p.measuredPoints),fit=points.length>25?circleFit(points,5):null;
   const cap=measuredCaps(top,outer.rx);
   const cavity=rims.find(r=>r.l>.25&&r.l<.35&&r.t>.2&&r.t<.35)||interruptedHiddenRim(top);
   const upper=horizontals(front).filter(l=>Math.min(l.a[0],l.b[0])<.02&&l.a[1]>.6&&l.a[1]<.9)[0];
   // The two shallow arcs are the same circle on the two end bands.
   // Its centre may be outside the drawing; a short arc is not a full bore.
   if(fit&&fit.error<.015&&cap&&cavity&&upper) {
    const center=map('front',[fit.cx,fit.cy]),radius=Math.abs(map('front',[fit.cx+fit.r,fit.cy])[0]-center[0]);
    const recessEdges=top.paths.filter(p=>!p.arc&&p.lt==='v').flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b}))).filter(l=>Math.abs(l.a[1]-l.b[1])<.004&&l.a[1]>cap.t+.035&&l.a[1]<.3&&Math.min(l.a[0],l.b[0])<.35&&Math.max(l.a[0],l.b[0])>.4);
    const end=recessEdges.sort((a,b)=>a.a[1]-b.a[1])[0]?.a[1];
    if(end&&center[1]<0) {
     const zBase=1-upper.a[1],R=outer.rx,roofCenter=1-R*s.x/s.z,zCenter=Math.abs(roofCenter-(1-outer.v))*front.sourceSize.h<2?roofCenter:1-outer.v,bodyL=outer.u-R,bodyR=outer.u+R;
     const features=[circle('front',frontHole),circle('top',topHole),circle('front',{u:outer.u,v:outer.v,rx:(cavity.r-cavity.l)/2},{axialRange:[1-cavity.b,1-cavity.t]}),...[ [cap.t,end],[1-end,cap.b] ].map(([a,b])=>circle('front',{u:center[0],v:center[1],rx:radius},{axialRange:[1-b,1-a]}))];
     // Counterbore floors are measured horizontal hidden supports in elevation.
     const floors=front.paths.filter(p=>['h','t'].includes(p.lt)&&!p.arc).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b}))).filter(l=>Math.abs(l.a[1]-l.b[1])<.004&&Math.min(l.a[0],l.b[0])<.08&&l.a[1]>upper.a[1]+.03&&l.a[1]<.97);
     const floor=floors[0]?.a[1];
     // Hidden upright walls continue below the semicircle to the base: this
     // is an arched opening, not a closed round bore with a curved floor.
     const chamber=features[2];
     features.push(cut('front',rect(chamber.u-chamber.r,chamber.u+chamber.r,chamber.v,1),{axialRange:chamber.axialRange}));
     if(floor)for(const c of notches) {
      const work=linework.top,[a,b,d]=top.sourceMap,radial=new Map(),metric=s.y/s.x;
      for(let y=0;y<work.h;y++)for(let x=0;x<work.w;x++)if(work.inkMask[y*work.w+x]) {
       const q=[a[0]+x*(b[0]-a[0]),a[1]+y*(d[1]-a[1])],dx=q[0]-c.u,dy=(q[1]-c.v)*metric,r=Math.hypot(dx,dy);
       if(r<c.rx*.35||r>c.rx*.85)continue;
       const bin=Math.round(r*top.sourceSize.w),angle=Math.floor((Math.atan2(dy,dx)+Math.PI)*36/Math.PI);
       if(!radial.has(bin))radial.set(bin,new Set());radial.get(bin).add(angle);
      }
      const best=[...radial].sort((a,b)=>b[1].size-a[1].size)[0];
      if(!best||best[1].size<20)return out;
      features.push(circle('top',{...c,rx:best[0]/top.sourceSize.w}),circle('top',c,{axialRange:[1-floor,zBase]}));
     }
     if(floor)out.push({family:'arched-support-end-recess-counterbores',target:'side',components:[{axis:'y',x:outer.u,y:.5,z:zCenter,r:R,lo:1-cap.b,hi:1-cap.t}],boxes:[{lo:[0,0,0],hi:[1,1,zBase]},{lo:[bodyL,1-cap.b,0],hi:[bodyR,1-cap.t,zCenter]}],features,explanation:['主视图确定拱形主体、横向小孔和两端浅圆弧凹口；俯视图确定各段在深度方向的位置。','中部拱形腔只存在于俯视虚线矩形限定的区段，下部直壁通到底板。顶部竖孔与横孔、拱形腔相交，左视图会出现两条不同高度的交线。','底板两端为开口安装槽，外圈只切到实测沉孔底面，内圈贯穿底板。先补阶梯外形，再求孔口交线，最后补被遮挡的孔壁和沉孔底线。']});
    }
   }
  }
 }
 return out;
}

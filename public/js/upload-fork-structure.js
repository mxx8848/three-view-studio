// Open fork in a recessed inclined body with a finite raised round lug.
// Every depth is constrained by elevation evidence, never by a circle alone.
import {circleFit} from './upload-lines.js';
export function hasForkEvidence(recon) {
 if(!recon.inferredRoles?.includes('side'))return false;
 const {front,top}=recon.drawing,cs=top.curveDatums||[];
 const outer=cs.find(c=>c.u>.6&&c.rx>.14&&c.rx<.35);
 return !!(outer&&cs.some(c=>c.rx<outer.rx*.7&&Math.hypot(c.u-outer.u,c.v-outer.v)<.025)&&cs.some(c=>c.u<.3&&c.rx>.05&&c.rx<.22)&&front.paths.some(p=>!p.arc&&p.lt==='v'&&p.points.slice(1).some((q,i)=>{const a=p.points[i];return (q[0]-a[0])*(q[1]-a[1])<0&&Math.abs(q[0]-a[0])>.06&&Math.abs(q[1]-a[1])>.06;})));
}
export function forkStructureHypotheses(recon,linework) {
 if(!linework||!recon.inferredRoles.includes('side')||recon.inferredRoles.includes('front')||recon.inferredRoles.includes('top'))return [];
 const {front:f,top:t}=recon.drawing,s=recon.modelSize;
 const ss=w=>w.paths.filter(p=>!p.arc&&['v','h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b,lt:p.lt})));
 const fs=ss(f),ts=ss(t),vertical=(l,x,tol=.016)=>Math.abs(l.a[0]-x)<tol&&Math.abs(l.b[0]-x)<tol;
 const horizontal=(l,y,tol=.016)=>Math.abs(l.a[1]-y)<tol&&Math.abs(l.b[1]-y)<tol;
 const circles=t.curveDatums||[],nose=circles.find(c=>c.u>.6&&c.rx>.14&&c.rx<.35),bore=circles.find(c=>nose&&c.rx<nose.rx*.7&&Math.hypot(c.u-nose.u,c.v-nose.v)<.025),notch=circles.find(c=>c.u<.3&&c.rx>.05&&c.rx<.22);
 if(!nose||!bore||!notch||Math.abs(nose.v-notch.v)>.025)return [];
 const floor=fs.filter(l=>horizontal(l,l.a[1],.004)&&l.a[1]>.55&&l.a[1]<.9&&Math.max(l.a[0],l.b[0])<.45&&['h','t'].includes(l.lt)).sort((a,b)=>Math.abs(b.a[0]-b.b[0])-Math.abs(a.a[0]-a.b[0]))[0];
 const lug=fs.find(l=>l.lt==='v'&&horizontal(l,l.a[1],.004)&&l.a[1]>.15&&l.a[1]<.5&&Math.min(l.a[0],l.b[0])>.5&&Math.abs(l.a[0]-l.b[0])>.035);
 const shoulder=fs.find(l=>l.lt==='v'&&vertical(l,l.a[0],.004)&&l.a[0]>.45&&l.a[0]<.8&&Math.max(l.a[1],l.b[1])>.95&&Math.min(l.a[1],l.b[1])<.5);
 const wall=ts.find(l=>l.lt==='v'&&vertical(l,l.a[0],.004)&&l.a[0]>notch.u+notch.rx+.03&&l.a[0]<.5&&Math.min(l.a[1],l.b[1])>.04&&Math.max(l.a[1],l.b[1])<.96&&Math.abs(l.a[1]-l.b[1])>.25);
 if(!floor||!lug||!shoulder||!wall)return [];
 const floorV=floor.a[1],end=wall.a[0],shoulderX=shoulder.a[0],lugV=lug.a[1];
 const floorRuns=fs.filter(l=>['h','t'].includes(l.lt)&&horizontal(l,floorV,.006)&&Math.abs(l.a[0]-l.b[0])>.02).map(l=>[Math.min(l.a[0],l.b[0]),Math.max(l.a[0],l.b[0])]).sort((a,b)=>a[0]-b[0]);
 if(floorRuns.length<3||!floorRuns.some((r,i)=>i&&r[0]-floorRuns[i-1][1]>.008))return [];
 const runs=(x,lo,hi)=>{
  const a=fs.filter(l=>['h','t'].includes(l.lt)&&vertical(l,x)&&Math.max(l.a[1],l.b[1])>=lo-.03&&Math.min(l.a[1],l.b[1])<=hi+.03);
  const intervals=a.map(l=>[Math.min(l.a[1],l.b[1]),Math.max(l.a[1],l.b[1])]).sort((a,b)=>a[0]-b[0]);
  return a.length>=2&&intervals.some((r,i)=>i&&r[0]-intervals[i-1][1]>.006)&&a.reduce((n,l)=>n+Math.abs(l.a[1]-l.b[1]),0)>(hi-lo)*.45;
 };
 if(!runs(end,.25,floorV)||!runs(notch.u+notch.rx,floorV,1)||![bore.u-bore.rx,bore.u+bore.rx].every(x=>runs(x,0,lugV)))return [];
 const lips=[notch.v-notch.ry,notch.v+notch.ry];
 if(!lips.every(y=>ts.some(l=>l.lt==='v'&&horizontal(l,y)&&Math.min(l.a[0],l.b[0])<.025&&Math.max(l.a[0],l.b[0])>notch.u-.02)))return [];
 const pocket=ts.filter(l=>l.lt==='v'&&horizontal(l,l.a[1],.004)&&Math.min(l.a[0],l.b[0])<.025&&Math.max(l.a[0],l.b[0])>end-.02&&l.a[1]>.04&&l.a[1]<.96).map(l=>l.a[1]);
 const upper=Math.min(...pocket),lower=Math.max(...pocket);
 if(!(upper<lips[0]-.04&&lower>lips[1]+.04))return [];
 const [o,u,v]=f.sourceMap,map=([x,y])=>o.map((a,i)=>a+x*(u[i]-a)+y*(v[i]-a));
 const slope=fs.filter(l=>l.lt==='v'&&(l.b[1]-l.a[1])*(l.b[0]-l.a[0])<0&&Math.abs(l.a[0]-l.b[0])>.06&&Math.abs(l.a[1]-l.b[1])>.06).sort((a,b)=>Math.hypot(b.a[0]-b.b[0],b.a[1]-b.b[1])-Math.hypot(a.a[0]-a.b[0],a.a[1]-a.b[1]))[0];
 if(!slope)return [];
 const roughM=(slope.b[1]-slope.a[1])/(slope.b[0]-slope.a[0]),roughB=slope.a[1]-roughM*slope.a[0];
 const samples=linework.front.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points).map(map).filter(p=>p[0]>.035&&p[0]<-roughB/roughM-.025&&p[1]>.035&&p[1]<roughB-.025&&Math.abs(p[0]-end)>.018&&Math.abs(p[1]-(roughB+roughM*p[0]))<.025);
 // Recover the actual sloped support from its measured endpoints, not a
 // staircase polygon. The rough region above is only an orientation gate.
 if(samples.length<15)return [];
 const mx=samples.reduce((n,p)=>n+p[0],0)/samples.length,my=samples.reduce((n,p)=>n+p[1],0)/samples.length;
 const m=samples.reduce((n,p)=>n+(p[0]-mx)*(p[1]-my),0)/samples.reduce((n,p)=>n+(p[0]-mx)**2,0),intercept=my-m*mx,rampEnd=-intercept/m;
 if(!(m<-.2&&intercept>.2&&intercept<.9&&rampEnd>.2&&rampEnd<shoulderX)||samples.some(p=>Math.abs(p[1]-m*p[0]-intercept)*s.z/s.x*f.sourceSize.w>Math.max(3,linework.front.thickWidth*.45)))return [];
 const rect=(a,b,c,d)=>[[a,c],[b,c],[b,d],[a,d],[a,c]],cut=(role,profile,extra={})=>({role,profile,kind:'through',structural:true,...extra});
 // Tangents from the two shoulder corners to the measured circular nose.
 const tangent=y=>{const dx=shoulderX-nose.u,dy=(nose.v-y)*s.y/s.x,r=nose.rx,d=dx*dx+dy*dy;if(d<=r*r)return null;const k=r*r/d,h=r*Math.sqrt(d-r*r)/d,sign=y<.5?-1:1;return [nose.u+k*dx+sign*h*(-dy),nose.v-(k*dy+sign*h*dx)*s.x/s.y];};
 const a=tangent(0),b=tangent(1);if(!a||!b)return [];
 return [{family:'inclined-recess-fork-raised-lug',target:'side',components:[{axis:'z',x:nose.u,y:1-nose.v,z:1-lugV/2,r:nose.rx,lo:1-lugV,hi:1}],boxes:[],profiles:[{role:'front',lo:0,hi:1,points:[[0,intercept],[rampEnd,0],[shoulderX,0],[shoulderX,1],[0,1],[0,intercept]]},{role:'top',lo:1-lugV,hi:1,points:[[shoulderX-.00001,0],a,b,[shoulderX-.00001,1],[shoulderX-.00001,0]]}],features:[cut('top',rect(-.02,end,upper,lower),{kind:'pocket',depth:floorV}),cut('top',rect(-.02,notch.u,...lips)),{role:'top',u:notch.u,v:notch.v,r:notch.rx,kind:'through',structural:true},{role:'top',u:bore.u,v:bore.v,r:bore.rx,kind:'through',structural:true}],measuredRamp:{m,intercept,end:rampEnd},explanation:['两幅已知图共同确定斜台、上部圆头薄台和圆孔；圆头仅在主视台阶以上保留材料，不能向下拉满。','左端宽槽由俯视槽壁和主视槽底虚线确定深度；窄U形开口由半圆、两侧直边及槽底以下的隐藏切线共同确定。','用真实平面和圆柱交线补画左视，区分槽底、通口和悬空圆头的遮挡。']}];
}

// This is a source-support correction, independent of a selected 3D model.
// Preserve dash endpoints while repairing the slope at skeleton junctions.
export function refineForkDrawing(recon,linework) {
 const h=forkStructureHypotheses(recon,linework)[0];if(!h)return;
 const f=recon.drawing.front,{m,intercept}=h.measuredRamp;
 const near=p=>p[0]>=-.01&&p[0]<=h.measuredRamp.end+.01&&Math.abs(p[1]-intercept-m*p[0])<.022;
 for(const path of f.paths.filter(p=>!p.arc&&p.lt==='v')) {
  const ids=path.points.map((p,i)=>near(p)?i:-1).filter(i=>i>=0);if(ids.length<2)continue;
  const a=ids[0],b=ids.at(-1);if(b-a+1!==ids.length)continue;
  const old=path.points.slice(a,b+1),ends=[old[0],old.at(-1)].map(p=>p[1]<.02?[-intercept/m,0]:p[0]<.01?[0,intercept]:[p[0],intercept+m*p[0]]);
  for(const other of f.paths)if(other!==path&&!other.arc)for(const p of other.points)for(const [from,to] of [[old[0],ends[0]],[old.at(-1),ends[1]]])if(Math.hypot(p[0]-from[0],p[1]-from[1])<1e-7){p[0]=to[0];p[1]=to[1];}
  path.points.splice(a,b-a+1,...ends);
 }
 const bore=h.features.at(-1),floor=h.features[0].depth,notch=h.features.at(-2);
 for(const p of f.paths.filter(p=>!p.arc)) {
  if(p.points.every(q=>Math.abs(q[0]-bore.u)<.012)){p.lt='c';p.dashFragment=true;}
  if(p.width>=f.thickWidth*.8&&p.points.every(q=>Math.abs(q[1])<.012))p.lt='v';
  if(p.points.every(q=>Math.abs(q[1]-floor)<.008&&q[0]<h.features[0].profile[1][0]+.015)){p.lt='h';p.dashFragment=true;}
  if(p.points.every(q=>Math.abs(q[0]-notch.u-notch.r)<.016&&q[1]>=floor-.01)){p.lt='h';p.dashFragment=true;}
 }
 // Fit only the convex nose's dense right-hand support. Its tangent legs
 // must not be absorbed into the fitted circular arc at their junctions.
 const t=recon.drawing.top,[o,u,v]=t.sourceMap,map=([x,y])=>o.map((a,i)=>a+x*(u[i]-a)+y*(v[i]-a));
 const nose=t.curveDatums.find(c=>c.rx>.14&&c.u>.6);
 const samples=linework.top.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points).filter(p=>{const q=map(p);return q[0]>bore.u+.075&&Math.abs(Math.hypot((q[0]-nose.u)/nose.rx,(q[1]-nose.v)/nose.ry)-1)<.04;});
 const fit=samples.length>20?circleFit(samples,5):null;
 if(!fit||fit.error>.012)return;
 const c=map([fit.cx,fit.cy]),rx=Math.abs(map([fit.cx+fit.r,fit.cy])[0]-c[0]),ry=Math.abs(map([fit.cx,fit.cy+fit.r])[1]-c[1]);
 if(Math.abs(c[0]-nose.u)>.025||Math.abs(rx-nose.rx)>.02)return;
 const arcs=t.paths.filter(p=>nose.ids.includes(p.id));
 for(const p of arcs) {
  const old=p.analyticArc;if(!old)continue;
  Object.assign(nose,{u:c[0],v:c[1],rx,ry});
  const span=old.to-old.from,start=Math.atan2((p.points[0][1]-c[1])/ry,(p.points[0][0]-c[0])/rx);
  p.analyticArc={u:c[0],v:c[1],rx,ry,from:start,to:start+span};
  p.points=p.points.map(q=>{const a=Math.atan2((q[1]-c[1])/ry,(q[0]-c[0])/rx);return [c[0]+rx*Math.cos(a),c[1]+ry*Math.sin(a)];});
 }
 const dense=linework.top.paths.filter(p=>p.lt==='v').flatMap(p=>p.measuredPoints||p.points).map(map),ratio=rx/ry,strokeTolerance=Math.max(3,linework.top.thickWidth*.4);
 const legs=[0,1].map(side=>{
  const ps=dense.filter(p=>p[0]>h.profiles[0].points[2][0]+.035&&p[0]<bore.u+.035&&(side?p[1]>.78:p[1]<.22));
  if(ps.length<12)return null;
  const x=ps.reduce((n,p)=>n+p[0],0)/ps.length,y=ps.reduce((n,p)=>n+p[1],0)/ps.length;
  const m=ps.reduce((n,p)=>n+(p[0]-x)*(p[1]-y),0)/ps.reduce((n,p)=>n+(p[0]-x)**2,0),b=y-m*x;
  if(ps.some(p=>Math.abs(p[1]-m*p[0]-b)/Math.abs(v[1]-o[1])>strokeTolerance))return null;
  const M=m*ratio,B=b*ratio,cy=c[1]*ratio,dx=(c[0]+M*(cy-B))/(1+M*M),dy=M*dx+B;
  if(Math.abs(Math.hypot(dx-c[0],dy-cy)-rx)/Math.abs(u[0]-o[0])>strokeTolerance)return null;
  const start=h.profiles[0].points[2][0];
  return {from:[start,m*start+b],to:[dx,dy/ratio]};
 });
 if(legs.some(l=>!l))return;
 // Keep the complete measured straight legs. Earlier circle recovery can
 // consume their last samples and leave an artificial gap at the tangent.
 const shoulder=h.profiles[0].points[2][0];
 t.paths=t.paths.filter(p=>!nose.ids.includes(p.id)&&!(p.lt==='v'&&!p.arc&&p.points.every(q=>q[0]>shoulder-.012&&(q[1]<.28||q[1]>.72))));
 let id=Math.max(...t.paths.map(p=>p.id))+1;
 for(const leg of legs)t.paths.push({id:id++,lt:'v',width:t.thickWidth,points:[leg.from,leg.to],sourceSupport:'dense measured tangent'});
 const from=Math.atan2((legs[0].to[1]-c[1])/ry,(legs[0].to[0]-c[0])/rx),to=Math.atan2((legs[1].to[1]-c[1])/ry,(legs[1].to[0]-c[0])/rx);
 const points=Array.from({length:97},(_,i)=>{const a=from+(to-from)*i/96;return [c[0]+rx*Math.cos(a),c[1]+ry*Math.sin(a)];});
 t.paths.push({id,lt:'v',width:t.thickWidth,points,arc:true,analyticArc:{u:c[0],v:c[1],rx,ry,from,to},sourceSupport:'dense measured nose'});nose.ids=[id];
}

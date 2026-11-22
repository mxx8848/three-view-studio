import {buildUploadSolid} from './upload-model.js';
import {projectConstructiveSolid} from './upload-analytic.js';
import {deduplicateProjection} from './upload-projection.js';
import {compoundHypotheses,classifyCompoundAxes} from './upload-compound.js';
import {projectionScores,projectionPrecision} from './upload-fit.js';
import {compoundConnectionVariants,fitCompoundMouths,fitCompoundColumn,fitTangentEnvelope,compoundSourceDrawing,recoverCompoundHiddenArcs,recoverCompoundHiddenCorners,compoundAuditCost} from './upload-compound-constraints.js';
import {auditJointProjection} from './upload-joint-solver.js';
import {sectionStructureHypotheses,straightenSectionWalls} from './upload-section-structures.js';
import {orthogonalBossHypotheses,classifyOrthogonalBossLines,hasOrthogonalBossEvidence} from './upload-orthogonal-boss.js';
import {hasForkEvidence} from './upload-fork-structure.js';
import {classifySupportBoreDashes} from './upload-support-structures.js';

const segments=w=>w.paths.filter(p=>!p.arc&&['v','h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({a:p.points[i],b,lt:p.lt})));
const rect=(a,b,c,d)=>[[a,c],[b,c],[b,d],[a,d],[a,c]];
const cut=(role,profile,kind='through',depth)=>({role,profile,kind,depth,structural:true});

// Screenshots often give axes the same one-pixel width as the outline.
// A centre datum plus actual protrusion past BOTH outside bounds supplies
// stronger evidence than width. Never classify an interior diameter alone.
function classifyProtrudingAxes(recon) {
 for(const [role,w] of Object.entries(recon.drawing))for(const c of w.curveDatums||[])for(const axis of [0,1]) {
  const at=axis?c.v:c.u,paths=w.paths.filter(p=>!p.arc&&p.points.length>=2&&p.points.every(q=>Math.abs(q[axis]-at)<.008));
  const values=paths.flatMap(p=>p.points.map(q=>q[1-axis]));
  if(paths.length>=3&&Math.min(...values)<-.015&&Math.max(...values)>1.015)for(const p of paths){p.lt='c';p.dashFragment=true;}
 }
}
function stadia(w) {
 const out=[],cs=w.curveDatums||[];
 for(let i=0;i<cs.length;i++)for(const b of cs.slice(i+1)) {
  const a=cs[i];if(Math.abs(a.rx-b.rx)>.012||Math.abs(a.v-b.v)>.015||Math.abs(a.u-b.u)<.08)continue;
  const l=Math.min(a.u,b.u),r=Math.max(a.u,b.u),v=(a.v+b.v)/2,rx=(a.rx+b.rx)/2,ry=(a.ry+b.ry)/2;
  const walls=[v-ry,v+ry].every(y=>segments(w).some(s=>Math.abs(s.a[1]-y)<.018&&Math.abs(s.b[1]-y)<.018&&Math.abs(s.a[0]-s.b[0])>(r-l)*.55));
  if(walls)out.push({l,r,v,rx,ry});
 }
 return out;
}
function stadiumCuts(role,c) {
 const points=[];
 for(const [x,start] of [[c.r,-Math.PI/2],[c.l,Math.PI/2]])for(let i=0;i<=96;i++){const a=start+i*Math.PI/96;points.push([x+c.rx*Math.cos(a),c.v+c.ry*Math.sin(a)]);}
 points.push(points[0]);return [{...cut(role,points),stadium:{...c}}];
}

// Recover closed rectangular rims from supported walls, not the bounding box
// of a fragmented loop (hidden tube generators may meet the outer rim).
function rectangularRims(w) {
 const ss=segments(w).filter(t=>t.lt==='v'),groups=[];
 for(const t of ss)if(Math.abs(t.a[0]-t.b[0])<.006&&Math.abs(t.a[1]-t.b[1])>.002) {
  const x=(t.a[0]+t.b[0])/2;if(x<.04||x>.96)continue;
  let g=groups.find(g=>Math.abs(g.x-x)<.008);if(!g){g={x,ys:[]};groups.push(g);}g.ys.push(t.a[1],t.b[1]);
 }
 const out=[];
 for(let i=0;i<groups.length;i++)for(const b of groups.slice(i+1)) {
  const a=groups[i],lo=Math.min(...a.ys),hi=Math.max(...a.ys),left=Math.min(a.x,b.x),right=Math.max(a.x,b.x);
  if(right-left<.08||Math.abs(lo-Math.min(...b.ys))>.015||Math.abs(hi-Math.max(...b.ys))>.015)continue;
  const supported=[lo,hi].every(y=>ss.filter(t=>Math.abs(t.a[1]-y)<.008&&Math.abs(t.b[1]-y)<.008).reduce((sum,t)=>sum+Math.max(0,Math.min(right,Math.max(t.a[0],t.b[0]))-Math.max(left,Math.min(t.a[0],t.b[0]))),0)>(right-left)*.9);
  if(supported)out.push({left,right,lo,hi});
 }
 return out.sort((a,b)=>(b.right-b.left)*(b.hi-b.lo)-(a.right-a.left)*(a.hi-a.lo));
}

export function alignSupportedWalls(recon) {
 straightenSectionWalls(recon);
 const trough=recon.profileStructureFit?.selected==='vertical-cylinder-u-trough-bore';
 if(!trough&&recon.profileStructureFit?.selected!=='tube-rectangular-boss-opening')return;
 const projection=recon.lessonProjections;
 for(const [role,w]of Object.entries(recon.drawing)) {
  const b=recon.viewStates[role].bounds,junctionTolerance=Math.max(2.1,1.6*w.thickWidth),tol=[junctionTolerance/b.w,junctionTolerance/b.h];
  const axes=projection[role].filter(l=>[0,1].some(i=>Math.abs(l.p[0][i]-l.p[1][i])<1e-8));
  for(const path of w.paths) {
   if(path.arc||!['v','h','t'].includes(path.lt))continue;
   path.points=path.points.map(p=>p.map((v,i)=>{
    const near=axes.filter(l=>Math.abs(l.p[0][i]-l.p[1][i])<1e-8&&Math.abs(l.p[0][i]-v)<tol[i]&&p[1-i]>=Math.min(...l.p.map(q=>q[1-i]))-tol[1-i]&&p[1-i]<=Math.max(...l.p.map(q=>q[1-i]))+tol[1-i]).sort((a,b)=>Math.abs(a.p[0][i]-v)-Math.abs(b.p[0][i]-v));
    return near[0]?.p[0][i]??v;
   })).filter((p,i,all)=>!i||Math.hypot(p[0]-all[i-1][0],p[1]-all[i-1][1])>1e-8);
   // Reclassify thin/hidden fragments only when their full measured span is
   // supported by one visibility class. Preserve original hidden dash extents.
   const probes=[...path.points,...path.points.slice(1).map((q,i)=>q.map((v,k)=>(v+path.points[i][k])/2))];
   const supported=lt=>probes.every(p=>axes.some(l=>l.lt===lt&&[0,1].some(i=>Math.abs(l.p[0][i]-l.p[1][i])<1e-8&&Math.abs(p[i]-l.p[0][i])<1e-7&&p[1-i]>=Math.min(...l.p.map(q=>q[1-i]))-1e-6&&p[1-i]<=Math.max(...l.p.map(q=>q[1-i]))+1e-6)));
   if(role==='front'&&['t','h'].includes(path.lt)&&supported('v'))path.lt='v';
   else if(role==='front'&&(path.lt==='t'||path.colored||trough&&path.lt==='v')&&supported('h')) {
    const wasVisible=path.lt==='v';path.lt='h';path.dashFragment=!wasVisible;
   }
  }
 }
}

// A long round-ended loop is a stadium, not two independent drilled holes.
// Positive and negative uses are distinguished by the orthogonal elevation.
export function profileStructureHypotheses(recon) {
 const {front,top,side}=recon.drawing,s=recon.modelSize,out=[];
 // A rectangular mouth alone does not establish a through window. Require
 // the circular cylinder footprint AND two separated hidden-generator trains
 // in plan, at the independently measured mouth walls.
 if(recon.inferredRoles?.includes('side')&&front.type==='rectangle'&&top.type==='circle') {
  const R=(top.curveDatums||[]).find(c=>Math.abs(c.u-.5)<.015&&Math.abs(c.v-.5)<.015&&Math.abs(c.rx-.5)<.015);
  for(const rim of R?rectangularRims(front):[]) {
   if(rim.lo<.06||rim.hi>.94||rim.left<.06||rim.right>.94)continue;
   const tol=Math.max(.008,1.75*Math.abs(top.sourceMap?.[1]?.[0]-top.sourceMap?.[0]?.[0]||1/top.sourceSize.w));
   const generators=[rim.left,rim.right].map(x=>top.paths.filter(p=>!p.arc&&['v','h','t'].includes(p.lt)&&p.points.every(q=>Math.abs(q[0]-x)<tol)&&Math.abs(p.points.at(-1)[1]-p.points[0][1])>.025));
   const supported=generators.every((ps,i)=>{
    const runs=ps.map(p=>[Math.min(...p.points.map(q=>q[1])),Math.max(...p.points.map(q=>q[1]))]).sort((a,b)=>a[0]-b[0]);
    const xs=ps.flatMap(p=>p.points.map(q=>q[0])),x=xs.reduce((a,b)=>a+b,0)/xs.length,half=Math.sqrt(Math.max(0,R.rx**2-(x-R.u)**2))*R.ry/R.rx,reach=3*Math.abs(top.sourceMap?.[2]?.[1]-top.sourceMap?.[0]?.[1]||1/top.sourceSize.h);
    // A dashed generator need not place black ink at the theoretical tangent
    // endpoint. Allow one observed white gap, but never ink beyond the circle.
    const gap=Math.min(.09,Math.max(0,...runs.slice(1).map((r,i)=>r[0]-runs[i][1]))),endAllowance=Math.max(reach,gap);
    return ps.some(p=>p.lt==='h')&&runs.length>=3&&runs[0][0]>=R.v-half-reach&&runs.at(-1)[1]<=R.v+half+reach&&runs[0][0]-(R.v-half)<endAllowance&&R.v+half-runs.at(-1)[1]<endAllowance&&gap>.015&&runs.reduce((n,[a,b])=>n+b-a,0)>half*.8;
   });
   if(!supported)continue;
   // Source dashes can change width at a centreline crossing. Keep the actual
   // white gaps and endpoints; classify only the proven common support.
   for(const ps of generators)for(const p of ps){p.lt='h';p.dashFragment=true;}
   classifyProtrudingAxes(recon);
   out.push({family:'vertical-cylinder-rectangular-through-window',target:'side',components:[{axis:'z',x:R.u,y:1-R.v,z:.5,r:R.rx,lo:0,hi:1}],boxes:[],features:[cut('front',rect(rim.left,rim.right,rim.lo,rim.hi))],explanation:['俯视的圆外轮廓确定竖直圆柱，主视封闭矩形确定窗口的左右壁和上下壁。','俯视图两组分离虚线分别与窗口左右壁共投影，支持沿深度贯通的方形孔道；仅有矩形内线时不作通孔推断。','联立圆柱面与窗口平面求出两侧开口，再按实际材料遮挡补左视图的内外棱线。']});
  }
 }
 // The same connected bores can be established without the end view: the
 // elevation supplies the circular mouth and paired axial-bore generators;
 // the plan must independently contain both concave mouths and all four
 // dashed intersection branches. Never infer the end rings from a circle alone.
 if(recon.inferredRoles?.includes('side')&&front.type==='rectangle'&&top.type==='profile'&&Math.abs(s.y-s.z)<.015*s.x)for(const mouth of front.curveDatums||[]) {
  const tol=Math.max(.01,2/Math.min(front.sourceSize.w,top.sourceSize.h)),groups=[];
  for(const l of segments(front).filter(l=>['h','t'].includes(l.lt)&&Math.abs(l.a[1]-l.b[1])<.003)) {
   const v=(l.a[1]+l.b[1])/2;let g=groups.find(g=>Math.abs(g.v-v)<.004);if(!g){g={v,runs:[]};groups.push(g);}g.runs.push(l);
  }
  const lower=groups.filter(g=>g.v>mouth.v+.05&&g.runs.length>=3),upper=groups.filter(g=>g.v<mouth.v-.05&&g.runs.length>=3);
  for(const a of upper)for(const b of lower) {
   const axial=(b.v-a.v)*s.z/2,transverse=mouth.rx*s.x,R=s.y/2,u=mouth.u;
   if(Math.abs((a.v+b.v)/2-mouth.v)>tol||Math.abs(axial-transverse)>s.x*tol||transverse>R*.85||transverse<R*.15||u-mouth.rx<.04||u+mouth.rx>.96)continue;
   // Equal-bore diagonals are evidence only if each quadrant has separated
   // measured dashes, including outer and inner portions of the branch.
   const paths=top.paths.filter(p=>!p.arc&&!p.colored&&['v','h','t'].includes(p.lt)).map(path=>{
    const [a,b,c]=top.sourceMap||[];
    const points=a&&path.measuredPoints?.length?path.measuredPoints.map(([x,y])=>a.map((v,i)=>v+x*(b[i]-v)+y*(c[i]-v))):path.points;
    return {path,points};
   });
   const branches=[];let supportedBranches=0;
   for(const sign of [-1,1])for(const half of [-1,1]) {
    const ps=paths.map(p=>({...p,points:p.points.filter(q=>Math.abs((q[1]-.5)*s.y-sign*(q[0]-u)*s.x)<tol*s.x&&half*(q[0]-u)>.002&&half*(q[0]-u)<mouth.rx+tol),count:p.points.length})).filter(p=>p.points.length>=p.count*.85&&p.points.length>=2);
    const runs=ps.map(p=>{const xs=p.points.map(q=>half*(q[0]-u));return [Math.min(...xs),Math.max(...xs)];}).sort((a,b)=>a[0]-b[0]);
    if(runs.length<2||runs[0][0]>mouth.rx*.55||runs.at(-1)[1]<mouth.rx*.8||!runs.some((r,i)=>i&&r[0]-runs[i-1][1]>.006))break;
    branches.push(...ps.map(p=>({...p,sign})));
    supportedBranches++;
   }
   if(supportedBranches!==4)continue;
   const curvePoints=top.paths.filter(p=>p.lt==='v'&&p.points.length>8).flatMap(p=>p.points);
   const concave=[-1,1].every(sign=>curvePoints.filter(q=>Math.abs(q[0]-u)<mouth.rx*.75&&Math.abs(q[0]-u)>mouth.rx*.15&&sign*(q[1]-.5)>0&&Math.abs(Math.abs((q[1]-.5)*s.y)-Math.sqrt(R*R-transverse*transverse+((q[0]-u)*s.x)**2))<tol*s.x).length>=5);
   if(!concave)continue;
   for(const {path,points,sign} of branches) {
    // Retain each measured dash's own span; straighten it on the independently
    // established intersection support without connecting the white gaps.
    const xs=points.map(q=>((q[0]-u)*s.x+sign*(q[1]-.5)*s.y)/2);
    path.points=[Math.min(...xs),Math.max(...xs)].map(x=>[u+x/s.x,.5+sign*x/s.y]);
    path.lt='h';path.dashFragment=true;
   }
   const axis=top.paths.filter(p=>!p.arc&&p.points.every(q=>Math.abs(q[1]-.5)<.004)&&Math.abs(p.points.at(-1)[0]-p.points[0][0])>.015);
   if(axis.length>=3)for(const p of axis){p.lt='c';p.dashFragment=true;p.points.forEach(q=>q[1]=.5);}
   out.push({family:'cylindrical-tube-transverse-bore-plan',target:'side',components:[{axis:'x',x:.5,y:.5,z:1-mouth.v,r:R/s.x,lo:0,hi:1}],boxes:[],features:[{role:'side',u:.5,v:mouth.v,r:(axial+transverse)/2/s.y,kind:'through',structural:true},{role:'front',u,v:mouth.v,r:(axial+transverse)/2/s.x,kind:'through',structural:true}],explanation:['主视圆口和成对虚线给出横孔及轴向孔径；俯视上下内凹曲线共同支持圆管外表面，不能将其作为普通多边形拉伸。','俯视图四支分离短划组成两条相贯虚线，证明两孔在内部连通。用两张已知图求圆柱交线及遮挡，再补左视图的同心外圆和通孔内圆。']});
  }
 }
 // A tube end and a transverse circular mouth need two independent pairs of
 // hidden generators. A circle alone cannot distinguish a bore from a recess.
 if(!recon.inferredRoles?.some(r=>r==='front'||r==='side')&&side.type==='circle'&&front.type==='rectangle') {
  const rings=(side.curveDatums||[]).filter(c=>c.rx>.06).sort((a,b)=>b.rx-a.rx);
  if(rings.length===2)for(const mouth of front.curveDatums||[]) {
   const [outer,inner]=rings,tol=Math.max(.008,2/Math.min(front.sourceSize.w,front.sourceSize.h,side.sourceSize.w,side.sourceSize.h));
   const concentric=Math.hypot(outer.u-inner.u,outer.v-inner.v)<tol&&Math.abs(mouth.v-inner.v)<tol;
   const radius=mouth.rx*s.x,axialRadius=inner.rx*s.y;
   const supports=(w,c)=>[c.v-c.ry,c.v+c.ry].every(y=>{
    const runs=segments(w).filter(t=>['h','t'].includes(t.lt)&&Math.abs(t.a[1]-y)<tol&&Math.abs(t.b[1]-y)<tol).map(t=>[Math.min(t.a[0],t.b[0]),Math.max(t.a[0],t.b[0])]).sort((a,b)=>a[0]-b[0]);
    // Actual white gaps and evidence on both sides of the mouth are required.
    return runs.length>=3&&runs.some((r,i)=>i&&r[0]-runs[i-1][1]>.005)&&runs[0][0]<c.u-c.rx-tol&&runs.at(-1)[1]>c.u+c.rx+tol;
   });
   if(!concentric||outer.rx<.45||inner.rx>outer.rx*.85||mouth.rx<.06||mouth.u-mouth.rx<.04||mouth.u+mouth.rx>.96||radius>outer.rx*s.y*.85||Math.abs(mouth.rx*s.x-mouth.ry*s.z)>tol*s.x||!supports(front,inner)||!supports(side,mouth))continue;
   // Joint radius only inside the source raster uncertainty; a measurable
   // radius difference must survive and produce the unequal-bore intersection.
   const pixel=Math.min(s.x/front.sourceSize.w,s.y/side.sourceSize.w),joint=Math.abs(radius-axialRadius)<pixel*.75;
   const common=(radius+axialRadius)/2;
   const u=Math.abs(mouth.u-.5)*s.x<pixel*.75?.5:mouth.u,v=Math.abs(mouth.v-inner.v)*s.z<pixel*.75?inner.v:mouth.v;
   out.push({family:'cylindrical-tube-transverse-bore',target:'top',components:[{axis:'x',x:.5,y:1-outer.u,z:1-outer.v,r:outer.rx*s.y/s.x,lo:0,hi:1}],boxes:[],features:[{role:'side',u:inner.u,v:inner.v,r:joint?common/s.y:inner.rx,kind:'through',structural:true},{role:'front',u,v,r:joint?common/s.x:mouth.rx,kind:'through',structural:true}],explanation:['左视图的同心外圆与内圆确定沿长度方向的圆管；主视图圆口和两图成对虚线共同确定横向通孔，不能把圆口拉成实心圆柱。','两个孔在实体内部连通。联立轴向孔与横向孔的圆柱方程求相贯线，按遮挡关系区分实线与虚线；源像素误差内一致的孔径联合测量，等径正交时俯视投影为交叉直线，可测的孔径差则保留并计算曲线。','横孔与圆管外表面的交线形成俯视图上下两条内凹曲线；先补外轮廓，再画孔内相贯虚线，不能把孔道封成端盖或把隐藏线当中心线。']});
  }
 }
 // A circular plan and a measured open semicircle describe a vertical
 // cylinder with a transverse U trough, plus the independently measured bore.
 // Do not infer the trough from the circle alone: both upright slot walls
 // must reach its measured tangent points.
 if(top.type==='circle'&&recon.inferredRoles?.includes('side'))for(const c of front.curveDatums||[]) {
  const arc=front.paths.find(p=>p.analyticArc&&Math.abs(p.analyticArc.u-c.u)<1e-8&&Math.abs(p.analyticArc.to-p.analyticArc.from-Math.PI)<.03);
  const walls=[c.u-c.rx,c.u+c.rx].every(x=>segments(front).some(t=>t.lt==='v'&&Math.abs(t.a[0]-x)<.012&&Math.abs(t.b[0]-x)<.012&&Math.min(t.a[1],t.b[1])<.02&&Math.max(t.a[1],t.b[1])>c.v-.02));
  const bore=recon.features.find(f=>{
   if(f.role!=='top'||f.profile||!['unknown','through'].includes(f.kind)||f.r>=c.rx-.03||Math.abs(f.u-c.u)>=.025)return false;
   if(f.kind==='through')return true;
   // Repeated measured hidden fragments must cover both local bore walls;
   // resampling may classify these thin dashes differently, but a circle
   // alone still cannot establish a through hole.
   return [f.u-f.r,f.u+f.r].every(x=>{
    const lower=c.v+Math.sqrt(Math.max(0,c.ry**2-((x-c.u)*s.x/s.z)**2));
    const ss=segments(front).filter(t=>Math.abs(t.a[0]-x)<.015&&Math.abs(t.b[0]-x)<.015&&Math.abs(t.a[1]-t.b[1])>.002);
    const runs=ss.map(t=>[Math.min(t.a[1],t.b[1]),Math.max(t.a[1],t.b[1])]).sort((a,b)=>a[0]-b[0]);
    const dashed=runs.some((t,i)=>i&&t[0]-runs[i-1][1]>.012&&t[0]-runs[i-1][1]<.09);
    return dashed&&runs.length>=2&&runs[0][0]<lower+.035&&Math.max(...runs.map(t=>t[1]))>.96;
   });
  });
  if(arc&&walls&&bore&&c.v>.08&&c.v+c.ry<.95)out.push({family:'vertical-cylinder-u-trough-bore',target:'side',components:[{axis:'z',x:.5,y:.5,z:.5,r:.5,lo:0,hi:1}],boxes:[],features:[{...bore,kind:'through',structural:true},{role:'front',u:c.u,v:c.v,r:c.rx,kind:'through',structural:true},cut('front',rect(c.u-c.rx,c.u+c.rx,0,c.v))]});
 }
 const rings=(side.curveDatums||[]).filter(c=>c.rx>.08).sort((a,b)=>b.rx-a.rx),rims=rectangularRims(top);
 if(rings.length===2&&rims.length===2) {
  const [outer,inner]=rings,[boss,opening]=rims;
  const concentric=Math.hypot(outer.u-inner.u,outer.v-inner.v)<.015;
  const nested=opening.left>boss.left+.025&&opening.right<boss.right-.025&&opening.lo>boss.lo+.025&&opening.hi<boss.hi-.025;
  const elevated=segments(side).some(t=>t.lt==='v'&&Math.abs(t.a[1])<.015&&Math.abs(t.b[1])<.015&&Math.abs(t.a[0]-t.b[0])>.1);
  const joinsBore=[opening.lo,opening.hi].every(u=>{
   const d=inner.ry**2-((u-inner.u)*s.y/s.z)**2;if(d<=0)return false;
   const end=inner.v-Math.sqrt(d),walls=segments(side).filter(t=>Math.abs(t.a[0]-u)<.015&&Math.abs(t.b[0]-u)<.015);
   return walls.length&&Math.min(...walls.flatMap(t=>[t.a[1],t.b[1]]))<.025&&Math.max(...walls.flatMap(t=>[t.a[1],t.b[1]]))>end-.025;
  });
  // The rectangular aperture must fit inside the bore at its centre plane:
  // the cutter ends in air, so it cannot invent a flat pocket floor.
  if(concentric&&nested&&elevated&&joinsBore&&outer.rx>.45&&outer.v-outer.ry>.04&&inner.rx<outer.rx*.85&&Math.max(Math.abs(opening.lo-inner.u),Math.abs(opening.hi-inner.u))<inner.rx*.95) {
   const mid=(boss.lo+boss.hi)/2,aligned=Math.abs(mid-outer.u)<.01&&Math.abs((opening.lo+opening.hi)/2-mid)<.01,u=aligned?mid:outer.u;
   out.push({family:'tube-rectangular-boss-opening',target:'front',components:[{axis:'x',x:.5,y:1-u,z:1-outer.v,r:outer.rx*s.y/s.x,lo:0,hi:1}],boxes:[{lo:[boss.left,1-boss.hi,1-outer.v],hi:[boss.right,1-boss.lo,1]}],features:[{role:'side',u:aligned?u:inner.u,v:inner.v,r:inner.rx,kind:'through',structural:true},{...cut('top',rect(opening.left,opening.right,opening.lo,opening.hi),'pocket',inner.v),u:(opening.left+opening.right)/2,v:(opening.lo+opening.hi)/2}]});
  }
 }
 const planStadia=stadia(top).sort((a,b)=>b.rx-a.rx);
 const half=(side.curveDatums||[]).filter(c=>c.v>.97&&c.v<1.03).sort((a,b)=>b.rx-a.rx);
 if(planStadia.length===2&&half.length===2&&half[0].rx>.45&&half[1].rx<half[0].rx*.85) {
  let [outer,inner]=planStadia;
  if(Math.abs(outer.l-inner.l)<.025&&Math.abs(outer.r-inner.r)<.025&&inner.rx<outer.rx-.025) {
   const l=(outer.l+inner.l)/2,r=(outer.r+inner.r)/2,v=Math.abs(outer.v-.5)<.01&&Math.abs(inner.v-.5)<.01?.5:(outer.v+inner.v)/2;
   outer={...outer,l,r,v,ry:outer.rx*s.x/s.y};inner={...inner,l,r,v,ry:inner.rx*s.x/s.y};
   const components=[{axis:'x',x:.5,y:1-v,z:0,r:half[0].rx*s.y/s.x,lo:0,hi:1},...[outer.l,outer.r].map(x=>({axis:'z',x,y:1-outer.v,z:.5,r:outer.rx,lo:0,hi:1,analyticOnly:true}))];
   out.push({family:'semicylinder-stadium-boss',target:'front',components,stadia:[{l:outer.l,rEnd:outer.r,v:outer.v,r:outer.rx}],boxes:[{lo:[outer.l,1-outer.v-outer.ry,0],hi:[outer.r,1-outer.v+outer.ry,1],analyticOnly:true}],features:[...stadiumCuts('top',inner),{role:'side',u:v,v:1,r:half[1].rx,kind:'through',structural:true}]});
  }
 }
 const elevationStadia=stadia(front);
 if(side.type==='circle'&&elevationStadia.length===1) {
  const raw=elevationStadia[0],c={...raw,v:Math.abs(raw.v-.5)<.01?.5:raw.v,ry:raw.rx*s.x/s.z};
  const ledges=segments(front).filter(t=>t.lt==='v'&&Math.abs(t.a[1]-t.b[1])<.005&&t.a[1]>.06&&t.a[1]<.4&&Math.abs(t.a[0]-t.b[0])>.25).sort((a,b)=>Math.abs(b.a[0]-b.b[0])-Math.abs(a.a[0]-a.b[0]));
  const ledge=ledges[0];
  if(ledge&&Math.min(ledge.a[0],ledge.b[0])<.025) {
   const step=Math.max(ledge.a[0],ledge.b[0]),r=(.5-ledge.a[1])*s.z/s.x,R=.5*s.y/s.x;
   if(step>.2&&step<.85&&r<R*.9&&r>R*.4)out.push({family:'coaxial-flange-through-stadium',target:'top',components:[{axis:'x',x:.5,y:.5,z:.5,r,lo:0,hi:step},{axis:'x',x:.5,y:.5,z:.5,r:R,lo:step,hi:1}],boxes:[],features:stadiumCuts('front',c)});
  }
 }
 if(side.type==='circle'&&!elevationStadia.length)for(const c of top.curveDatums||[]) {
  if(c.rx<.06||c.rx>.3||c.u-c.rx<.05||c.u+c.rx>.95)continue;
  const walls=segments(top).filter(t=>t.lt==='v'&&Math.abs(t.a[0]-t.b[0])<.008&&Math.max(t.a[0],t.b[0])<c.u-c.rx-.025&&Math.abs(t.a[1]-t.b[1])>.015);
  const xs=[...new Set(walls.map(t=>Math.round(t.a[0]*1000)/1000))];
  for(const x of xs) {
   const ends=walls.filter(t=>Math.abs(t.a[0]-x)<.01).flatMap(t=>[t.a[1],t.b[1]]);
   if(Math.abs(Math.min(...ends)-(c.v-c.ry))>.03||Math.abs(Math.max(...ends)-(c.v+c.ry))>.03)continue;
   const floors=segments(front).filter(t=>t.lt!=='v'&&Math.abs(t.a[1]-t.b[1])<.006&&t.a[1]>.08&&t.a[1]<.45&&Math.abs(t.a[0]-t.b[0])>.025);
   if(!floors.length)continue;
   const levels=floors.filter(t=>floors.filter(q=>Math.abs(q.a[1]-t.a[1])<.006).reduce((sum,q)=>sum+Math.abs(q.a[0]-q.b[0]),0)>(c.u-x)*.45);
   if(!levels.length)continue;
   const frontDepth=Math.max(...levels.map(t=>t.a[1])),radius=c.rx*s.x/s.y;
   const pixel=(w,axis)=>w.sourceMap?Math.abs(w.sourceMap[axis+1][axis]-w.sourceMap[0][axis]):1/(axis?w.sourceSize.h:w.sourceSize.w);
   const tolerance=2.25*pixel(side,0),wallSegments=segments(side).filter(t=>t.lt!=='c'&&Math.abs(t.a[0]-t.b[0])<.008);
   // A circle and a rectangular loop do not establish a through hole. Both
   // generators must continue into the lower half in the independent end view.
   if(![c.v-radius,c.v+radius].every(at=>wallSegments.some(t=>Math.abs(t.a[0]-at)<tolerance&&Math.max(t.a[1],t.b[1])>.8&&Math.abs(t.a[1]-t.b[1])>.02)))continue;
   // Compare two independently measured levels using both source uncertainties.
   // The final mesh projection audit still uses 2.25 pixels per source view.
   const ledges=segments(side).filter(t=>['h','t'].includes(t.lt)&&Math.abs(t.a[1]-t.b[1])<.006&&Math.min(t.a[0],t.b[0])>=c.v-radius-tolerance&&Math.max(t.a[0],t.b[0])<=c.v+radius+tolerance&&Math.abs(t.a[1]-frontDepth)<2.25*(pixel(front,1)+pixel(side,1)));
   if(ledges.reduce((sum,t)=>sum+Math.abs(t.a[0]-t.b[0]),0)<radius*.8)continue;
   const sideDepth=ledges.reduce((sum,t)=>sum+t.a[1]*Math.abs(t.a[0]-t.b[0]),0)/ledges.reduce((sum,t)=>sum+Math.abs(t.a[0]-t.b[0]),0),depth=(frontDepth+sideDepth)/2;
   const lips=[c.v-c.ry,c.v+c.ry].every(at=>{
    const runs=segments(top).filter(t=>t.lt==='v'&&Math.abs(t.a[1]-at)<.02&&Math.abs(t.b[1]-at)<.02).map(t=>[Math.min(t.a[0],t.b[0]),Math.max(t.a[0],t.b[0])]).sort((a,b)=>a[0]-b[0]);
    let reach=x;const gap=2.25*pixel(top,0);
    for(const [a,b]of runs)if(a<=reach+gap&&b>=x-gap)reach=Math.max(reach,b);
    return reach>c.u-c.rx*.7;
   });
   if(!lips)continue;
   out.push({family:'cylinder-round-hole-open-pocket',target:'front',components:[{axis:'x',x:.5,y:.5,z:.5,r:.5*s.y/s.x,lo:0,hi:1}],boxes:[],features:[{role:'top',u:c.u,v:c.v,r:c.rx,kind:'through',structural:true},cut('top',rect(x,c.u,c.v-radius,c.v+radius),'pocket',depth)],explanation:['左视圆形外轮廓确定横向圆柱；俯视完整圆口与左视下半部两列孔壁共同确定竖直通孔。','俯视槽的两条边和封闭端确定槽宽与长度；主视、左视同高隐藏台阶联合确定槽底，矩形槽仅切至该深度。','对圆孔与矩形槽分别切削，保留槽底材料；回投实际网格核对虚实线。']});
  }
 }
 return out;
}

export function solveProfileStructure(recon,geometry,linework) {
 const seeds=linework?compoundHypotheses(recon,linework):[];
 if(seeds.length)classifyCompoundAxes(recon);
 const lineEvidence=seeds.length?[...recoverCompoundHiddenArcs(recon,linework),...recoverCompoundHiddenCorners(recon)]:[];
 const compounds=seeds.flatMap(h=>{
  const mouths=fitCompoundMouths(recon,h,linework),tangent=fitTangentEnvelope(recon,h);
  if(h.family==='stepped-cylinder-offset-tubes') {
   const column=mouths&&fitCompoundColumn(recon,mouths,linework);
   // Only the fully supported common mouth/base/column geometry has an
   // independently checked material interpretation. Keep incomplete seeds diagnostic.
   return column?[{...column,requiresReview:false}]:[h];
  }
  if(h.family==='tangent-base-stepped-tube'&&tangent)return [tangent,...compoundConnectionVariants(recon,tangent)].map(h=>({...h,requiresReview:false}));
  return [h,...compoundConnectionVariants(recon,h),mouths,mouths&&fitCompoundColumn(recon,mouths,linework)].filter(Boolean);
 });
 if(compounds.length)classifyCompoundAxes(recon);
 const sourceRecon=compounds.length?compoundSourceDrawing(recon,linework):recon;
 const sections=sectionStructureHypotheses(recon,linework);
 if(hasForkEvidence(recon)&&!sections.some(h=>h.family==='inclined-recess-fork-raised-lug')) {
  recon.profileStructureFit={trials:[],unresolved:true};
  throw new Error('已识别斜台、圆头和U形开口，但槽底、通口切线或孔壁证据不足，不能确定孔槽深度。已保留已知图线，请复核这些线段后重新求解。');
 }
 if(sections.length)classifyCompoundAxes(recon,{includeVisible:true});
 const bosses=orthogonalBossHypotheses(recon);
 if(bosses.length)classifyOrthogonalBossLines(recon,bosses[0]);
 const hypotheses=bosses.length?bosses:[...profileStructureHypotheses(recon),...sections,...compounds];
 if(!bosses.length&&hasOrthogonalBossEvidence(recon)) {
  recon.profileStructureFit={trials:[],unresolved:true};
  throw new Error('两幅同心圆视图提示圆柱相贯结构，但孔壁或主视相贯线尚未获得充分支持。已停止轮廓拉伸建模，避免生成方块状错误实体；请复核已知图线。');
 }
 if(!hypotheses.length)return geometry;
 if(hypotheses.some(h=>h.family.startsWith('cylindrical-tube-transverse-bore')))classifyProtrudingAxes(recon);
 const trials=[];let best,diagnostic;
 for(const h of hypotheses) {
  let g;
  try {
   const candidate={...recon,bodyComponents:h.components,bodyRevolution:h.family==='coaxial-flange-through-stadium',bodyBoxes:h.boxes,bodyProfiles:h.profiles,bodyStadia:h.stadia,bodySourceRoles:['front','top','side'],features:h.features};
   const projection=Object.fromEntries(Object.entries(projectConstructiveSolid(candidate)).map(([r,ls])=>[r,deduplicateProjection(ls)]));
   const scored=h.lineClasses?.length?{...recon,drawing:Object.fromEntries(Object.entries(recon.drawing).map(([role,w])=>{
    const edits=new Map(h.lineClasses.filter(([r])=>r===role).map(([,id,lt])=>[id,lt]));
    return [role,{...w,paths:w.paths.map(p=>edits.has(p.id)?{...p,lt:edits.get(p.id)}:p)}];
   }))}:recon;
   const options={tolerance:r=>Math.max(.018,3/Math.min(recon.drawing[r].sourceSize.w,recon.drawing[r].sourceSize.h))},recall=projectionScores(scored,projection,options);
   // Thin strokes have ambiguous hidden/centre classification. They may
   // explain a projected hidden wall, but are not mandatory shape evidence.
   const precisionDrawing=Object.fromEntries(Object.entries(scored.drawing).map(([r,w])=>[r,{...w,paths:w.paths.map(p=>p.lt==='t'?{...p,lt:'h'}:p)}]));
   const precision=projectionPrecision({...recon,drawing:precisionDrawing},projection,options);
   // New lines in the incomplete view are the answer, not false positives.
   // Full other views still constrain both missing and invented edges.
   // Some exercises omit only internal edges. Their closed silhouette is not
   // proof of a finished drawing. Require strong independent agreement on
   // BOTH other views and typed support for the surviving target strokes.
   const others=Object.keys(recall).filter(r=>r!==h.target);
   const partialCandidate=!recon.completionRole&&!recon.inferredRoles.length&&others.length===2&&
     others.every(r=>recall[r]>.95&&precision[r]>.95)&&precision[h.target]<.8&&
     !recon.drawing[h.target].paths.some(p=>p.colored);
   let assumed=false;
   if(partialCandidate){
     const work=recon.drawing[h.target];
     // A fine, grey stroke in a small scan can be promoted to visible ink
     // by the width heuristic. Keep it in the drawing and final mesh audit,
     // but do not let an uncertain line type alone veto a completion. Its
     // LOCATION must still be explained by a real visible or hidden edge.
     const uncertain=p=>p.lt==='v'&&!p.manualType&&p.dark&&!p.black&&!p.colored&&p.width<work.thickWidth*.65;
     const byRole=w=>({...recon,drawing:{...recon.drawing,[h.target]:{...work,paths:w}}});
     const typed=work.paths.filter(p=>!uncertain(p));
     const v=auditJointProjection(byRole(typed),projection).views[h.target];
     assumed=v.recall.ratio>=.94&&Object.values(v.classes).every(c=>c.recall.lengthPixels<8||c.recall.ratio>=.9);
     if(assumed&&typed.length!==work.paths.length){
       const weak=work.paths.filter(uncertain);
       const edges={...projection,[h.target]:projection[h.target].map(l=>({...l,lt:'v'}))};
       assumed=auditJointProjection(byRole(weak),edges).views[h.target].recall.ratio>=.94;
     }
   }
   const known=Object.keys(recall).filter(r=>r!==(recon.completionRole||h.target)||!assumed&&!recon.inferredRoles.includes(r)&&recon.viewStates[r].kind==='complete'),values=[...Object.values(recall),...known.map(r=>precision[r])],quality=values.reduce((a,b)=>a+b,0)/values.length;
   const meanRecall=known.reduce((sum,r)=>sum+recall[r],0)/known.length;
   // Line agreement alone cannot establish the topology of these new
   // compound families. They remain diagnostic until independently verified.
   const accepted=!h.requiresReview&&known.length>=2&&known.every(r=>recall[r]>.75&&precision[r]>.76)&&meanRecall>.88&&quality>.88;
   const audit=h.requiresReview?auditJointProjection(sourceRecon,projection):undefined;
   trials.push({family:h.family,variant:h.variant||'original',recall,precision,quality,accepted,...(h.requiresReview?{requiresReview:true,audit,constraints:h.constraints||[]}:{})});
   if(audit&&(!diagnostic||compoundAuditCost(audit)<compoundAuditCost(diagnostic.audit)))diagnostic={hypothesis:h,audit};
   if(accepted&&(!best||quality>best.quality)){g=buildUploadSolid(candidate,h.features);best?.geometry.dispose();best={...h,geometry:g,projection,quality,precision,assumed};g=null;}
  }catch(e){trials.push({family:h.family,error:e.message});}finally{g?.dispose();}
 }
 if(diagnostic) {
  const cost=compoundAuditCost(diagnostic.audit);
  diagnostic.competingVariants=trials.filter(t=>t.audit&&Math.abs(compoundAuditCost(t.audit)-cost)<.003).map(t=>({variant:t.variant,quality:t.audit.quality}));
 }
 recon.profileStructureFit={trials,...(diagnostic?{diagnostic,lineEvidence,originalCoordinatesAudited:true}:{})};
 if(best) {
  for(const [role,id,lt] of best.lineClasses||[]){const p=recon.drawing[role].paths.find(p=>p.id===id);if(p&&!p.manualType){p.lt=lt;p.dashFragment=true;}}
  if(best.lineClasses?.length)recon.profileStructureFit.lineClasses=best.lineClasses;
  if(best.family==='tube-rectangular-boss-opening')recon.profileStructureFit.frameKinds=Object.fromEntries(Object.entries(recon.viewStates).map(([r,state])=>[r,state.kind]));
  geometry?.dispose();recon.bodyComponents=best.components;recon.bodyBoxes=best.boxes;recon.bodyProfiles=best.profiles;recon.bodyStadia=best.stadia;recon.bodySourceRoles=['front','top','side'];recon.features=best.features;recon.lessonProjections=best.projection;
  recon.bodyRevolution=best.family==='coaxial-flange-through-stadium';
  const completionThreshold=best.family==='tube-rectangular-boss-opening'?.97:.8;
  if(best.assumed){recon.assumedPartial=best.target;recon.viewStates[best.target].closedFrame=true;}
  if(!recon.completionRole&&!recon.inferredRoles.includes(best.target)&&(recon.viewStates[best.target].kind==='partial'||!recon.drawing[best.target].paths.some(p=>p.colored)&&(best.precision[best.target]||0)<completionThreshold)) {
    recon.completionRole=best.target;recon.viewStates[best.target].kind='partial';
  }
  recon.profileStructureFit.selected=best.family;
  if(['inclined-web-fork-notched-base','rounded-plate-arch-base','arch-lug-stepped-crown-drilled-feet','counterbored-tube-finite-web-pedestal'].includes(best.family))classifySupportBoreDashes(recon,best);
  recon.structureExplanation=best.explanation;
  if(best.family==='round-lug-finite-side-ribs') {
   const bore=best.features.find(f=>f.role==='front'&&!f.profile);
   // An observed diameter wholly inside an established open bore is its
   // axis, even if a screenshot gave it the same pixel width as the contour.
   for(const p of recon.drawing.front.paths)if(!p.arc&&p.points.length>=2&&p.points.every(q=>Math.abs(q[1]-bore.v)<.004&&Math.abs(q[0]-bore.u)<bore.r)) {
    p.lt='c';p.dashFragment=false;
   }
  }
  return best.geometry;
 }
 // A detailed but inconsistent interpretation must not fall through to
 // expensive generic trial cuts and then appear as a completed answer.
 // Keep the measured input and the rejected scores available for review.
 if(compounds.length||bosses.length) {
  recon.profileStructureFit.unresolved=true;
  const names={front:'主视图',top:'俯视图',side:'左视图'};
  const trial=trials.filter(t=>t.recall).sort((a,b)=>b.quality-a.quality)[0];
  const detail=diagnostic?Object.entries(diagnostic.audit.views).map(([role,v])=>`${names[role]}源线型匹配 ${Math.round(v.recall.ratio*100)}%`).join('，'):trial?Object.entries(trial.recall).map(([role,score])=>`${names[role]}线型匹配 ${Math.round(score*100)}%`).join('，'):'结构计算未通过';
  throw new Error(`孔槽结构核对未通过：网站尚未解出这类复合结构的孔槽连接，暂不能可靠地补画或生成实体。这表示自动求解未完成，不表示题目或框选有错。已保留已知图线。候选诊断：${detail}；匹配分数不代表答案正确率。`);
 }
 return geometry;
}


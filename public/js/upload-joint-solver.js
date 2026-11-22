// Bounded, joint inverse projection search. This is a primitive grammar, not
// a claim that two drawings uniquely determine every possible hidden cavity.
import {projectConstructiveSolid} from './upload-analytic.js';
import {deduplicateProjection} from './upload-projection.js';
import {buildUploadSolid} from './upload-model.js';

const roles=['front','top','side'];
const axisOf={front:1,top:2,side:0};
const clamp=x=>Math.max(0,Math.min(1,x));
export function drawingPixelSize(work) {
 const [a,b,c]=work.sourceMap||[];
 if(a&&b&&c) {
  const ux=b[0]-a[0],uy=b[1]-a[1],vx=c[0]-a[0],vy=c[1]-a[1],det=ux*vy-uy*vx;
  if(Math.abs(det)>1e-12)return {w:Math.hypot(vy,uy)/Math.abs(det),h:Math.hypot(vx,ux)/Math.abs(det)};
 }
 return work.sourceSize||{w:300,h:300};
}
const distance=(p,a,b)=>{
 const d=b.map((v,i)=>v-a[i]),den=d[0]**2+d[1]**2;
 const t=den?clamp(d.reduce((v,x,i)=>v+x*(p[i]-a[i]),0)/den):0;
 return Math.hypot(...p.map((v,i)=>v-a[i]-t*d[i]));
};
const segments=paths=>paths.filter(p=>['v','h'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({p:[p.points[i],b],lt:p.lt,...(p.hiddenCircle?{hiddenCircle:p.hiddenCircle}:{})})));

// Dashed ink describes a continuous hidden edge, but only between observed
// fragments on the SAME straight support. Never extend it beyond its ends.
export function hiddenSupports(lines,size) {
 const out=[...lines],groups=[];
 for(const l of lines.filter(l=>l.lt==='h')) {
  const p=l.p.map(p=>[p[0]*size.w,p[1]*size.h]);
  const axis=[0,1].find(i=>Math.abs(p[0][i]-p[1][i])<.6);
  if(axis===undefined)continue;
  const at=(p[0][axis]+p[1][axis])/2;
  let g=groups.find(g=>g.axis===axis&&Math.abs(g.at-at)<1);
  if(!g){g={axis,at,runs:[]};groups.push(g);}
  g.runs.push([Math.min(p[0][1-axis],p[1][1-axis]),Math.max(p[0][1-axis],p[1][1-axis])]);
 }
 for(const g of groups) {
  g.runs.sort((a,b)=>a[0]-b[0]);
  const lengths=g.runs.map(([a,b])=>b-a).sort((a,b)=>a-b),median=lengths[Math.floor(lengths.length/2)];
  for(let i=1;i<g.runs.length;i++) {
   const lo=g.runs[i-1][1],hi=g.runs[i][0];
   if(hi<=lo||hi-lo>Math.min(3*median,.055*Math.max(size.w,size.h)))continue;
   const p=[lo,hi].map(v=>g.axis===0?[g.at/size.w,v/size.h]:[v/size.w,g.at/size.h]);
   out.push({p,lt:'h',dashGap:true});
  }
 }
 // Repeated polar ink evidence supplies a circular support. Join only short
 // gaps between observed dashes on that SAME circle. A long missing sector
 // may be an occlusion and must remain unsupported.
 const circles=new Map(),tau=2*Math.PI;
 for(const line of lines.filter(l=>l.lt==='h'&&l.hiddenCircle)) {
  const c=line.hiddenCircle,key=JSON.stringify([c.center,c.u,c.v]);
  let g=circles.get(key);if(!g){g={circle:c,runs:[]};circles.set(key,g);}
  const det=c.u[0]*c.v[1]-c.u[1]*c.v[0];if(Math.abs(det)<1e-12)continue;
  const angles=line.p.map(p=>{const x=p[0]-c.center[0],y=p[1]-c.center[1];return (Math.atan2((c.u[0]*y-c.u[1]*x)/det,(c.v[1]*x-c.v[0]*y)/det)+tau)%tau;});
  let [lo,hi]=angles.sort((a,b)=>a-b);if(hi-lo>Math.PI)[lo,hi]=[hi,lo+tau];
  if(hi>tau){g.runs.push([lo,tau],[0,hi-tau]);}else g.runs.push([lo,hi]);
 }
 for(const {circle:c,runs} of circles.values()) {
  const merged=[];
  for(const r of runs.sort((a,b)=>a[0]-b[0])){if(merged.length&&r[0]<=merged.at(-1)[1]+1e-6)merged.at(-1)[1]=Math.max(merged.at(-1)[1],r[1]);else merged.push([...r]);}
  if(merged.length<3)continue;
  const radius=(Math.hypot(c.u[0]*size.w,c.u[1]*size.h)+Math.hypot(c.v[0]*size.w,c.v[1]*size.h))/2;
  const lengths=merged.map(([a,b])=>(b-a)*radius).sort((a,b)=>a-b),limit=Math.min(3*lengths[Math.floor(lengths.length/2)],.055*Math.max(size.w,size.h));
  for(let i=0;i<merged.length;i++) {
   const lo=merged[i][1],hi=merged[(i+1)%merged.length][0]+(i===merged.length-1?tau:0),length=(hi-lo)*radius;
   if(length<=0||length>limit)continue;
   const steps=Math.max(1,Math.ceil(length/1.25));
   const at=t=>c.center.map((v,k)=>v+c.u[k]*Math.cos(t)+c.v[k]*Math.sin(t));
   for(let j=0;j<steps;j++)out.push({lt:'h',p:[at(lo+(hi-lo)*j/steps),at(lo+(hi-lo)*(j+1)/steps)],dashGap:true,hiddenCircle:c});
  }
 }
 return out;
}

function lineIndex(lines,size,tolerance) {
 const grid=new Map(),step=tolerance*2,key=(x,y,lt)=>`${x},${y},${lt}`;
 for(const line of lines) {
  const p=line.p.map(p=>[p[0]*size.w,p[1]*size.h]);
  const n=Math.max(1,Math.ceil(Math.hypot(p[1][0]-p[0][0],p[1][1]-p[0][1])/step)),seen=new Set();
  for(let i=0;i<=n;i++) {
   const cell=p[0].map((v,k)=>Math.floor((v+(p[1][k]-v)*i/n)/step)),k=key(...cell,line.lt);
   if(seen.has(k))continue;seen.add(k);
   if(!grid.has(k))grid.set(k,[]);grid.get(k).push(p);
  }
 }
 return (p,lt)=>{
  const x=Math.floor(p[0]/step),y=Math.floor(p[1]/step);let best=tolerance*3;
  for(let i=-2;i<=2;i++)for(let j=-2;j<=2;j++)for(const [a,b] of grid.get(key(x+i,y+j,lt))||[])best=Math.min(best,distance(p,a,b));
  return best;
 };
}

function agreement(from,to,size,tolerance) {
 const near=lineIndex(to,size,tolerance);let length=0,matched=0,error=0;
 const unexplained=[];
 for(const line of from) {
  const [a,b]=line.p.map(p=>[p[0]*size.w,p[1]*size.h]),len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(len<1e-6)continue;
  const n=Math.max(1,Math.ceil(len/1.25));let bad=0;
  for(let i=0;i<n;i++) {
   const p=a.map((v,k)=>v+(b[k]-v)*(i+.5)/n),d=near(p,line.lt),w=len/n;
   length+=w;error+=d*w;
   if(d<=tolerance)matched+=w;else bad+=w;
  }
  if(bad>1)unexplained.push({p:line.p,lt:line.lt,lengthPixels:bad});
 }
 return {ratio:length?matched/length:1,lengthPixels:length,unmatchedPixels:length-matched,meanErrorPixels:length?error/length:0,unexplained:unexplained.sort((a,b)=>b.lengthPixels-a.lengthPixels).slice(0,8)};
}

// Source-pixel distances, separate per view and line class. A good outline
// cannot hide an incorrect internal bore behind a single global average.
export function auditJointProjection(recon,projection,{tolerancePixels=2.25}={}) {
 const views={};
 for(const role of roles.filter(r=>!recon.inferredRoles.includes(r)||recon.viewStates?.[r]?.registered)) {
  const w=recon.drawing[role],size=drawingPixelSize(w);
  const measured=segments(w.paths),predicted=(projection[role]||[]).filter(l=>['v','h'].includes(l.lt));
  const support=hiddenSupports([...measured,...segments(w.paths.filter(p=>p.lt==='t').map(p=>({...p,lt:'h'})))],size);
  const recall=agreement(measured,predicted,size,tolerancePixels),precision=agreement(predicted,support,size,tolerancePixels);
  const classes={};
  for(const lt of ['v','h'])classes[lt]={recall:agreement(measured.filter(l=>l.lt===lt),predicted.filter(l=>l.lt===lt),size,tolerancePixels),precision:agreement(predicted.filter(l=>l.lt===lt),support.filter(l=>l.lt===lt),size,tolerancePixels)};
  views[role]={recall,precision,classes,partial:recon.viewStates?.[role]?.kind==='partial'};
 }
 const values=Object.values(views),quality=values.length?values.reduce((s,v)=>s+(v.partial?v.recall.ratio:2*v.recall.ratio*v.precision.ratio/(v.recall.ratio+v.precision.ratio||1)),0)/values.length:0;
 const supported=values.length>=2&&values.every(v=>v.recall.lengthPixels>0&&v.recall.ratio>=.94&&(v.partial||v.precision.ratio>=.94)&&Object.values(v.classes).every(c=>(c.recall.lengthPixels<8||c.recall.ratio>=.9)&&(v.partial||c.precision.lengthPixels<8||c.precision.ratio>=.9)));
 return {views,quality,supported,tolerancePixels};
}

// Convert a line in an orthogonal drawing into (cut-axis position, radial
// coordinate). This preserves the first-angle reversal for depth and height.
function orthogonalFrame(feature,role) {
 if(feature.role==='top')return role==='front'?{along:1,radial:0,reverse:true,center:feature.u,radius:feature.r}:role==='side'?{along:1,radial:0,reverse:true,center:feature.v}:null;
 if(feature.role==='front')return role==='top'?{along:1,radial:0,reverse:true,center:feature.u,radius:feature.r}:role==='side'?{along:0,radial:1,reverse:true,center:feature.v}:null;
 return role==='front'?{along:0,radial:1,reverse:false,center:feature.v}:role==='top'?{along:0,radial:1,reverse:false,center:feature.u,radius:feature.r}:null;
}

export function measuredCutRanges(recon,feature) {
 const size=recon.modelSize,physicalRadius=feature.r*(feature.role==='side'?size.y:size.x),levels=[0,1],evidence=[];
 for(const role of roles.filter(r=>r!==feature.role&&!recon.inferredRoles.includes(r))) {
  const f=orthogonalFrame(feature,role),radialSize=f.radial===0?(role==='side'?size.y:size.x):(role==='top'?size.y:size.z);
  const r=physicalRadius/radialSize,ends=[[],[]],w=recon.drawing[role];
  const pixels=drawingPixelSize(w),tol=Math.min(.02,2/(f.radial===0?pixels.w:pixels.h));
  const supportedLines=hiddenSupports(segments(w.paths),pixels),caps=[];
  for(const l of supportedLines) {
   const [a,b]=l.p;
   if(Math.abs(a[f.along]-b[f.along])<tol*.3) {
    const at=(a[f.along]+b[f.along])/2;
    let cap=caps.find(c=>Math.abs(c.at-at)<tol*.4);
    if(!cap){cap={at,runs:[],dashes:[]};caps.push(cap);}cap.runs.push([Math.min(a[f.radial],b[f.radial]),Math.max(a[f.radial],b[f.radial])]);
    if(l.lt==='h'&&!l.dashGap)cap.dashes.push(Math.abs(a[f.radial]-b[f.radial]));
   }
   if(Math.abs(a[f.radial]-b[f.radial])>tol*.3)continue;
   for(const [i,sign] of [-1,1].entries())if(Math.abs((a[f.radial]+b[f.radial])/2-(f.center+sign*r))<tol) {
    ends[i].push([a[f.along],b[f.along]].map(v=>f.reverse?1-v:v).sort((a,b)=>a-b));
   }
  }
  for(const cap of caps) {
   const lo=f.center-r,hi=f.center+r;
   cap.dashes.sort((a,b)=>a-b);
   const endTolerance=cap.dashes.length>=3?Math.max(tol,Math.min(.055,cap.dashes[Math.floor(cap.dashes.length/2)]*2)):tol;
   const runs=cap.runs.filter(([a,b])=>a>=lo-tol&&b<=hi+tol).sort((a,b)=>a[0]-b[0]);
   let end=lo,covered=0;
   for(const [a,b] of runs){if(a>end+tol)break;covered+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
   const value=f.reverse?1-cap.at:cap.at;
   if(end>=hi-endTolerance&&covered>1.6*r&&value>.025&&value<.975&&!levels.some(v=>Math.abs(v-value)<tol*.3)) {
    levels.push(value);evidence.push({role,value,reason:'跨越两孔壁的实测终止边'});
   }
  }
  // Both generators must support a stop; a random shoulder elsewhere in
  // the view is not a depth dimension for this bore.
  const terminals=ends.map(runs=>{
   const merged=[];
   for(const run of runs.sort((a,b)=>a[0]-b[0])) {
    const last=merged.at(-1);
    if(last&&run[0]<=last[1]+.003)last[1]=Math.max(last[1],run[1]);else merged.push([...run]);
   }
   return merged.flat();
  });
  for(const a of terminals[0])for(const b of terminals[1])if(Math.abs(a-b)<tol&&a>.025&&a<.975) {
   const value=clamp((a+b)/2);
   if(!levels.some(v=>Math.abs(v-value)<tol*.2)){levels.push(value);evidence.push({role,value,reason:'两侧孔壁共同端点'});}
  }
 }
 levels.sort((a,b)=>a-b);
 const ranges=[];
 for(let i=0;i<levels.length;i++)for(const hi of levels.slice(i+1))if(hi-levels[i]>.04)ranges.push([levels[i],hi]);
 return {ranges,evidence};
}

export function jointBodyHypotheses(recon) {
 const known=roles.filter(r=>!recon.inferredRoles.includes(r));
 if(known.length!==2||known.some(r=>!['rectangle','circle','profile'].includes(recon.drawing[r].type)))return [];
 const out=[];
 for(const role of known.filter(r=>recon.drawing[r].type==='circle')) {
  const size=recon.modelSize,axis=['x','y','z'][axisOf[role]],r=(role==='side'?size.y:size.x)/2;
  const other=role==='top'?size.y:size.z;
  if(Math.abs(r*2-other)>Math.max(size.x,size.y,size.z)*.025)continue;
  const otherRole=known.find(r=>recon.drawing[r].type==='profile');
  const sectionCuts=otherRole?convexSectionCuts(recon.drawing[otherRole],otherRole):[];
  if(otherRole&&!sectionCuts.length)continue;
  out.push({family:`joint-cylinder-${axis}`,components:[{axis,x:.5,y:.5,z:.5,r:r/size.x,lo:0,hi:1}],boxes:[],sectionCuts});
 }
 if(known.every(r=>recon.drawing[r].type==='rectangle'))out.push({family:'joint-box',components:[],boxes:[{lo:[0,0,0],hi:[1,1,1]}]});
 return out;
}

// A measured convex polygonal elevation can clip a round body by real
// planes. Each exterior half-plane becomes a through prism. This admits
// oblique sections without a separate template for every slope/vertex.
function convexSectionCuts(work,role) {
 let points=(work.outline||[]).map(p=>[...p]);
 if(points.length<3)return [];
 // The filled-mask outline can add a subpixel bevel at a sharp corner.
 // Prefer the measured closed stroke if both perimeters coincide, in both
 // directions, in source pixels. An internal polygon or circle is not proof
 // of a section plane; straight ink support is still required below.
 const pixels=drawingPixelSize(work),px=p=>[p[0]*pixels.w,p[1]*pixels.h];
 const follows=(a,b)=>a.every((p,i)=>[p,p.map((v,k)=>(v+a[(i+1)%a.length][k])/2)].every(q=>
   b.some((s,j)=>distance(px(q),px(s),px(b[(j+1)%b.length]))<=2.25)));
 for(const p of work.paths)if(p.lt==='v'&&!p.arc&&p.points.length>=4&&p.points.length<=10&&
     Math.hypot((p.points[0][0]-p.points.at(-1)[0])*pixels.w,(p.points[0][1]-p.points.at(-1)[1])*pixels.h)<=1){
   const corners=p.points.slice(0,-1);
   if(follows(points,corners)&&follows(corners,points)){points=corners.map(q=>[...q]);break;}
 }
 if(Math.hypot(points[0][0]-points.at(-1)[0],points[0][1]-points.at(-1)[1])<1e-6)points.pop();
 const tol=1/Math.max(pixels.w,pixels.h);
 let changed=true;
 while(changed&&points.length>3){changed=false;for(let i=0;i<points.length;i++)if(distance(points[i],points[(i+points.length-1)%points.length],points[(i+1)%points.length])<tol*.5){points.splice(i,1);changed=true;break;}}
 if(points.length>8)return [];
 const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a[0]*b[1]-a[1]*b[0];},0),sign=Math.sign(area);
 if(!sign)return [];
 const cross=(a,b,p)=>sign*((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]));
 if(points.some((a,i)=>points.some(p=>cross(a,points[(i+1)%points.length],p)<-tol)))return [];
 const cuts=[];
 for(let i=0;i<points.length;i++) {
  const a=points[i],b=points[(i+1)%points.length];
  // Every clipping plane must have measured straight ink support. A circular
  // silhouette approximated by a few vertices is not a polyhedral section.
  const support=segments(work.paths).filter(l=>l.lt==='v'&&l.p.every(p=>distance(p,a,b)<tol*2));
  const len=Math.hypot(b[0]-a[0],b[1]-a[1]);
  if(!support.length||support.reduce((n,l)=>n+Math.hypot(l.p[1][0]-l.p[0][0],l.p[1][1]-l.p[0][1]),0)<len*.8)return [];
  const square=[[0,0],[1,0],[1,1],[0,1]],polygon=[];
  for(let j=0;j<4;j++) {
   const p=square[j],q=square[(j+1)%4],dp=cross(a,b,p),dq=cross(a,b,q);
   if(dp<=0)polygon.push(p);
   if((dp<0&&dq>0)||(dp>0&&dq<0))polygon.push(p.map((v,k)=>v+(q[k]-v)*dp/(dp-dq)));
  }
  const cutArea=polygon.reduce((sum,p,j)=>{const q=polygon[(j+1)%polygon.length];return sum+p[0]*q[1]-p[1]*q[0];},0);
  if(Math.abs(cutArea)>tol*tol)cuts.push({role,profile:polygon,kind:'through',structural:true,sectionPlane:true});
 }
 return cuts;
}

function targetDifference(recon,a,b) {
 const role=recon.inferredRoles[0],size={w:400,h:400};
 const ab=agreement(a[role],b[role],size,2.25),ba=agreement(b[role],a[role],size,2.25);
 return Math.max(1-ab.ratio,1-ba.ratio);
}

export function searchJointStructure(recon,{maxCandidates=160,maxMilliseconds=12000}={}) {
 const started=performance.now();let timedOut=false;
 const bodies=jointBodyHypotheses(recon),unknown=recon.features.filter(f=>f.kind==='unknown'&&!f.profile&&!recon.inferredRoles.includes(f.role)&&f.r>.025&&f.r<.42);
 if(!bodies.length||!unknown.length&&!bodies.some(b=>b.sectionCuts?.length))return {status:'not-applicable',trials:[]};
 // Never silently truncate the feature set and call that an exhaustive solve.
 if(unknown.length>3||recon.features.some(f=>f.kind==='unknown'&&f.profile))return {status:'unsupported',trials:[],reason:'超出当前联合求解的圆孔特征范围'};
 const options=unknown.map(f=>{
  const {ranges,evidence}=measuredCutRanges(recon,f);
  return [{feature:null,evidence:[]},...ranges.map(range=>({feature:{...f,kind:'through',structural:true,...(range[0]===0&&range[1]===1?{}:{axialRange:range})},evidence}))];
 });
 const required=bodies.length*options.reduce((n,os)=>n*os.length,1);
 if(required>maxCandidates)return {status:'budget-exceeded',required,maxCandidates,trials:[]};
 const fixed=recon.features.filter(f=>!unknown.includes(f)),trials=[],finalists=[];let diagnostic;
 function visit(body,chosen,index) {
  if(performance.now()-started>maxMilliseconds){timedOut=true;return;}
  if(index<options.length){for(const o of options[index])visit(body,[...chosen,o],index+1);return;}
  const features=[...fixed,...(body.sectionCuts||[]),...chosen.flatMap(o=>o.feature?[o.feature]:[])],candidate={...recon,bodyComponents:body.components,bodyBoxes:body.boxes,bodySourceRoles:roles,features};
  try {
   const projection=Object.fromEntries(Object.entries(projectConstructiveSolid(candidate)).map(([r,ls])=>[r,deduplicateProjection(ls)]));
   const audit=auditJointProjection(recon,projection),trial={family:body.family,features,quality:audit.quality,supported:audit.supported};
   trials.push(trial);
   if(!diagnostic||audit.quality>diagnostic.quality)diagnostic=audit;
   if(audit.supported)finalists.push({body,features,projection,audit,evidence:chosen.flatMap(o=>o.evidence)});
  }catch(error){trials.push({family:body.family,error:error.message});}
 }
 for(const body of bodies)visit(body,[],0);
 if(timedOut)return {status:'budget-exceeded',required,maxCandidates,maxMilliseconds,trials,reason:'联合候选搜索达到时间上限，尚未完成全部比较；已保留图线'};
 finalists.sort((a,b)=>b.audit.quality-a.audit.quality);
 const best=finalists[0];
 if(!best)return {status:'inconsistent',required,trials,audit:diagnostic};
 const alternatives=finalists.slice(1).filter(c=>best.audit.quality-c.audit.quality<.015&&targetDifference(recon,best.projection,c.projection)>.025);
 if(alternatives.length)return {status:'ambiguous',required,trials,audit:best.audit,alternatives:alternatives.slice(0,3).map(c=>({family:c.body.family,features:c.features,quality:c.audit.quality})),reason:'两幅已知图仍支持不同的补画结果，需补充孔深或结构条件'};
 return {status:'solved-within-grammar',required,trials,best};
}

export function solveJointStructure(recon,geometry) {
 const result=searchJointStructure(recon);
 recon.jointStructureFit={...result};delete recon.jointStructureFit.best;
 if(result.status==='not-applicable'||result.status==='unsupported')return geometry;
 if(!result.best) {
  recon.profileStructureFit={...recon.profileStructureFit,unresolved:true};
  throw new Error(result.reason||'联合结构求解尚未通过：当前候选实体无法同时解释两幅已知图的实线、虚线和孔槽终止位置。已保留图线，暂不生成补图和实体。');
 }
 const {body,features,projection,audit,evidence}=result.best;
 for(const f of features.filter(f=>f.structural)) {
  if(f.sectionPlane){f.evidence='由已知视图的实测直边确定截平面，与另一幅圆形投影共同核对';continue;}
  const axis=['长度（左→右）','深度（前→后）','高度（下→上）'][axisOf[f.role]];
  f.evidence=f.axialRange?`两幅已知图联合核对，孔沿${axis}方向从总尺寸的 ${(f.axialRange[0]*100).toFixed(1)}% 到 ${(f.axialRange[1]*100).toFixed(1)}%，保留终止壁`:'两幅已知图联合核对孔口、孔壁及遮挡，当前结构为贯通孔';
 }
 const candidate={...recon,bodyComponents:body.components,bodyBoxes:body.boxes,bodySourceRoles:roles,features};
 // Allocate a mesh only for the final, jointly checked interpretation.
 const mesh=buildUploadSolid(candidate,features);
 geometry?.dispose();Object.assign(recon,{bodyComponents:body.components,bodyBoxes:body.boxes,bodySourceRoles:roles,features,lessonProjections:projection});
 recon.jointStructureFit={...recon.jointStructureFit,selected:body.family,audit,evidence};
 if(recon.profileStructureFit)delete recon.profileStructureFit.unresolved;
 return mesh;
}

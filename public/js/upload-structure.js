import {buildUploadSolid} from './upload-model.js';
import {projectionScores,projectionPrecision} from './upload-fit.js';
import {projectConstructiveSolid} from './upload-analytic.js';
import {deduplicateProjection} from './upload-projection.js';

const tau=Math.PI*2;
function span(work,c) {
 const angles=new Set(work.paths.filter(p=>c.ids.includes(p.id)).flatMap(p=>p.points.map(q=>Math.round(((Math.atan2((q[1]-c.v)/c.ry,(q[0]-c.u)/c.rx)+tau)%tau)*72/tau)%72)));
 return angles.size;
}

// Infer positive volumes before cuts. In the plan view a circular body and
// a rectangular extension are not a prism with a single constant section:
// a measured semicircle in the elevation can be an added cylindrical boss.
export function cylindricalBodyHypotheses(recon) {
 if(recon.inferredRoles.includes('front')||recon.inferredRoles.includes('top'))return [];
 const front=recon.drawing.front,top=recon.drawing.top;
 if(front.type!=='rectangle')return [];
 const topCircles=(top.curveDatums||[]).filter(c=>span(top,c)>=68),frontCircles=front.curveDatums||[];
 const candidates=[];
 for(const outer of topCircles.filter(c=>c.rx>.4))for(const base of frontCircles.filter(c=>c.v>.97&&c.v<1.03&&span(front,c)>=33&&span(front,c)<=40)) {
  if(Math.abs(base.u-outer.u)>.02||base.rx>=outer.rx-.04||base.rx<outer.rx*.4)continue;
  // The rectangular projection must actually extend beyond the circular body
  // at both ends and agree with the semicylinder's measured width.
  const walls=[base.u-base.rx,base.u+base.rx];
  const yEnds=walls.map(x=>top.paths.filter(p=>p.lt==='v'&&!p.arc).flatMap(p=>p.points.slice(1).flatMap((b,i)=>{const a=p.points[i];return Math.abs(a[0]-b[0])<.008&&Math.abs((a[0]+b[0])/2-x)<.025&&Math.abs(a[1]-b[1])>.04?[a[1],b[1]]:[]})));
  if(yEnds.some(ys=>!ys.length||Math.min(...ys)>outer.v-outer.ry-.015||Math.max(...ys)<outer.v+outer.ry+.015))continue;
  const lo=Math.max(0,Math.min(...yEnds.flat())),hi=Math.min(1,Math.max(...yEnds.flat()));
  if(hi-lo<.7)continue;
  for(const inner of topCircles.filter(c=>c!==outer&&c.rx<outer.rx*.8&&Math.hypot(c.u-outer.u,c.v-outer.v)<.02))for(const bore of frontCircles.filter(c=>span(front,c)>=68)) {
   if(Math.abs(bore.u-inner.u)>.02||Math.abs(bore.rx-inner.rx)>.02||bore.v<=.05||bore.v>=.9)continue;
   const x=(outer.u+inner.u+bore.u+base.u)/4,r=(bore.rx+inner.rx)/2;
   const components=[{axis:'z',x,y:1-outer.v,z:.5,r:outer.rx,lo:0,hi:1},{axis:'y',x,y:.5,z:Math.max(0,1-base.v),r:base.rx,lo:1-hi,hi:1-lo}];
   const cuts=[{role:'top',u:x,v:outer.v,r,kind:'through',structural:true},{role:'front',u:x,v:bore.v,r,kind:'through',structural:true}];
   candidates.push({components,cuts,sourceRoles:['front','top','side'],outer,base,bore,inner});
  }
 }
 return candidates;
}

export function solveUploadStructure(recon,geometry) {
 const hypotheses=cylindricalBodyHypotheses(recon);if(!hypotheses.length)return geometry;
 // Registration and stroke uncertainty are measured in source pixels. A
 // fixed normalized threshold rejects the same small drawing after resizing.
 const scoreOptions={tolerance:role=>{const d=recon.drawing[role].sourceSize;return Math.max(.018,d?3/Math.min(d.w,d.h):.018);}};
 const harmonic=(r,p)=>2*r*p/(r+p||1),before=projectionScores(recon,recon.lessonProjections,scoreOptions),beforePrecision=projectionPrecision(recon,recon.lessonProjections,scoreOptions);
 const baseline=Object.keys(before).reduce((s,r)=>s+harmonic(before[r],beforePrecision[r]),0)/Object.keys(before).length;
 const trials=[];let best=null;
 for(const h of hypotheses) {
  // The visible vertical walls above the round opening distinguish an open
  // slot from a pair of closed intersecting bores. Try both directions, since
  // first-angle left-view depth reverses relative to the plan view.
  for(const direction of [null,'front','rear']) {
   const features=h.cuts.map(f=>({...f,evidence:'圆孔由两幅实测视图共同约束，正体分解和实体双向投影核对通过；可人工改判'}));
   if(direction) {
    const x=h.cuts[0].u,r=h.cuts[0].r,v=h.outer.v;
    const a=direction==='front'?v:0,b=direction==='front'?1:v;
    features.push({role:'top',kind:'pocket',depth:h.bore.v,profile:[[x-r,a],[x+r,a],[x+r,b],[x-r,b],[x-r,a]],u:x,v:(a+b)/2,r,structural:true});
   }
   const candidateRecon={...recon,bodyComponents:h.components,bodySourceRoles:h.sourceRoles,features};let candidate;
   try {
    candidate=buildUploadSolid(candidateRecon,features);
    const projection=Object.fromEntries(Object.entries(projectConstructiveSolid(candidateRecon)).map(([r,ls])=>[r,deduplicateProjection(ls)])),recall=projectionScores(recon,projection,scoreOptions),precision=projectionPrecision(recon,projection,scoreOptions);
    const roles=Object.keys(recall),quality=roles.reduce((s,r)=>s+2*recall[r]*precision[r]/(recall[r]+precision[r]||1),0)/roles.length;
    const trial={direction,recall,precision,quality};trials.push(trial);
    if(!best||quality>best.quality){best?.geometry.dispose();best={geometry:candidate,projection,quality,trial,features,components:h.components,sourceRoles:h.sourceRoles};candidate=null;}
   }catch(error){trials.push({direction,error:error.message});}
   finally{candidate?.dispose();}
  }
 }
 recon.structureFit={trials,baseline};
 const runnerUp=trials.filter(t=>t!==best?.trial&&Number.isFinite(t.quality)).sort((a,b)=>b.quality-a.quality)[0];
 const recalls=best?Object.values(best.trial.recall):[];
 const precisions=best?Object.values(best.trial.precision):[],mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
 const supported=best&&recalls.every(v=>v>.72)&&mean(recalls)>.85&&precisions.every(v=>v>.78)&&mean(precisions)>.85;
 if(supported&&best.quality>.86&&best.quality>baseline+.025&&(!runnerUp||best.quality-runnerUp.quality>.025)) {
  geometry.dispose();geometry=best.geometry;recon.bodyComponents=best.components;recon.bodySourceRoles=best.sourceRoles;recon.features=best.features;
  recon.lessonProjections=best.projection;recon.structureFit.selected=best.trial;
 }else best?.geometry.dispose();
 return geometry;
}

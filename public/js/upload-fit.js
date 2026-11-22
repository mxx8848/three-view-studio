import {buildUploadSolid} from './upload-model.js';
import {projectUploadSolid} from './upload-projection.js';

export function projectionScores(recon,projection,{tolerance=.018}={}) {
  const result={};
  for(const role of ['front','top','side']) {
    if(recon.inferredRoles.includes(role))continue;
    const lines=projection[role]||[];let weight=0,matched=0;
    for(const path of recon.drawing[role].paths.filter(p=>p.lt==='v'||p.lt==='h'))for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
      if(!length)continue;
      const steps=Math.max(1,Math.ceil(length/.025));
      for(let k=0;k<steps;k++) {
        const p=[a[0]+(b[0]-a[0])*(k+.5)/steps,a[1]+(b[1]-a[1])*(k+.5)/steps];let best=Infinity;
        for(const l of lines.filter(l=>l.lt===path.lt)) {
          const [u,v]=l.p,dx=v[0]-u[0],dy=v[1]-u[1],t=Math.max(0,Math.min(1,((p[0]-u[0])*dx+(p[1]-u[1])*dy)/(dx*dx+dy*dy||1)));
          best=Math.min(best,Math.hypot(p[0]-u[0]-t*dx,p[1]-u[1]-t*dy));
        }
        weight+=length/steps;if(best<(typeof tolerance==='function'?tolerance(role):tolerance))matched+=length/steps;
      }
    }
    result[role]=weight?matched/weight:0;
  }
  return result;
}

// Penalize invented edges as well as missing measured edges. Without the
// reverse comparison, adding enough arbitrary cuts always improves the score.
export function projectionPrecision(recon,projection,options) {
  const drawing=Object.fromEntries(['front','top','side'].map(role=>[role,{paths:(projection[role]||[]).map(l=>({lt:l.lt,points:l.p}))}]));
  const measured=Object.fromEntries(['front','top','side'].map(role=>[role,recon.drawing[role].paths.filter(p=>p.lt==='v'||p.lt==='h').flatMap(p=>p.points.slice(1).map((q,i)=>({lt:p.lt,p:[p.points[i],q]})))]));
  return projectionScores({...recon,drawing},measured,options);
}

// An internal circle alone is ambiguous. Accept a cut only when its actual
// mesh projections improve measured edges in that view AND another view.
export function fitUploadFeatures(recon,geometry) {
  let baseline=projectionScores(recon,recon.lessonProjections),precision=projectionPrecision(recon,recon.lessonProjections);const trials=[];
  const candidates=[...recon.features.filter(f=>!f.profile&&f.kind==='unknown').slice(0,8),...recon.features.filter(f=>f.profile&&f.kind==='unknown'&&f.role==='top'&&f.profile.every(p=>p[0]>.05&&p[0]<.95&&p[1]>.05&&p[1]<.95)).slice(0,4)];
  const floorLevels=feature=>{
    if(feature.role!=='top')return [];
    const lo=feature.profile?Math.min(...feature.profile.map(p=>p[0])):feature.u-feature.r,hi=feature.profile?Math.max(...feature.profile.map(p=>p[0])):feature.u+feature.r;
    const nested=feature.profile&&recon.features.some(f=>f!==feature&&f.role==='top'&&f.profile&&Math.min(...f.profile.map(p=>p[0]))<lo-.02&&Math.max(...f.profile.map(p=>p[0]))>hi+.02&&Math.min(...f.profile.map(p=>p[1]))<Math.min(...feature.profile.map(p=>p[1]))-.02&&Math.max(...f.profile.map(p=>p[1]))>Math.max(...feature.profile.map(p=>p[1]))+.02);
    if(feature.profile&&!nested&&feature.joinedCircle===undefined)return [];
    const segments=recon.drawing.front.paths.filter(p=>p.lt==='h'||p.lt==='t'||p.lt==='v'||p.colored).flatMap(p=>p.points.slice(1).flatMap((b,i)=>{
      const a=p.points[i],y=(a[1]+b[1])/2;
      return !p.arc&&!a.curved&&!b.curved&&Math.abs(a[1]-b[1])<.005&&Math.abs(a[0]-b[0])>.015&&y>.08&&y<.5?[[Math.min(a[0],b[0]),Math.max(a[0],b[0]),y,p.lt==='h'||p.lt==='t'||p.colored]]:[];
    }));
    // A hidden floor is often split by a centreline or dash gaps. Require
    // measured coverage of the slot width; a single short dash is insufficient.
    const levels=[];
    for(const seed of segments.filter(s=>s[3])) {
      const spans=segments.filter(s=>Math.abs(s[2]-seed[2])<.005&&s[0]>=lo-.035&&s[1]<=hi+.035).sort((a,b)=>a[0]-b[0]);
      if(!spans.length||Math.abs(spans[0][0]-lo)>.035)continue;
      let end=spans[0][1],covered=end-spans[0][0],connected=true;
      for(const s of spans.slice(1)){if(s[0]-end>.055){connected=false;break;}covered+=Math.max(0,s[1]-Math.max(end,s[0]));end=Math.max(end,s[1]);}
      if(connected&&Math.abs(end-hi)<.035&&covered/(hi-lo)>.4&&!levels.some(y=>Math.abs(y-seed[2])<.005))levels.push(seed[2]);
    }
    // The upper lip may also span the slot. Prefer the lowest supported
    // internal floor, rather than cutting only as far as that lip.
    return levels.sort((a,b)=>b-a);
  };
  for(const feature of candidates) {
   let best=null;
   const measuredLevels=floorLevels(feature),depths=feature.profile?[...new Set([...measuredLevels,feature.depth||.4,.2,.3,.35,.45])]:[null,...measuredLevels];
   // An outer closed loop surrounding an inner loop is often the lip of a
   // raised boss. Do not remove that boss merely to match its plan-view edges.
   if(feature.profile&&!measuredLevels.length&&recon.features.some(f=>f!==feature&&f.role===feature.role&&f.profile&&[0,1].every(axis=>Math.min(...f.profile.map(p=>p[axis]))>Math.min(...feature.profile.map(p=>p[axis]))+.02&&Math.max(...f.profile.map(p=>p[axis]))<Math.max(...feature.profile.map(p=>p[axis]))-.02)))continue;
   for(const depth of depths) {
    const kind=feature.profile||depth!==null?'pocket':'through';
    const features=recon.features.map(f=>f===feature?{...f,kind,...(depth?{depth}:{})}:f);let candidate;
    try {
      candidate=buildUploadSolid(recon,features);
      const projected=projectUploadSolid(candidate,recon.modelSize),score=projectionScores(recon,projected),nextPrecision=projectionPrecision(recon,projected),roles=Object.keys(baseline),gains=roles.map(r=>score[r]-baseline[r]);
      const measuredFloor=depth!==null&&measuredLevels.some(y=>Math.abs(y-depth)<.005);
      const harmonic=(recall,precision)=>2*recall*precision/(recall+precision||1);
      const balancedGain=roles.reduce((sum,r)=>sum+harmonic(score[r],nextPrecision[r])-harmonic(baseline[r],precision[r]),0)/roles.length;
      const accepted=!!(score[feature.role]-baseline[feature.role]>.06&&(roles.some(r=>r!==feature.role&&score[r]-baseline[r]>(feature.measured ? .02 : .03))||measuredFloor)&&gains.every(g=>g>(measuredFloor?-.06:-.015))&&balancedGain>(measuredFloor?-.01:.012));
      const trial={role:feature.role,kind,depth,measuredFloor,accepted:false,eligible:accepted,balancedGain,before:baseline,after:score,precisionBefore:precision,precisionAfter:nextPrecision};trials.push(trial);
      if(accepted&&(!best||balancedGain>best.gain+.0001)) {
        best?.geometry.dispose();best={geometry:candidate,projected,score,precision:nextPrecision,kind,depth,gain:balancedGain,trial,measuredFloor};candidate=null;
      }
    }catch(error){trials.push({role:feature.role,accepted:false,reason:error.message});}
    finally{candidate?.dispose();}
   }
   if(best) {
    best.trial.accepted=true;feature.kind=best.kind;if(best.depth!==null)feature.depth=best.depth;
    feature.evidence=best.measuredFloor?'切削深度由实测隐藏槽底约束，并通过实体投影比较；仍可改判':'候选孔槽通过双向投影比较，同时改善两幅实测视图；仍可改判';
    geometry.dispose();geometry=best.geometry;recon.lessonProjections=best.projected;baseline=best.score;precision=best.precision;
   }
  }
  recon.featureFit={scores:baseline,precision,trials};return geometry;
}

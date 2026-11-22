import { thresholdSelectedViews } from './recognize.js';
import { extractUploadLines,detectCircularFeatures,detectPocketRegions } from './upload-lines.js';
import { reconstructFromViews } from './reconstruct.js';
import { constructionPlan } from './upload-board.js';
import { buildUploadSolid, alignCircularSilhouetteSize } from './upload-model.js';
import { projectUploadSolid } from './upload-projection.js';
import { regularizeUploadDrawing } from './upload-drawing.js';
import {fitUploadFeatures} from './upload-fit.js';
import {fitClosedMeasuredRings} from './upload-constraints.js';
import {registerMeasuredFeatures} from './upload-registration.js';
import {solveUploadStructure} from './upload-structure.js';
import {projectConstructiveSolid,supportsConstructiveProjection} from './upload-analytic.js';
import {deduplicateProjection} from './upload-projection.js';
import {solveProfileStructure,alignSupportedWalls} from './upload-profile-structure.js';
import {solveJointStructure,auditJointProjection,hiddenSupports,drawingPixelSize} from './upload-joint-solver.js';
import {measureSectionFrames} from './upload-section-structures.js';
import {checkConstructiveMesh} from './upload-mesh-check.js';
import {extractPhotoViews} from './upload-photo-lines.js';
import {recoverMeasuredPrimitives} from './upload-primitives.js';
import {solveRectilinear,gridProjection} from './upload-rectilinear.js';
import {measureParallelSections,parallelSectionMesh,projectParallelMesh} from './upload-parallel-sections.js';
import {measureCrossDrills} from './upload-cross-drill.js';

// Subtract measured intervals in source pixels. Testing only endpoints and a
// midpoint can erase an entire missing section of a long edge. Keep world
// coordinates at every new endpoint for the 45-degree construction board.
export function missingProjectionForRole(recon,role) {
  const work=recon.drawing[role],size=drawingPixelSize(work),tol=2.25;
  const src=work.paths.filter(p=>['v','h','t'].includes(p.lt)).flatMap(p=>p.points.slice(1).map((b,i)=>({p:[p.points[i],b],lt:p.lt,hiddenCircle:p.hiddenCircle,weak:!p.manualType&&(p.lt==='t'||p.width<work.thickWidth*.7&&!p.black&&!p.colored)})));
  const px=p=>[p[0]*size.w,p[1]*size.h];
  // Never overpaint a supplied visible edge with a hidden edge. The mesh
  // audit still reports wrong line types. Fine ink may be an unclassified
  // dash. On the teaching overlay only, suppress small white gaps between
  // collinear fine fragments too; the independent typed audit is unchanged.
  const supports=[...src,...hiddenSupports(src.map(s=>s.weak?{...s,lt:'h'}:s),size).filter(s=>s.dashGap)].map(s=>({...s,p:s.p.map(px)}));
  return recon.lessonProjections[role].flatMap(l=>{
    const [a,b]=l.p.map(px),len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(len<1e-7)return [];
    const ux=(b[0]-a[0])/len,uy=(b[1]-a[1])/len,intervals=[];
    for(const s of supports){
      if(s.lt!==l.lt&&!(l.lt==='h'&&(s.lt==='v'||s.lt==='t')))continue;
      const [c,d]=s.p,dx=d[0]-c[0],dy=d[1]-c[1];
      if(Math.abs(ux*dy-uy*dx)>.18*Math.hypot(dx,dy))continue;
      const t=s.p.map(q=>(q[0]-a[0])*ux+(q[1]-a[1])*uy).sort((x,y)=>x-y);
      const lo=Math.max(0,t[0]-tol),hi=Math.min(len,t[1]+tol);
      if(hi<=lo)continue;
      const sl=Math.hypot(dx,dy);if(!sl)continue;
      if([lo,hi].some(v=>Math.abs((a[0]+v*ux-c[0])*dy-(a[1]+v*uy-c[1])*dx)>sl*tol))continue;
      intervals.push([lo,hi]);
    }
    if(!intervals.length)return [l];
    const missing=[],lerp=(pair,t)=>pair[0].map((v,k)=>v+(pair[1][k]-v)*t/len);
    const add=(lo,hi)=>{if(hi-lo>tol)missing.push({...l,p:[lerp(l.p,lo),lerp(l.p,hi)],...(l.world?{world:[lerp(l.world,lo),lerp(l.world,hi)]}:{})});};
    let end=0;
    for(const [lo,hi] of intervals.sort((a,b)=>a[0]-b[0])){add(end,lo);end=Math.max(end,hi);}
    add(end,len);return missing;
  });
}

function reviewProjections(recon) {
  delete recon.completionProjections;delete recon.projectionReview;
  if(!recon.lessonProjections)return;
  recon.completionProjections={};
  if(recon.completionRole)recon.completionProjections[recon.completionRole]=missingProjectionForRole(recon,recon.completionRole);
  if(recon.jointStructureFit?.selected)recon.jointStructureFit.audit=auditJointProjection(recon,recon.lessonProjections);
  const verified=recon.modelVerification?.status==='passed';
  const views={};
  for(const role of ['front','top','side']) {
    if(recon.inferredRoles.includes(role))continue;
    const missing=missingProjectionForRole(recon,role).filter(l=>l.lt==='h');
    const length=missing.reduce((sum,l)=>sum+Math.hypot(l.p[1][0]-l.p[0][0],l.p[1][1]-l.p[0][1]),0);
    views[role]={missingHiddenLength:length,addedHidden:verified&&length>.025?missing.length:0};
    if(views[role].addedHidden)recon.completionProjections[role]=[...(recon.completionProjections[role]||[]),...missing.filter(l=>!recon.completionProjections[role]?.includes(l))];
  }
  recon.projectionReview={verified,views,unresolved:recon.features.filter(f=>f.kind==='unknown').length};
}

export function prepareUploadLesson(recon,linework,target=recon.plan?.target,{retainGeometry=false,fitFeatures=false,onProgress=()=>{}}={}) {
  onProgress('正在校正直线与圆弧…');
  // A leaking outside boundary can make flood filling select an internal
  // circle. Keep the measured view's full datum and ask for line correction.
  for(const role of ['front','top','side']) {
    const state=recon.viewStates?.[role],b=recon.silhouetteBounds?.[role];
    if(!recon.inferredRoles.includes(role)&&state?.kind==='complete'&&b&&b.w<state.bounds.w*.65&&b.h<state.bounds.h*.65) {
      recon.contourReviewRoles=[...new Set([...(recon.contourReviewRoles||[]),role])];
      recon.silhouetteBounds[role]={...state.bounds};
    }
  }
  regularizeUploadDrawing(recon,linework);
  for(const [role,paths]of Object.entries(recon.drillInk||{}))recon.drawing[role].paths=paths;
  for(const [role,frame]of Object.entries(recon.parallelSectionFrames||{}))Object.assign(recon.drawing[role],frame);
  if(recon.contourReviewRoles?.length) {
    const pixels=role=>{const [a,b,c]=recon.drawing[role].sourceMap;return [1/Math.abs(b[0]-a[0]),1/Math.abs(c[1]-a[1])];};
    const dimensions={x:[],y:[],z:[]};
    for(const role of ['front','top','side'].filter(r=>!recon.inferredRoles.includes(r))){const [w,h]=pixels(role);dimensions[role==='side'?'y':'x'].push(w);dimensions[role==='top'?'y':'z'].push(h);}
    const measured=Object.fromEntries(Object.entries(dimensions).map(([axis,values])=>[axis,values.reduce((s,v)=>s+v,0)/values.length]));
    if(Object.values(measured).every(v=>Number.isFinite(v)&&v>0)){const max=Math.max(...Object.values(measured));recon.modelSize=Object.fromEntries(Object.entries(measured).map(([axis,v])=>[axis,v/max]));}
  }
  let geometry;
  delete recon.lessonProjections;
  try {
    if(recon.inferredRoles.some(role=>recon.roles?.[role]?.partial&&recon.viewStates[role].kind==='partial'&&!recon.viewStates[role].registered)){
      recon.profileStructureFit={unresolved:true,trials:[]};
      throw new Error('残线的位置尚不能与另外两图对齐。请框入能确定宽、深范围的端边，并检查主、俯视长对正、主、左视高平齐；仅知道一段线的长度不能确定它在零件上的位置。');
    }
    if(recon.contourReviewRoles?.length){recon.profileStructureFit={trials:[],unresolved:true};throw new Error('孔槽结构核对未通过：外轮廓识别范围小于已知图线，可能误将内孔作为外形。已保留完整线稿，请检查轮廓接合与线型后重新核对。');}
    onProgress('正在求解三投影实体交集…');
    // Missing views need the structural pass before a potentially expensive
    // visual hull. Complete inputs retain the established solve order.
    if(fitFeatures&&!recon.bodyComponents) {
      const result=solveRectilinear(recon);
      if(result.status==='solved'&&auditJointProjection(recon,gridProjection(result.grid,recon.modelSize)).supported) {
        Object.assign(recon,{orthogonalGrid:result.grid,bodyBoxes:result.boxes,bodyComponents:[],bodySourceRoles:['front','top','side'],features:[],
          profileStructureFit:{selected:'orthogonal-cells',trials:[]},structureExplanation:[
            '沿已知图中的水平、竖直棱线把零件分层；将长、宽、高相同的位置投到另一幅图。',
            '比较相邻两条视线：最近表面发生变化处画实线；只有后方材料发生变化处画虚线。保留与各幅已知图都相符的材料，得到台阶、凹槽或开口。']});
      } else if(['ambiguous','budget'].includes(result.status)){
        recon.profileStructureFit={unresolved:true,trials:[]};
        throw new Error(result.status==='ambiguous'?`同一组已知图线至少对应两种直角零件。在从左、前、下分别量总长、深、高的 ${result.point.map(v=>Math.round(v*100)+'%').join('、')} 处，一种是材料，另一种是空处。请用第三视图的棱线、槽深或剖视图区分。`:'直角结构候选较多，尚未比较完毕。请补充缺线视图或剖视条件。');
      }
    }
    if(fitFeatures&&!recon.bodyComponents){
      for(const candidate of measureParallelSections(recon)){
        const {sweep,elevation,frame,axialScale=1}=candidate,axis={front:'y',side:'x',top:'z'}[sweep.end],modelSize={...recon.modelSize,[axis]:recon.modelSize[axis]*axialScale},mesh=parallelSectionMesh(sweep,modelSize);
        let accepted=false;
        try{
          const projection=projectParallelMesh(mesh,modelSize);
          const frames={...candidate.otherFrames,[elevation]:frame},drawing={...recon.drawing};
          for(const [role,f]of Object.entries(frames))drawing[role]={...drawing[role],...f};
          if(auditJointProjection({...recon,drawing},projection).supported){
            Object.assign(recon,{drawing,modelSize,parallelSections:sweep,parallelSectionFrames:frames,bodyComponents:[],bodySourceRoles:[sweep.end,elevation],features:[],
              lessonProjections:projection,profileStructureFit:{selected:sweep.planes?'inclined-end-sections':'parallel-sections',trials:[]},structureExplanation:sweep.planes?[
                '从端视图确定外轮廓和孔的直径。在另一幅视图中逐条核对孔壁虚线是否一直延伸到两个端面。',
                '沿圆周选取素线，将每一条素线与实测端面相交。依次连接交点得到截交线；按前方是否还有材料区分实线和虚线。']:[
                '在端视图标出每个封闭圆的圆心和两条相切的投影线，把这些位置对正到另一幅已知图。',
                `沿台肩和孔底分成 ${sweep.layers.length} 层。${{x:'从左端向右',y:'从后端向前',z:'从顶面向下'}[axis]}量，内部分界在总尺寸的 ${sweep.bands.slice(1,-1).map(x=>(x*100).toFixed(1)+'%').join('、')}。逐层核对外壁实线和孔壁虚线，在这些位置改变截面。`,
                '把各层的棱边投到待补视图。被前方材料挡住的孔壁画虚线，和可见边重合处保留实线。']});
            geometry=mesh;accepted=true;
          }
        }finally{if(!accepted)mesh.dispose();}
        if(accepted)break;
      }
    }
    if(fitFeatures&&!recon.bodyComponents)geometry=measureCrossDrills(recon);
    if(fitFeatures&&recon.inferredRoles.length&&!recon.bodyComponents)geometry=solveProfileStructure(recon,undefined,linework);
    if(fitFeatures&&recon.inferredRoles.length&&!recon.bodyComponents) {
      onProgress('正在联合比较孔槽方向、深度与两图虚实线…');
      geometry=solveJointStructure(recon,geometry);
    }
    geometry??=buildUploadSolid(recon,recon.features);
    onProgress('正在计算隐藏线与补画步骤…');
    if(recon.parallelSections)recon.lessonProjections??=projectParallelMesh(geometry,recon.modelSize);
    else if(!recon.lessonProjections||recon.profileStructureFit?.selected!=='cross-drilled-stock')recon.lessonProjections=supportsConstructiveProjection(recon)?Object.fromEntries(Object.entries(projectConstructiveSolid(recon)).map(([r,ls])=>[r,deduplicateProjection(ls)])):projectUploadSolid(geometry,recon.modelSize);
    if(fitFeatures){if(!recon.inferredRoles.length&&!recon.bodyComponents)geometry=solveProfileStructure(recon,geometry,linework);if(!recon.bodyComponents)geometry=solveUploadStructure(recon,geometry);if(!recon.bodyComponents)geometry=fitUploadFeatures(recon,geometry);}
    delete recon.lessonError;
  } catch(error) {recon.lessonError=error.message;geometry?.dispose();geometry=undefined;delete recon.lessonProjections;}
  if(recon.lessonProjections)alignSupportedWalls(recon);
  delete recon.modelVerification;
  if(geometry&&recon.lessonProjections) {
    onProgress('正在回投实际模型，逐幅检查主视、左视与俯视…');
    try {
      const projected=supportsConstructiveProjection(recon)?projectUploadSolid(geometry,recon.modelSize,{creaseAngle:.06}):recon.lessonProjections;
      const audit=auditJointProjection(recon,projected);
      recon.modelVerification={...audit,status:audit.supported?'passed':'mismatch',basis:'mesh',views:Object.fromEntries(['front','side','top'].map(role=>[role,audit.views[role]?{...audit.views[role],status:(audit.views[role].recall.ratio>=.94&&(audit.views[role].partial||audit.views[role].precision.ratio>=.94)&&Object.values(audit.views[role].classes).every(c=>(c.recall.lengthPixels<8||c.recall.ratio>=.9)&&(audit.views[role].partial||c.precision.lengthPixels<8||c.precision.ratio>=.9)))?'passed':'mismatch'}:{status:'inferred'}]))};
      const material=checkConstructiveMesh(recon,geometry);recon.modelVerification.material=material;
      if(material.status==='mismatch') {
        recon.modelVerification.status='mismatch';
        for(const [role,v] of Object.entries(recon.modelVerification.views))if(material.perView[role]?.failed)v.status='mismatch';
      }
      if((recon.assumedPartial||recon.features.some(f=>f.kind==='unknown'))&&recon.modelVerification.status==='passed')recon.modelVerification.status='candidate';
    } catch(error) {recon.modelVerification={status:'error',message:error.message,views:{}};}
  }
  if(!retainGeometry)geometry?.dispose();
  reviewProjections(recon);
  recon.plan=constructionPlan(recon,linework,target);
  return retainGeometry?geometry:undefined;
}

export function outlineInk(linework,roles,width,height) {
  const ink=new Uint8Array(width*height);
  for(const role of ['front','top','side']) {
    const work=linework[role],box=roles[role],canvas=typeof document==='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');
    if(box.blank)continue;
    canvas.width=work.w;canvas.height=work.h;const ctx=canvas.getContext('2d');
    ctx.strokeStyle='black';ctx.lineCap='round';ctx.lineJoin='round';
    const measured=work.photoCorrection?recoverMeasuredPrimitives(work):null;
    for(const p of (measured?.paths||work.paths).filter(p=>p.lt==='v')) {
      ctx.lineWidth=Math.max(1,p.width);ctx.beginPath();p.points.forEach((q,i)=>i?ctx.lineTo(...q):ctx.moveTo(...q));ctx.stroke();
    }
    const pixels=ctx.getImageData(0,0,work.w,work.h).data;
    for(let y=0;y<work.h;y++)for(let x=0;x<work.w;x++)if(pixels[(y*work.w+x)*4+3]>96) {
      const gx=Math.floor(box.x)+x,gy=Math.floor(box.y)+y;
      if(gx>=0&&gy>=0&&gx<width&&gy<height)ink[gy*width+gx]=1;
    }
  }
  return ink;
}

export function analyzeUpload(canvas,roles,{retainGeometry=false,onProgress=()=>{},inspectOnly=false}={}) {
  onProgress('正在提取框选区域的线稿…');
  const extraction=thresholdSelectedViews(canvas,roles);
  const linework=extractPhotoViews(extraction.lineMasks,roles);
  return {...extraction,...analyzeUploadLinework(canvas,roles,linework,{retainGeometry,onProgress,inspectOnly})};
}

export function analyzeUploadLinework(canvas,roles,linework,{retainGeometry=false,onProgress=()=>{},inspectOnly=false}={}) {
  onProgress('正在对齐视图与重建外轮廓…');
  const result=reconstructFromViews({ink:outlineInk(linework,roles,canvas.width,canvas.height),linework,w:canvas.width,h:canvas.height,roles,views:Object.values(roles)},{res:72});
  if(!result.ok)return {...result,linework};
  onProgress('正在核对圆孔与槽形候选…');
  for(const [role,state] of Object.entries(result.viewStates))if(state.kind==='partial'&&!state.closedFrame)result.silhouetteBounds[role]=state.bounds;
  const absent=result.inferredRoles.filter(role=>result.viewStates[role].kind!=='partial');
  const featureLines=structuredClone(linework);
  const rings=Object.fromEntries(Object.entries(featureLines).map(([role,work])=>[role,fitClosedMeasuredRings(work.paths)]));
  const features=[...detectCircularFeatures(featureLines,result.silhouetteBounds,absent),...detectPocketRegions(linework,result.silhouetteBounds).filter(f=>!absent.includes(f.role))];
  for(const [role,measured] of Object.entries(rings))if(!absent.includes(role))for(const ring of measured) {
    const b=result.silhouetteBounds[role],u=(ring.cx-b.x)/b.w,v=(ring.cy-b.y)/b.h,r=ring.r/b.w;
    if(u-r<.02||u+r>.98||v-ring.r/b.h<.02||v+ring.r/b.h>.98)continue;
    if(!features.some(f=>f.role===role&&!f.profile&&Math.hypot(f.u-u,f.v-v)<.04&&Math.abs(f.r-r)<.04))features.push({role,u,v,r,kind:'unknown',evidence:'完整实测圆周跨越交点共圆；结构由多视图投影核对'});
  }
  const recon={...result,features:structuredClone(features),source:'upload',modelReady:false};alignCircularSilhouetteSize(recon);regularizeUploadDrawing(recon,linework,{mapFeatures:true});
  if(measureSectionFrames(recon,linework)){recon.features=structuredClone(features);regularizeUploadDrawing(recon,linework,{mapFeatures:true});}
  registerMeasuredFeatures(recon);
  if(inspectOnly)return {linework,recon,ok:true};
  const geometry=prepareUploadLesson(recon,linework,undefined,{retainGeometry,fitFeatures:true,onProgress});
  return {linework,recon,ok:true,...(retainGeometry?{geometry}:{})};
}

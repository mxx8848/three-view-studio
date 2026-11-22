// Orthogonal drillings through a rectangular stock. A circle alone is not
// enough: trace BOTH tangent walls to the opposite faces, allowing openings
// only inside measured rims of the crossing bores. This avoids enumerating
// every individual dash endpoint as a possible depth.
import {circleFit} from './upload-lines.js';
import {drawingPixelSize,auditJointProjection} from './upload-joint-solver.js';
import {buildUploadSolid} from './upload-model.js';
import {projectConstructiveSolid} from './upload-analytic.js';
import {deduplicateProjection} from './upload-projection.js';
import {checkConstructiveMesh} from './upload-mesh-check.js';
import {readWallDashes,restoreWallDashes} from './upload-dash-support.js';
const frames={front:[0,2,1],top:[0,1,2],side:[1,2,0]};

function rims(work){
 if(work.type!=='rectangle'||!work.inkMask||!work.sourceMap||work.paths.some(p=>p.manualType))return [];
 const {w,h}=drawingPixelSize(work),sc=[w,h],out=[];
 const datums=[...(work.curveDatums||[])];
 for(const p of work.paths.filter(p=>p.lt==='v'&&p.points.length>=9)){
  const pts=p.points.map(q=>q.map((x,k)=>x*sc[k]));
  if(Math.hypot(...pts[0].map((x,k)=>x-pts.at(-1)[k]))>2.5)continue;
  const f=circleFit(pts);if(f&&f.error*f.r<1.4)datums.push({u:f.cx/w,v:f.cy/h,rx:f.r/w,ry:f.r/h});
 }
 const [o,X,Y]=work.sourceMap,a=X[0]-o[0],b=Y[0]-o[0],c=X[1]-o[1],d=Y[1]-o[1],det=a*d-b*c,W=work.sourceSize.w;
 for(const t of datums){
  if(Math.min(t.rx*w,t.ry*h)<6||Math.min(t.u-t.rx,t.v-t.ry,1-t.u-t.rx,1-t.v-t.ry)<.025)continue;
  if(out.some(k=>Math.hypot((k.u-t.u)*w,(k.v-t.v)*h)<2&&Math.abs(k.rx-t.rx)*w<2))continue;
  let hit=0;
  for(let i=0;i<96;i++){
   const ang=i*Math.PI/48,u=t.u+t.rx*Math.cos(ang)-o[0],v=t.v+t.ry*Math.sin(ang)-o[1],x=Math.round((d*u-b*v)/det),y=Math.round((a*v-c*u)/det);
   if(work.inkMask[y*W+x])hit++;
  }
  if(hit>=91)out.push(t);
 }
 if(out.length>4||out.some((p,i)=>out.slice(i+1).some(q=>Math.hypot((p.u-q.u)*w,(p.v-q.v)*h)<(p.rx+q.rx)*w+3)))return [];
 return out;
}

export function measureCrossDrills(recon){
 const known=Object.keys(frames).filter(k=>!recon.inferredRoles.includes(k));
 for(const [i,left]of known.entries())for(const right of known.slice(i+1)){
  const roles=[left,right],loops=roles.map(k=>rims(recon.drawing[k]));
  if(loops.some(r=>!r.length))continue;
  const features=[],supports={[left]:[],[right]:[]};
  let crossing=false;
  for(const [j,role]of roles.entries()){
   const E=frames[role],other=roles[1-j],F=frames[other],along=F.indexOf(E[2]),cross=1-along,rad=E.indexOf(F[cross]),work=recon.drawing[other];
   const px=drawingPixelSize(work),sc=[px.w,px.h];
   for(const rim of loops[j]){
    const c=[rim.u,rim.v][rad],r=[rim.rx,rim.ry][rad];
    if(loops[1-j].some(s=>Math.abs([s.u,s.v][cross]-c)<[s.rx,s.ry][cross]+r))crossing=true;
    const walls=[-1,1].every(sign=>{
     const t=c+sign*r,runs=[];
     for(const p of work.paths.filter(p=>!p.arc&&p.lt==='h')){
      for(let i=1;i<p.points.length;i++){
       const a=p.points[i-1],b=p.points[i];if([a,b].some(q=>Math.abs(q[cross]-t)*sc[cross]>2))continue;
       if(Math.abs(a[along]-b[along])*sc[along]>=2)runs.push([Math.min(a[along],b[along]),Math.max(a[along],b[along])]);
      }
     }
     const raw=readWallDashes(work,along,t);if(!raw)return false;
     runs.push(...raw.runs);
     if(runs.length<3)return false;
     const gaps=runs.map(([l,h])=>(h-l)*sc[along]).sort((a,b)=>a-b),tol=Math.min(13,Math.max(5,gaps[gaps.length>>1]*1.5+2))/sc[along];
     // A missing region may be explained only where an actual other bore
     // removes the tangent generator. Its interval is the circle chord.
     const chords=loops[1-j].flatMap(s=>{
      const C=[s.u,s.v],R=[s.rx,s.ry],v=(t-C[cross])/R[cross];if(Math.abs(v)>=1)return [];
      const d=R[along]*Math.sqrt(1-v*v);return [[C[along]-d,C[along]+d]];
     });
     let end=0;for(const [a,b]of [...runs,...chords].sort((p,q)=>p[0]-q[0])){if(a>end+tol)return false;end=Math.max(end,b);}
     if(end+tol<1)return false;
     supports[other].push(raw);return true;
    });
    if(walls)features.push({role,u:rim.u,v:rim.v,r:rim.rx,kind:'through',structural:true,evidence:'两侧孔壁虚线均延伸至外端面；中断位置与另一方向孔口的弦长核对'});
   }
  }
  if(!crossing||features.length!==loops[0].length+loops[1].length)continue;
  const drawing={...recon.drawing},drillInk={};
  for(const role of roles){drillInk[role]=restoreWallDashes(drawing[role],supports[role]);drawing[role]={...drawing[role],paths:drillInk[role]};}
  const candidate={...recon,drawing,features,bodyBoxes:[{lo:[0,0,0],hi:[1,1,1]}],bodyComponents:[],bodySourceRoles:Object.keys(frames)};
  const projection=Object.fromEntries(Object.entries(projectConstructiveSolid(candidate)).map(([r,ls])=>[r,deduplicateProjection(ls)]));
  if(!auditJointProjection(candidate,projection).supported)continue;
  const mesh=buildUploadSolid(candidate,features);
  if(checkConstructiveMesh(candidate,mesh).status!=='passed'){mesh.dispose();continue;}
  Object.assign(recon,{drawing,drillInk,features,bodyBoxes:candidate.bodyBoxes,bodyComponents:[],bodySourceRoles:candidate.bodySourceRoles,
   profileStructureFit:{selected:'cross-drilled-stock',trials:[]},lessonProjections:projection,
   structureExplanation:[`两幅已知图共测得 ${features.length} 个孔口。在另一幅图沿每个孔的两条相切虚线找孔壁，并核对它们是否一直通到端面。`,
    '用一组辅助平面同时截两孔。每个截面上两圆柱的交点才属于相贯线；孔壁伸进另一孔的部分已没有材料，应从图上去掉。']});
  return mesh;
 }
}

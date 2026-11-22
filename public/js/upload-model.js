import * as THREE from 'three';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION, ADDITION } from 'three-bvh-csg';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { maskLoops, circleFit } from './upload-lines.js';
import {checkConstructiveMesh} from './upload-mesh-check.js';
import {parallelSectionMesh} from './upload-parallel-sections.js';

export function alignCircularSilhouetteSize(recon) {
  recon.sizeEvidence=[];
  const parents={x:'x',y:'y',z:'z'},root=a=>parents[a]===a?a:root(parents[a]);
  for(const role of ['front','top','side']) {
    if(recon.inferredRoles.includes(role))continue;
    const s=recon.silhouettes[role],loop=maskLoops(s.mask,s.w,s.h)[0]?.points,fit=loop&&circleFit(loop);
    if(!fit||fit.error>=.045||Math.abs(s.w-s.h)/Math.max(s.w,s.h)>=.12)continue;
    const axes=role==='front'?['x','z']:role==='top'?['x','y']:['y','z'];
    parents[root(axes[0])]=root(axes[1]);
    recon.sizeEvidence.push(`${{front:'主视',top:'俯视',side:'左视'}[role]}外轮廓按圆形候选处理，对应两轴使用相同比例；可按标注修改`);
  }
  for(const group of new Set(Object.keys(parents).map(root))) {
    const axes=Object.keys(parents).filter(a=>root(a)===group);
    if(axes.length<2)continue;
    const value=Math.exp(axes.reduce((s,a)=>s+Math.log(recon.modelSize[a]),0)/axes.length);
    for(const axis of axes)recon.modelSize[axis]=value;
  }
}

function silhouetteBrush(sil, role, size,drawing=null) {
  const loops=maskLoops(sil.mask,sil.w,sil.h,Math.max(.65,Math.max(sil.w,sil.h)*.002));
  if(!loops.length)throw new Error('外轮廓尚未闭合，请校正粗实线或选框');
  const loop=loops[0].points, fit=circleFit(loop);
  let points=loop;
  // Only regularize a complete near-circle, not arbitrary curved silhouettes.
  const spanX=Math.max(...loop.map(p=>p[0]))-Math.min(...loop.map(p=>p[0]));
  const spanY=Math.max(...loop.map(p=>p[1]))-Math.min(...loop.map(p=>p[1]));
  if(loops[0].area/(sil.w*sil.h)>.94)points=[[0,0],[sil.w,0],[sil.w,sil.h],[0,sil.h],[0,0]];
  if(fit&&fit.error<.045&&Math.abs(spanX-spanY)/Math.max(spanX,spanY)<.12) {
    points=Array.from({length:129},(_,i)=>[(.5+.5*Math.cos(i*Math.PI/64))*sil.w,(.5+.5*Math.sin(i*Math.PI/64))*sil.h]);
  }
  if(drawing?.outline)points=drawing.outline.map(p=>[p[0]*sil.w,p[1]*sil.h]);
  const a=role==='side'?size.y:size.x,b=role==='top'?size.y:size.z;
  const shape=new THREE.Shape();
  points.forEach((p,i)=>{const x=(p[0]/sil.w-.5)*a,y=(.5-p[1]/sil.h)*b;i?shape.lineTo(x,y):shape.moveTo(x,y);});shape.closePath();
  const depth=role==='front'?size.y:role==='top'?size.z:size.x;
  const geometry=new THREE.ExtrudeGeometry(shape,{depth:depth,bevelEnabled:false,steps:1,curveSegments:64});
  geometry.userData.envelope=points.length===5&&points.every(p=>(Math.abs(p[0])<1e-8||Math.abs(p[0]-sil.w)<1e-8)&&(Math.abs(p[1])<1e-8||Math.abs(p[1]-sil.h)<1e-8));
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++) {
    const u=p.getX(i),v=p.getY(i),d=p.getZ(i)-depth*.5;
    if(role==='front')p.setXYZ(i,u,-d,v);
    else if(role==='top')p.setXYZ(i,u,v,d);
    else p.setXYZ(i,-d,-u,v);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const brush=new Brush(geometry);brush.updateMatrixWorld();return brush;
}

// Merge only an exact material-equivalent union of coaxial equal cylinders.
// Adjacent cap triangles otherwise reach the CSG kernel as coincident faces,
// especially when a later pocket starts on that same cap plane.
export function mergeCoaxialComponents(components) {
 const out=[];
 for(const input of components) {
  const c={...input};
  if(c.analyticOnly){out.push(c);continue;}
  let changed=true;
  while(changed){
   changed=false;
   for(let i=out.length-1;i>=0;i--){const b=out[i];
    if(b.analyticOnly||b.axis!==c.axis||Math.abs(b.r-c.r)>1e-12||['x','y','z'].some(a=>a!==c.axis&&Math.abs(b[a]-c[a])>1e-12)||Math.max(b.lo,c.lo)>Math.min(b.hi,c.hi)+1e-12)continue;
    c.lo=Math.min(c.lo,b.lo);c.hi=Math.max(c.hi,b.hi);out.splice(i,1);changed=true;
   }
  }
  out.push(c);
 }
 return out;
}

export function buildUploadSolid(recon, features=[]) {
  if(recon.parallelSections&&!features.length)return parallelSectionMesh(recon.parallelSections,recon.modelSize);
  if(recon.orthogonalGrid&&!features.length) {
    // Emit only air/material interfaces. Adjacent cells share a plane and
    // must not leave a pair of internal faces (a false wall in a blind slot).
    const {planes,filled}=recon.orthogonalGrid,n=planes.map(p=>p.length-1),s=Object.values({x:recon.modelSize.x,y:recon.modelSize.y,z:recon.modelSize.z}),vertices=[];
    const solid=q=>q.every((v,i)=>v>=0&&v<n[i])&&filled[q[0]+n[0]*(q[1]+n[1]*q[2])];
    for(let z=0;z<n[2];z++)for(let y=0;y<n[1];y++)for(let x=0;x<n[0];x++){
      const q=[x,y,z];if(!solid(q))continue;
      for(let d=0;d<3;d++)for(const sign of [-1,1]){
        const other=q.slice();other[d]+=sign;if(solid(other))continue;
        const corners=[[0,0],[1,0],[1,1],[0,1]].map(([a,b])=>{
          const p=q.slice();p[d]+=Number(sign>0);p[(d+1)%3]+=a;p[(d+2)%3]+=b;
          return p.map((v,i)=>(planes[i][v]-.5)*s[i]*(i?-1:1));
        });
        for(const j of sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2])vertices.push(...corners[j]);
      }
    }
    const mesh=new THREE.BufferGeometry();mesh.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    mesh.computeVertexNormals();mesh.computeBoundingBox();return mesh;
  }
  // Mixed tangent prisms and cylinders are sensitive to the boolean kernel's
  // absolute Float32 tolerances. Try canonical metrics, verify actual material,
  // and return to the requested dimensions; never perturb hole sizes.
  const mixedProfiles=recon.bodyProfiles?.length&&recon.bodyComponents?.length;
  const finiteRoundGrooves=recon.bodyBoxes?.length&&recon.bodyComponents?.length&&features.some(f=>!f.profile&&f.axialRange);
  if(!mixedProfiles&&!finiteRoundGrooves)return buildUploadSolidAtScale(recon,features);
  const firstMetric=Math.max(...Object.values(recon.modelSize));
  // When all round surfaces run along depth, standardising depth leaves
  // every circular cross-section unchanged. Undo this affine transform on
  // the returned vertices and audit them in the original measured space.
  const depthPrismatic=finiteRoundGrooves&&!mixedProfiles&&!recon.bodyStadia?.length&&
    recon.bodyComponents.every(c=>c.axis==='y')&&features.every(f=>f.profile||f.role==='front');
  const trials=mixedProfiles?[[10,true],[1,true],[.1,true],[100,true]]:
    [[firstMetric,true],...(depthPrismatic?[[firstMetric,true,true]]:[]),[firstMetric,false],[10,true]];
  for(const [metric,combine,normalizeDepth] of trials) {
    const factor=metric/Math.max(recon.modelSize.x,recon.modelSize.y,recon.modelSize.z);
    const working={...recon,modelSize:Object.fromEntries(Object.entries(recon.modelSize).map(([k,v])=>[k,v*factor]))};
    if(normalizeDepth)working.modelSize.y=working.modelSize.x;
    const geometry=buildUploadSolidAtScale(working,features,combine);
    geometry.scale(1/factor,recon.modelSize.y/working.modelSize.y,1/factor);geometry.computeBoundingBox();
    const audit=checkConstructiveMesh({...recon,features},geometry,{samples:700});
    if(audit.status!=='mismatch'){geometry.userData.csgMetric=metric;return geometry;}
    geometry.dispose();
  }
  throw new Error('圆柱与有限孔槽的布尔网格材料校验未通过，请复核结构后重试。');
}

function buildUploadSolidAtScale(recon, features, combine) {
  const components=mergeCoaxialComponents(recon.bodyComponents||[]);
  const evaluator=new Evaluator();evaluator.attributes=['position'];evaluator.useGroups=false;
  // CDT prevents dense measured profiles from splitting into excessive faces.
  // New compounds combine cutters; ordinary inputs retain sequential cuts so
  // their trial-fit projections remain stable.
  evaluator.useCDTClipping=true;
  const combineCutters=combine??!!(recon.bodyProfiles?.length||features.some(f=>f.axialRange));
  const resources=new Set();let acc=null,cutters=null;
  const addCutter=brush=>{resources.add(brush.geometry);if(!combineCutters){acc=evaluator.evaluate(acc,brush,SUBTRACTION);resources.add(acc.geometry);acc.updateMatrixWorld();return;}cutters=cutters?evaluator.evaluate(cutters,brush,ADDITION):brush;resources.add(cutters.geometry);cutters.updateMatrixWorld();};
  try {
    if(recon.bodyRevolution) {
      const size=recon.modelSize,parts=[...components].sort((a,b)=>a.lo-b.lo),points=[new THREE.Vector2(0,(parts[0].lo-.5)*size.x)];
      for(const c of parts)points.push(new THREE.Vector2(c.r*size.x,(c.lo-.5)*size.x),new THREE.Vector2(c.r*size.x,(c.hi-.5)*size.x));
      points.push(new THREE.Vector2(0,(parts.at(-1).hi-.5)*size.x));
      const g=new THREE.LatheGeometry(points,192);g.rotateZ(-Math.PI/2);g.translate(0,(parts[0].y-.5)*size.y,(parts[0].z-.5)*size.z);
      acc=new Brush(g);acc.updateMatrixWorld();resources.add(g);
    }
    const stacked=new Set();
    if(!recon.bodyRevolution)for(const seed of components.filter(c=>!c.analyticOnly)) {
      if(stacked.has(seed))continue;
      const group=components.filter(c=>!c.analyticOnly&&c.axis===seed.axis&&['x','y','z'].every(a=>a===seed.axis||Math.abs(c[a]-seed[a])<1e-12));
      if(group.length<2)continue;
      const levels=[...new Set(group.flatMap(c=>[c.lo,c.hi]))].sort((a,b)=>a-b),bands=levels.slice(1).map((hi,i)=>({lo:levels[i],hi,r:Math.max(0,...group.filter(c=>c.lo<(levels[i]+hi)/2&&c.hi>(levels[i]+hi)/2).map(c=>c.r))}));
      if(bands.some(b=>!b.r))continue;
      // Build a stepped coaxial stack as ONE closed surface. Boolean union
      // of bodies that only touch on a cap can retain an internal disk; a
      // subsequent crossing bore turns that disk into an incorrect wall.
      const size=recon.modelSize,profile=[new THREE.Vector2(0,(bands[0].lo-.5)*size[seed.axis])];
      for(const b of bands)profile.push(new THREE.Vector2(b.r*size.x,(b.lo-.5)*size[seed.axis]),new THREE.Vector2(b.r*size.x,(b.hi-.5)*size[seed.axis]));
      profile.push(new THREE.Vector2(0,(bands.at(-1).hi-.5)*size[seed.axis]));
      const g=new THREE.LatheGeometry(profile,192);
      if(seed.axis==='z')g.rotateX(Math.PI/2);else if(seed.axis==='x')g.rotateZ(-Math.PI/2);
      g.translate(...['x','y','z'].map(a=>a===seed.axis?0:(seed[a]-.5)*size[a]));
      const brush=new Brush(g);brush.updateMatrixWorld();resources.add(g);acc=acc?evaluator.evaluate(acc,brush,ADDITION):brush;resources.add(acc.geometry);acc.updateMatrixWorld();
      group.forEach(c=>stacked.add(c));
    }
    for(const c of components.filter(c=>!c.analyticOnly&&!recon.bodyRevolution&&!stacked.has(c))) {
      const size=recon.modelSize,depth=size[c.axis]*(c.hi-c.lo),radius=c.r*size.x;
      const g=new THREE.CylinderGeometry(radius,radius,depth,192);
      if(c.axis==='z')g.rotateX(Math.PI/2);else if(c.axis==='x')g.rotateZ(Math.PI/2);
      const center={x:c.x,y:c.y,z:c.z};center[c.axis]=(c.lo+c.hi)/2;
      g.translate((center.x-.5)*size.x,(center.y-.5)*size.y,(center.z-.5)*size.z);
      const brush=new Brush(g);brush.updateMatrixWorld();resources.add(g);
      acc=acc?evaluator.evaluate(acc,brush,ADDITION):brush;resources.add(acc.geometry);acc.updateMatrixWorld();
    }
    for(const stadium of recon.bodyStadia||[]) {
      const size=recon.modelSize,r=stadium.r*size.x,x0=(stadium.l-.5)*size.x,x1=(stadium.rEnd-.5)*size.x,y=(.5-stadium.v)*size.y;
      const shape=new THREE.Shape();shape.moveTo(x0,y-r);shape.lineTo(x1,y-r);shape.absarc(x1,y,r,-Math.PI/2,Math.PI/2,false);shape.lineTo(x0,y+r);shape.absarc(x0,y,r,Math.PI/2,Math.PI*1.5,false);shape.closePath();
      const g=new THREE.ExtrudeGeometry(shape,{depth:size.z,bevelEnabled:false,curveSegments:96});g.translate(0,0,-size.z/2);
      const brush=new Brush(g);brush.updateMatrixWorld();resources.add(g);acc=acc?evaluator.evaluate(acc,brush,ADDITION):brush;resources.add(acc.geometry);acc.updateMatrixWorld();
    }
    for(const box of (recon.bodyBoxes||[]).filter(b=>!b.analyticOnly)) {
      const axes=['x','y','z'],size=recon.modelSize;
      const g=new THREE.BoxGeometry(...axes.map((a,i)=>(box.hi[i]-box.lo[i])*size[a]));
      g.translate(...axes.map((a,i)=>((box.lo[i]+box.hi[i])/2-.5)*size[a]));
      const brush=new Brush(g);brush.updateMatrixWorld();resources.add(g);
      acc=acc?evaluator.evaluate(acc,brush,ADDITION):brush;resources.add(acc.geometry);acc.updateMatrixWorld();
    }
    for(const body of recon.bodyProfiles||[]) {
      const size=recon.modelSize,front=body.role==='front',depth=front?size.y:size.z,height=front?size.z:size.y,shape=new THREE.Shape();body.points.forEach((p,i)=>i?shape.lineTo((p[0]-.5)*size.x,(.5-p[1])*height):shape.moveTo((p[0]-.5)*size.x,(.5-p[1])*height));shape.closePath();
      const g=new THREE.ExtrudeGeometry(shape,{depth:(body.hi-body.lo)*depth,bevelEnabled:false});
      if(front){g.rotateX(Math.PI/2);g.translate(0,(body.hi-.5)*depth,0);}else g.translate(0,0,(body.lo-.5)*depth);
      const brush=new Brush(g);brush.updateMatrixWorld();resources.add(g);acc=acc?evaluator.evaluate(acc,brush,ADDITION):brush;resources.add(acc.geometry);acc.updateMatrixWorld();
    }
    if(acc) {
      const size=recon.modelSize,box=new Brush(new THREE.BoxGeometry(size.x,size.y,size.z));box.updateMatrixWorld();resources.add(box.geometry);
      acc.geometry.computeBoundingBox();box.geometry.computeBoundingBox();
      if(!box.geometry.boundingBox.clone().expandByScalar(Math.max(size.x,size.y,size.z)*1e-7).containsBox(acc.geometry.boundingBox)){
        acc=evaluator.evaluate(acc,box,INTERSECTION);resources.add(acc.geometry);acc.updateMatrixWorld();
      }
    }
    // Build curved/profile constraints before rectangular envelopes. Cutting
    // a cylinder with its own tangent bounding box needlessly introduces CSG
    // slivers and unstable normals along an otherwise exact circular rim.
    const roles=['front','top','side'].sort((a,b)=>Number(recon.drawing?.[a]?.type==='rectangle')-Number(recon.drawing?.[b]?.type==='rectangle'));
    for(const role of roles) {
      if(recon.inferredRoles.includes(role)||recon.bodySourceRoles?.includes(role))continue;
      const next=silhouetteBrush(recon.silhouettes[role],role,recon.modelSize,recon.drawing?.[role]);resources.add(next.geometry);
      if(!acc)acc=next;else {
        acc.geometry.computeBoundingBox();
        const bounds=next.geometry.boundingBox,existing=acc.geometry.boundingBox;
        if(next.geometry.userData.envelope&&bounds.clone().expandByScalar(Math.max(recon.modelSize.x,recon.modelSize.y,recon.modelSize.z)*1e-7).containsBox(existing))continue;
        acc=evaluator.evaluate(acc,next,INTERSECTION);resources.add(acc.geometry);acc.updateMatrixWorld();
      }
    }
    const finiteCuts=features.filter(f=>f.axialRange&&['through','pocket'].includes(f.kind));
    for(const f of features.filter(f=>f.kind==='through'||f.kind==='pocket')) {
      const size=recon.modelSize, role=f.role;
      const padding=Math.max(size.x,size.y,size.z)*1e-4;
      // Different cutters ending at the same measured shoulder must share
      // that face. Independent overshoot creates a thin lip on the mesh.
      const endPadding=f.axialRange?.map(t=>{
        const shared=t>0&&t<1&&finiteCuts.some(g=>g!==f&&g.role===role&&g.axialRange.some(v=>Math.abs(t-v)<1e-10));
        return shared?0:padding*(f.profile ? .5 : 1);
      });
      if(f.profile) {
        const a=role==='side'?size.y:size.x,b=role==='top'?size.y:size.z;
        const rectangular=f.profile.length<=5&&f.profile.every((p,i)=>{const q=f.profile[(i+1)%f.profile.length];return Math.abs(p[0]-q[0])<1e-12||Math.abs(p[1]-q[1])<1e-12;});
        const shape=new THREE.Shape(),span=Math.max(size.x,size.y,size.z)/12;
        f.profile.forEach((p,i)=>{
          const x=(p[0]-.5)*a,y=(.5-p[1])*b;
          if(!i){shape.moveTo(x,y);return;}
          const prev=f.profile[i-1],x0=(prev[0]-.5)*a,y0=(.5-prev[1])*b,n=rectangular?Math.max(1,Math.ceil(Math.hypot(x-x0,y-y0)/span)):1;
          for(let j=1;j<=n;j++)shape.lineTo(x0+(x-x0)*j/n,y0+(y-y0)*j/n);
        });shape.closePath();
        const depth=role==='top'?size.z:role==='front'?size.y:size.x;
        const extent=f.axialRange?depth*(f.axialRange[1]-f.axialRange[0]):f.kind==='through'?depth*1.2:depth*f.depth;
        // Split large wall triangles before boolean clipping. A single wall
        // spanning far above a stepped body can lose a whole clipped region
        // at a crossing bore, leaving an open shell rather than a solid.
        let hole;
        if(rectangular){
          // A rectangle has an exact box representation. Subdivide both wall
          // directions: long extrusion fans can lose clipped wall triangles
          // where a round bore joins a shallow slot.
          const xs=f.profile.map(p=>(p[0]-.5)*a),ys=f.profile.map(p=>(.5-p[1])*b),x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys),length=extent+(endPadding?endPadding[0]+endPadding[1]:padding);
          hole=new THREE.BoxGeometry(x1-x0,y1-y0,length,Math.max(1,Math.ceil((x1-x0)/span)),Math.max(1,Math.ceil((y1-y0)/span)),8);
          hole.translate((x0+x1)/2,(y0+y1)/2,length/2);
        }else hole=new THREE.ExtrudeGeometry(shape,{depth:extent+(endPadding?endPadding[0]+endPadding[1]:0),steps:1,bevelEnabled:false});
        const p=hole.attributes.position;
        for(let i=0;i<p.count;i++) {
          const u=p.getX(i),v=p.getY(i),d=p.getZ(i);
          if(role==='top')p.setXYZ(i,u,v,size.z/2-extent+d);
          else if(role==='front')p.setXYZ(i,u,-size.y/2+extent-d,v);
          else p.setXYZ(i,-size.x/2+extent-d,-u,v);
          if(f.axialRange){
            const axis=role==='top'?2:role==='front'?1:0;
            // Front/side extrusions reverse their depth direction to preserve
            // triangle winding. Replacing it with +d turns the cutter inside
            // out and can leave a cap across an otherwise open slot.
            const at=role==='top'?(f.axialRange[0]-.5)*depth+d-endPadding[0]:(f.axialRange[1]-.5)*depth-d+endPadding[1];
            p.setComponent(i,axis,at);
          }
        }
        hole.computeVertexNormals();const brush=new Brush(hole);brush.updateMatrixWorld();addCutter(brush);continue;
      }
      const radius=f.r*(role==='side'?size.y:size.x);
      const depth=role==='top'?size.z:role==='front'?size.y:size.x;
      const extent=f.axialRange?depth*(f.axialRange[1]-f.axialRange[0])+endPadding[0]+endPadding[1]:f.kind==='through'?Math.max(size.x,size.y,size.z)*2:depth*(f.depth||.4)+padding;
      const hole=new THREE.CylinderGeometry(radius,radius,extent,192);
      if(role==='top') {hole.rotateX(Math.PI/2);hole.translate((f.u-.5)*size.x,(.5-f.v)*size.y,0);}
      else if(role==='front')hole.translate((f.u-.5)*size.x,0,(.5-f.v)*size.z);
      else {hole.rotateZ(Math.PI/2);hole.translate(0,(.5-f.u)*size.y,(.5-f.v)*size.z);}
      if(f.axialRange){const axis=role==='top'?'z':role==='front'?'y':'x';hole.translate(...['x','y','z'].map(a=>a===axis?((f.axialRange[0]+f.axialRange[1])/2-.5)*size[a]+(endPadding[1]-endPadding[0])/2:0));}
      if(f.kind==='pocket') {
        if(role==='top')hole.translate(0,0,depth/2-extent/2+padding);
        else if(role==='front')hole.translate(0,-depth/2+extent/2-padding,0);
        else hole.translate(-depth/2+extent/2-padding,0,0);
      }
      const brush=new Brush(hole);brush.updateMatrixWorld();addCutter(brush);
    }
    if(cutters){acc=evaluator.evaluate(acc,cutters,SUBTRACTION);resources.add(acc.geometry);acc.updateMatrixWorld();}
    // Three's normal helper hashes coordinates at an absolute .01-unit scale.
    // Work at a stable scale so small uploaded solids retain their fine details.
    const scaled=acc.geometry.clone(),factor=1000/Math.max(recon.modelSize.x,recon.modelSize.y,recon.modelSize.z);
    scaled.scale(factor,factor,factor);
    const result=toCreasedNormals(scaled,Math.PI/5);if(result!==scaled)scaled.dispose();result.scale(1/factor,1/factor,1/factor);result.computeBoundingBox();
    if(!result.attributes.position.count)throw new Error('轮廓交集为空，请检查三幅图的对齐位置');
    return result;
  } finally {for(const geometry of resources)geometry.dispose();}
}

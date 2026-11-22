// Exact axis-aligned surfaces for a measured constructive solid. These curves
// are independent of the CSG triangulation: boolean seams are surface/surface
// intersections, and visibility is tested against intervals inside the solid.
import {gridProjection} from './upload-rectilinear.js';
export function supportsConstructiveProjection(recon) {
 return !!(recon.bodyComponents?.length||recon.bodyBoxes?.length)&&recon.features.every(f=>!['through','pocket'].includes(f.kind)||f.stadium&&f.kind==='through'||(!f.profile?f.kind==='through':f.profile.length>=3));
}

export function projectConstructiveSolid(recon) {
 if(recon.orthogonalGrid&&!recon.features.length)return gridProjection(recon.orthogonalGrid,recon.modelSize);
 const features=recon.features.flatMap(f=>{if(!f.stadium)return [f];const c=f.stadium;return [...[c.l,c.r].map(u=>({role:f.role,u,v:c.v,r:c.rx,kind:'through'})),{role:f.role,kind:'through',profile:[[c.l,c.v-c.ry],[c.r,c.v-c.ry],[c.r,c.v+c.ry],[c.l,c.v+c.ry]]}];});
 recon={...recon,features};
 const s=recon.modelSize,axes=['x','y','z'],ext=axes.map(a=>s[a]),eps=Math.max(...ext)*2e-4;
 // Finite cutter ends need exact support/visibility tests: a fixed probe can
 // jump across the positive layer at a tangent mouth. Keep the established
 // raster-tolerance path for polygon prisms and full-depth cuts: their
 // coincident-face sectors are not handled by the round/box predicate below.
 const bodies=recon.bodyComponents.map((c,i)=>({id:`body:${i}`,axis:axes.indexOf(c.axis),center:[(c.x-.5)*s.x,(c.y-.5)*s.y,(c.z-.5)*s.z],r:c.r*s.x,lo:(c.lo-.5)*s[c.axis],hi:(c.hi-.5)*s[c.axis]}));
 for(const c of bodies)c.center[c.axis]=0;
 const cuts=recon.features.map((f,i)=>({...f,featureIndex:i})).filter(f=>!f.profile&&f.kind==='through').map(f=>{const axis=f.role==='top'?2:f.role==='front'?1:0;return {id:`cut:${f.featureIndex}`,axis,center:f.role==='top'?[(f.u-.5)*s.x,(.5-f.v)*s.y,0]:f.role==='front'?[(f.u-.5)*s.x,0,(.5-f.v)*s.z]:[0,(.5-f.u)*s.y,(.5-f.v)*s.z],r:f.r*(f.role==='side'?s.y:s.x),lo:f.axialRange?(f.axialRange[0]-.5)*ext[axis]:-Infinity,hi:f.axialRange?(f.axialRange[1]-.5)*ext[axis]:Infinity};});
 const rectangular=f=>f.profile.every((p,k)=>[0,1].some(i=>Math.abs(p[i]-f.profile[(k+1)%f.profile.length][i])<1e-8))&&f.profile.every(p=>[0,1].every(i=>Math.abs(p[i]-Math.min(...f.profile.map(q=>q[i])))<1e-8||Math.abs(p[i]-Math.max(...f.profile.map(q=>q[i])))<1e-8));
 const finiteCuts=features.some(f=>f.axialRange)&&!recon.bodyProfiles?.length&&features.every(f=>!f.profile||rectangular(f));
 const surfaceTolerance=finiteCuts?Math.max(...ext)*1e-9:eps;
 const boxes=recon.features.filter(f=>f.profile&&['pocket','through'].includes(f.kind)&&rectangular(f)).map(f=>{
  const u=[Math.min(...f.profile.map(p=>p[0]))-.5,Math.max(...f.profile.map(p=>p[0]))-.5],v=[.5-Math.max(...f.profile.map(p=>p[1])),.5-Math.min(...f.profile.map(p=>p[1]))];
  const box=f.role==='top'?{lo:[u[0]*s.x,v[0]*s.y,(f.kind==='through'?-.5:.5-f.depth)*s.z-eps],hi:[u[1]*s.x,v[1]*s.y,s.z/2+eps]}:f.role==='front'?{lo:[u[0]*s.x,-s.y/2-eps,v[0]*s.z],hi:[u[1]*s.x,s.y/2+eps,v[1]*s.z]}:{lo:[-s.x/2-eps,-u[1]*s.y,v[0]*s.z],hi:[s.x/2+eps,-u[0]*s.y,v[1]*s.z]};
  const axis=f.role==='top'?2:f.role==='front'?1:0;
  if(f.kind==='pocket'&&f.role!=='top')box.hi[axis]=(-.5+f.depth)*ext[axis]+eps;
  if(f.axialRange){box.lo[axis]=(f.axialRange[0]-.5)*ext[axis]-eps;box.hi[axis]=(f.axialRange[1]-.5)*ext[axis]+eps;}return box;
 });
 // Oblique sections and polygonal slots are finite prisms. Their slanted
 // walls must participate in surface intersections, material and occlusion;
 // replacing the profile by its rectangle invents both material and edges.
 const polygonCuts=recon.features.filter(f=>f.profile&&['pocket','through'].includes(f.kind)&&!rectangular(f)).map(f=>{
  const axis=f.role==='top'?2:f.role==='front'?1:0,ab=[0,1,2].filter(i=>i!==axis);
  const points=f.profile.map(([u,v])=>f.role==='top'?[(u-.5)*s.x,(.5-v)*s.y]:f.role==='front'?[(u-.5)*s.x,(.5-v)*s.z]:[(.5-u)*s.y,(.5-v)*s.z]);
  const range=f.axialRange||(f.kind==='through'?[0,1]:f.role==='top'?[1-f.depth,1]:[0,f.depth]);
  return {axis,ab,points,lo:(range[0]-.5)*ext[axis],hi:(range[1]-.5)*ext[axis]};
 });
 const positiveBoxes=(recon.bodyBoxes||[]).filter(b=>!b.meshOnly).map(b=>({lo:b.lo.map((v,i)=>(v-.5)*ext[i]),hi:b.hi.map((v,i)=>(v-.5)*ext[i])}));
 const profiles=(recon.bodyProfiles||[]).filter(b=>!b.meshOnly).map(b=>{const front=b.role==='front',axis=front?1:2;return {axis,ab:front?[0,2]:[0,1],lo:(b.lo-.5)*ext[axis],hi:(b.hi-.5)*ext[axis],points:b.points.map(p=>[(p[0]-.5)*s.x,(.5-p[1])*(front?s.z:s.y)])};});
 const inProfile=(p,b)=>{let hit=false;for(let i=0,j=b.points.length-1;i<b.points.length;j=i++){const a=b.points[i],c=b.points[j];if((a[1]>p[1])!==(c[1]>p[1])&&p[0]<(c[0]-a[0])*(p[1]-a[1])/(c[1]-a[1])+a[0])hit=!hit;}return hit;};
 const insideCylinder=(p,c)=>p.reduce((v,x,i)=>v+(i===c.axis?0:(x-c.center[i])**2),0)<c.r**2;
 // Open primitive interiors omit their common cap. That cap is interior to
 // the union wherever material continues on both sides, including unequal
 // or offset cylinders. Silhouette probes can lie exactly in this plane;
 // treating it as air invents hidden generators inside a stacked body.
 // Use numerical equality here, never the drawing/curve tolerance: a real
 // axial gap must stay open even when it is smaller than a raster pixel.
 const touchingCaps=cs=>cs.flatMap((a,i)=>cs.slice(i+1).flatMap(b=>a.axis!==b.axis?[]:
  [a.hi-b.lo,b.hi-a.lo].flatMap((gap,j)=>Math.abs(gap)<1e-12?[{a,b,value:j?b.hi:a.hi}]:[])));
 const bodyCaps=touchingCaps(bodies),cutCaps=touchingCaps(cuts);
 const inJoinedCap=(p,caps)=>caps.some(({a,b,value})=>Math.abs(p[a.axis]-value)<1e-12&&insideCylinder(p,a)&&insideCylinder(p,b));
 const insideBox=(p,b)=>p.every((x,i)=>x>b.lo[i]&&x<b.hi[i]);
 const inside=p=>p.every((x,i)=>Math.abs(x)<ext[i]/2+eps*.01)&&(bodies.some(c=>p[c.axis]>c.lo&&p[c.axis]<c.hi&&insideCylinder(p,c))||inJoinedCap(p,bodyCaps)||positiveBoxes.some(b=>insideBox(p,b))||profiles.some(b=>p[b.axis]>b.lo&&p[b.axis]<b.hi&&inProfile(b.ab.map(i=>p[i]),b)))&&!(cuts.some(c=>p[c.axis]>c.lo&&p[c.axis]<c.hi&&insideCylinder(p,c))||inJoinedCap(p,cutCaps))&&!boxes.some(b=>insideBox(p,b))&&!polygonCuts.some(b=>p[b.axis]>b.lo&&p[b.axis]<b.hi&&inProfile(b.ab.map(i=>p[i]),b));
 const cylinders=[...bodies,...cuts],planes=[],numericTolerance=Math.max(...ext)*1e-9;
 const plane=(axis,value,test=()=>true)=>{let p=planes.find(p=>p.axis===axis&&Math.abs(p.value-value)<surfaceTolerance);if(!p){p={axis,value,tests:[]};planes.push(p);}p.tests.push(test);};
 ext.forEach((e,i)=>{plane(i,-e/2);plane(i,e/2);});
 bodies.forEach(c=>{const test=p=>p.reduce((v,x,i)=>v+(i===c.axis?0:(x-c.center[i])**2),0)<(c.r+surfaceTolerance)**2;plane(c.axis,c.lo,test);plane(c.axis,c.hi,test);});
 cuts.filter(c=>Number.isFinite(c.lo)&&Number.isFinite(c.hi)).forEach(c=>{const test=p=>insideCylinder(p,{...c,r:c.r+surfaceTolerance});plane(c.axis,c.lo,test);plane(c.axis,c.hi,test);});
 [...boxes,...positiveBoxes].forEach(b=>b.lo.forEach((v,i)=>{const test=p=>p.every((x,j)=>i===j||x>=b.lo[j]-eps&&x<=b.hi[j]+eps);plane(i,v,test);plane(i,b.hi[i],test);}));
 const walls=[];
 for(const b of [...polygonCuts,...profiles]) {
  const cap=p=>inProfile(b.ab.map(i=>p[i]),b)||b.points.some((a,i)=>{const q=b.points[(i+1)%b.points.length],u=b.ab.map(j=>p[j]),dx=q[0]-a[0],dy=q[1]-a[1],t=Math.max(0,Math.min(1,((u[0]-a[0])*dx+(u[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(u[0]-a[0]-t*dx,u[1]-a[1]-t*dy)<eps;});
  plane(b.axis,b.lo,cap);plane(b.axis,b.hi,cap);
  for(let i=0;i<b.points.length;i++) {
   const a=b.points[i],q=b.points[(i+1)%b.points.length],dx=q[0]-a[0],dy=q[1]-a[1],len=Math.hypot(dx,dy);if(len<eps)continue;
   const n=[0,0,0];n[b.ab[0]]=-dy/len;n[b.ab[1]]=dx/len;
   const value=n[b.ab[0]]*a[0]+n[b.ab[1]]*a[1];
   walls.push({n,value,test:p=>p[b.axis]>=b.lo-eps&&p[b.axis]<=b.hi+eps&&((p[b.ab[0]]-a[0])*dx+(p[b.ab[1]]-a[1])*dy)>=-eps*len&&((p[b.ab[0]]-q[0])*dx+(p[b.ab[1]]-q[1])*dy)<=eps*len});
  }
 }

 const normal=(c,p)=>p.map((x,i)=>i===c.axis?0:(x-c.center[i])/c.r),unit=i=>axes.map((_,j)=>i===j?1:0);
 const onCylinder=(p,c)=>p[c.axis]>=c.lo-surfaceTolerance&&p[c.axis]<=c.hi+surfaceTolerance;
 const curves=[],add=(points,normals,accept=()=>true,construction,surfaces)=>curves.push({points,normals,accept,construction,surfaces});
 const sample=fn=>Object.assign(Array.from({length:257},(_,i)=>fn(i/256)),{atParameter:fn});
 // Cylinder / plane circles or generators.
 for(const c of cylinders)for(const p of planes) {
  const ab=[0,1,2].filter(i=>i!==c.axis);
  const surfaces=[c.id,`plane:${axes[p.axis]}:${p.value}`];
  if(p.axis===c.axis)add(sample(t=>{const q=[...c.center];q[c.axis]=p.value;q[ab[0]]+=c.r*Math.cos(t*Math.PI*2);q[ab[1]]+=c.r*Math.sin(t*Math.PI*2);return q;}),q=>[normal(c,q),unit(p.axis)],q=>onCylinder(q,c)&&p.tests.some(test=>test(q)),undefined,surfaces);
  else {const other=ab.find(i=>i!==p.axis),offset=Math.abs(p.value-c.center[p.axis]),d=c.r**2-offset**2;if(d<=eps**2||Math.abs(c.r-offset)<eps)continue;for(const sign of [-1,1])add(sample(t=>{const q=[...c.center];q[p.axis]=p.value;q[other]+=sign*Math.sqrt(d);q[c.axis]=(t-.5)*ext[c.axis];return q;}),q=>[normal(c,q),unit(p.axis)],q=>onCylinder(q,c)&&p.tests.some(test=>test(q)),undefined,surfaces);}
 }
 // Perpendicular cylinders share one radial coordinate. Solve the two
 // circle equations at that coordinate, rather than fitting a polyline.
 for(let i=0;i<cylinders.length;i++)for(const b of cylinders.slice(i+1)) {
  const a=cylinders[i];
  if(a.axis===b.axis) {
   // Offset parallel cylinders meet along straight generators. These edges
   // are absent from perpendicular-cylinder intersections and silhouettes;
   // they also occur where two overlapping bores form a compound cavity.
   const ab=[0,1,2].filter(k=>k!==a.axis),delta=ab.map(k=>b.center[k]-a.center[k]),distance=Math.hypot(...delta);
   const low=Math.max(a.lo,b.lo,-ext[a.axis]/2),high=Math.min(a.hi,b.hi,ext[a.axis]/2);
   if(distance<=numericTolerance||distance>=a.r+b.r-numericTolerance||distance<=Math.abs(a.r-b.r)+numericTolerance||high<=low)continue;
   const along=(a.r*a.r-b.r*b.r+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a.r*a.r-along*along));
   for(const sign of [-1,1])add(sample(t=>{
    const p=[...a.center];p[ab[0]]+=(along*delta[0]-sign*height*delta[1])/distance;p[ab[1]]+=(along*delta[1]+sign*height*delta[0])/distance;p[a.axis]=low+(high-low)*t;return p;
   }),p=>[normal(a,p),normal(b,p)],p=>onCylinder(p,a)&&onCylinder(p,b),'parallel-generators',[a.id,b.id]);
   continue;
  }
  const k=[0,1,2].find(k=>k!==a.axis&&k!==b.axis),lo=Math.max(a.center[k]-a.r,b.center[k]-b.r),hi=Math.min(a.center[k]+a.r,b.center[k]+b.r);if(hi<=lo)continue;
  for(const sa of [-1,1])for(const sb of [-1,1])add(sample(t=>{const q=[0,0,0];q[k]=lo+(hi-lo)*(.5-.5*Math.cos(t*Math.PI));q[b.axis]=a.center[b.axis]+sa*Math.sqrt(Math.max(0,a.r**2-(q[k]-a.center[k])**2));q[a.axis]=b.center[a.axis]+sb*Math.sqrt(Math.max(0,b.r**2-(q[k]-b.center[k])**2));return q;}),q=>[normal(a,q),normal(b,q)],q=>onCylinder(q,a)&&onCylinder(q,b),'auxiliary-plane',[a.id,b.id]);
 }
 for(let i=0;i<planes.length;i++)for(const b of planes.slice(i+1)) {
  const a=planes[i];if(a.axis===b.axis)continue;const k=[0,1,2].find(k=>k!==a.axis&&k!==b.axis);
  add(sample(t=>{const q=[0,0,0];q[a.axis]=a.value;q[b.axis]=b.value;q[k]=(t-.5)*ext[k];return q;}),()=>[unit(a.axis),unit(b.axis)],q=>a.tests.some(test=>test(q))&&b.tests.some(test=>test(q)));
 }
 // Planar profile walls meet cylinders in exact circles/generators. Sampling
 // these surfaces avoids treating triangulation seams as drawing edges.
 for(const w of walls)for(const c of cylinders){
  const ab=[0,1,2].filter(i=>i!==c.axis),dot=w.n.reduce((v,n,i)=>v+n*c.center[i],0);
  if(Math.abs(w.n[c.axis])>1e-9)add(sample(t=>{const q=[...c.center];q[ab[0]]+=c.r*Math.cos(t*2*Math.PI);q[ab[1]]+=c.r*Math.sin(t*2*Math.PI);q[c.axis]=(w.value-w.n.reduce((v,n,i)=>v+(i===c.axis?0:n*q[i]),0))/w.n[c.axis];return q;}),q=>[normal(c,q),w.n],q=>onCylinder(q,c)&&w.test(q),'section-generators');
  else {const norm=Math.hypot(w.n[ab[0]],w.n[ab[1]]),d=(w.value-dot)/norm;if(Math.abs(d)>=c.r)continue;const h=Math.sqrt(c.r*c.r-d*d);for(const sign of [-1,1])add(sample(t=>{const q=[...c.center];q[ab[0]]+=(w.n[ab[0]]*d-sign*w.n[ab[1]]*h)/norm;q[ab[1]]+=(w.n[ab[1]]*d+sign*w.n[ab[0]]*h)/norm;q[c.axis]=(t-.5)*ext[c.axis];return q;}),q=>[normal(c,q),w.n],q=>onCylinder(q,c)&&w.test(q));}
 }
 const dot=(a,b)=>a.reduce((v,x,i)=>v+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const flat=planes.map(p=>({n:unit(p.axis),value:p.value,test:q=>p.tests.some(t=>t(q))}));
 for(let i=0;i<walls.length;i++)for(const b of [...flat,...walls.slice(i+1)]){const a=walls[i],dir=cross(a.n,b.n),den=dot(dir,dir);if(den<1e-12)continue;const ba=cross(b.n,dir),db=cross(dir,a.n),origin=ba.map((v,k)=>(v*a.value+db[k]*b.value)/den),length=Math.max(...ext)*3/Math.sqrt(den);add(sample(t=>origin.map((v,k)=>v+(t-.5)*length*dir[k])),()=>[a.n,b.n],p=>a.test(p)&&b.test(p));}
 const views={front:{axis:1,sign:-1,to:p=>[p[0]/s.x+.5,.5-p[2]/s.z]},top:{axis:2,sign:1,to:p=>[p[0]/s.x+.5,.5-p[1]/s.y]},side:{axis:0,sign:-1,to:p=>[.5-p[1]/s.y,.5-p[2]/s.z]}},out={};
 // Evaluate the infinitesimal material sector at an exact intersection.
 // A fixed displacement crosses nearby surfaces in thin/tangent regions.
 // For round and rectangular primitives the signs of the directional
 // derivatives determine membership without making such a displacement.
 const directionalInside=(p,d)=>{
  const tolerance=numericTolerance*.01;
  const less=(value,limit,derivative,second=0)=>Math.abs(value-limit)>tolerance?value<limit:Math.abs(derivative)>tolerance?derivative<0:second<0;
  const range=(value,lo,hi,derivative)=>less(lo,value,-derivative)&&less(value,hi,derivative);
  const radial=c=>less(p.reduce((v,x,i)=>v+(i===c.axis?0:(x-c.center[i])**2),0),c.r**2,p.reduce((v,x,i)=>v+(i===c.axis?0:2*(x-c.center[i])*d[i]),0),d.reduce((v,x,i)=>v+(i===c.axis?0:x*x),0));
  const cylinder=c=>range(p[c.axis],c.lo,c.hi,d[c.axis])&&radial(c);
  const joined=caps=>caps.some(({a,b,value})=>Math.abs(p[a.axis]-value)<tolerance&&Math.abs(d[a.axis])<tolerance&&radial(a)&&radial(b));
  const box=b=>p.every((x,i)=>range(x,b.lo[i],b.hi[i],d[i]));
  return p.every((x,i)=>range(x,-ext[i]/2,ext[i]/2,d[i]))&&(bodies.some(cylinder)||joined(bodyCaps)||positiveBoxes.some(box))&&!(cuts.some(cylinder)||joined(cutCaps))&&!boxes.some(box);
 };
 const boundary=(p,ns,crossingBores=false)=>{
  // A cylinder's tangent generator on the bottom envelope is internal when
  // a base joins it on both sides. Test the material immediately above that
  // envelope; open-box predicates alone incorrectly expose a hidden seam.
  if(ns.length===1&&Math.abs(p[2]+ext[2]/2)<numericTolerance&&Math.abs(ns[0][2])<1e-8) {
   const above=[...p];above[2]+=eps*.001;
   if([-1,1].every(sign=>inside(above.map((v,i)=>v+sign*eps*ns[0][i]))))return false;
  }
  if(ns.length>1){const a=ns[0],b=ns.at(-1),den=Math.hypot(...a)*Math.hypot(...b);if(den&&Math.abs(dot(a,b))/den>1-1e-8)return false;}
  // A real boolean edge has both material and air in its normal section.
  const states=[];
  const finiteCap=finiteCuts&&cylinders.some(c=>[c.lo,c.hi].some(t=>Number.isFinite(t)&&Math.abs(t)<ext[c.axis]/2-numericTolerance&&Math.abs(p[c.axis]-t)<numericTolerance));
  // At a nearly tangent envelope clip, a fixed normal probe can cross both
  // sides of the thin material wedge. It then rejects the real bottom edge
  // and leaves only the bore's central arc. Use infinitesimal solid sectors
  // on these measured bounding planes, just as for finite cylinder caps.
  const envelopeClip=ns.length>1&&Math.abs(dot(ns[0],ns.at(-1)))>.95*Math.hypot(...ns[0])*Math.hypot(...ns.at(-1))&&Math.abs(p[2]+ext[2]/2)<numericTolerance;
  for(const a of [-1,1])for(const b of [-1,1]) {
   const d=ns[0].map((v,i)=>a*v+b*ns.at(-1)[i]);
   // A thin web can meet a cylinder tangentially. The material wedge tends
   // to zero at the join; a raster-sized probe erases the last millimetres
   // of its end edge. Polygon sectors need a geometric (subpixel) probe.
   const displacement=profiles.length||polygonCuts.length?eps*.001:eps;
   // At a crossing of two bores a finite probe may reach *across* an
   // adjacent slot wall. That would draw part of the removed branch.
   states.push(!profiles.length&&!polygonCuts.length&&(finiteCuts&&(finiteCap||crossingBores)||envelopeClip)?directionalInside(p,d):inside(p.map((x,i)=>x+displacement*d[i])));
  }
  const count=states.filter(Boolean).length;
  return ns.length===1?count>0&&count<4:count===1||count===3;
 };
 const hidden=(p,view)=>{
  const rayTolerance=finiteCuts?numericTolerance*4:eps;
  const a=view.axis,events=[p[a]+view.sign*rayTolerance,view.sign*ext[a]];
  for(const plane of planes)if(plane.axis===a)events.push(plane.value);
  for(const wall of walls)if(Math.abs(wall.n[a])>1e-9)events.push((wall.value-wall.n.reduce((v,n,i)=>v+(i===a?0:n*p[i]),0))/wall.n[a]);
  for(const c of cylinders)if(c.axis!==a){const k=[0,1,2].find(i=>i!==a&&i!==c.axis),d=c.r**2-(p[k]-c.center[k])**2;if(d>=0){const root=d<Math.max(numericTolerance**2,Number.EPSILON*16*c.r**2)?0:Math.sqrt(d);events.push(c.center[a]-root,c.center[a]+root);}}
  const ts=events.filter(t=>(t-p[a])*view.sign>rayTolerance*.75).sort((a,b)=>a-b);
  for(let i=1;i<ts.length;i++){
   const q=[...p];q[a]=(ts[i-1]+ts[i])/2;
   if(inside(q))return true;
   // Strict open-solid tests leave a zero-thickness gap on shared caps.
   // A ray travelling along that actual planar face is still occluded by
   // its material side. Probe only a coincident plane normal, not arbitrary
   // directions near a curved silhouette or beyond a finite cap.
   if(planes.some(plane=>plane.axis!==a&&Math.abs(q[plane.axis]-plane.value)<eps*.001&&plane.tests.some(test=>test(q))&&[-1,1].some(sign=>inside(q.map((v,k)=>v+(k===plane.axis?sign*eps*.01:0))))))return true;
   if(profiles.length&&axes.some((_,j)=>[-1,1].some(sign=>inside(q.map((v,k)=>v+(j===k?sign*eps*.01:0))))))return true;
  }
  return false;
 };
 for(const [role,view] of Object.entries(views)) {
  const candidates=[...curves];
  for(const c of cylinders)if(c.axis!==view.axis){const k=[0,1,2].find(i=>i!==c.axis&&i!==view.axis);for(const sign of [-1,1])candidates.push({points:sample(t=>{const q=[...c.center];q[k]+=sign*c.r;q[c.axis]=(t-.5)*ext[c.axis];return q;}),normals:q=>[normal(c,q)],accept:q=>onCylinder(q,c),surfaces:[c.id]});}
  const lines=[];
  for(const curve of candidates) {
   // Visibility priority applies to one projected support, not to unrelated
   // curves which merely pass within a pixel near a tangent point.
   const circle=cylinders.find(c=>c.axis===view.axis&&curve.surfaces?.includes(c.id));
   let support;
   if(circle) {
    const center=view.to(circle.center),dimensions=role==='front'?[s.x,s.z]:role==='top'?[s.x,s.y]:[s.y,s.z];
    support=['circle',...center,circle.r/dimensions[0],circle.r/dimensions[1]];
   } else {
    const points=curve.points.map(view.to),a=points[0],b=points.toSorted((p,q)=>Math.hypot(q[0]-a[0],q[1]-a[1])-Math.hypot(p[0]-a[0],p[1]-a[1]))[0],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
    if(len>1e-9&&points.every(p=>Math.abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)<len*1e-9)) {
     let nx=dy/len,ny=-dx/len;if(nx< -1e-9||Math.abs(nx)<1e-9&&ny<0){nx=-nx;ny=-ny;}
     support=['line',nx,ny,nx*a[0]+ny*a[1]];
    }
   }
   const crossingBores=curve.construction==='auxiliary-plane'&&curve.surfaces?.every(id=>id.startsWith('cut:'));
   const state=t=>{const p=curve.points.atParameter(t);return (!curve.accept||curve.accept(p))&&boundary(p,curve.normals(p),crossingBores);};
   for(let i=1;i<curve.points.length;i++) {
   let lo=(i-1)/256,hi=i/256;
   let mid=(lo+hi)/2;
   if(!state(mid)){
    // A short remainder of a finite face can occupy less than half a
    // sample at a shoulder. Its endpoint still brackets the true edge.
    if(!finiteCuts)continue;
    if(state(lo))mid=lo;
    else if(state(hi))mid=hi;
    else continue;
   }
   // A sampled midpoint can lie on the edge while either endpoint is already
   // outside a finite face. Trim to the actual boundary instead of drawing
   // one full sample past the shoulder or through the bottom of the solid.
   const trim=(a,b)=>{for(let k=0;k<12;k++){const t=(a+b)/2;if(state(t))b=t;else a=t;}return b;};
   if(!state(lo))lo=trim(lo,mid);
   if(!state(hi))hi=trim(hi,mid);
   const p=curve.points.atParameter(lo),q=curve.points.atParameter(hi),m=curve.points.atParameter((lo+hi)/2),pa=view.to(p),pb=view.to(q);
   if(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])<1e-8)continue;
   const lt=hidden(m,view)?'h':'v';let outline=false;
   if(lt==='v') {
    const dx=pb[0]-pa[0],dy=pb[1]-pa[1],len=Math.hypot(dx,dy),u=-dy/len*.001,v=dx/len*.001;
    const probes=[-1,1].map(sign=>{
     const at=[...m];if(role==='front'){at[0]+=sign*u*s.x;at[2]-=sign*v*s.z;}else if(role==='top'){at[0]+=sign*u*s.x;at[1]-=sign*v*s.y;}else{at[1]-=sign*u*s.y;at[2]-=sign*v*s.z;}
     at[view.axis]=-view.sign*ext[view.axis];return hidden(at,view);
    });
    outline=probes[0]!==probes[1];
   }
   lines.push({p:[pa,pb],world:[p,q],lt,boundary:outline,construction:curve.construction,surfaces:curve.surfaces,projectionSupport:support});
   }
  }
  // Different surface intersections can trace the same apparent circle with
  // different parameterizations. A visible rim has priority over a coincident
  // hidden rim, including between differently sampled points on that circle.
  const visible=lines.filter(l=>l.lt==='v');
  const distance=(p,l)=>{const [a,b]=l.p,dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
  const sameSupport=(a,b)=>a&&b&&a.length===b.length&&a[0]===b[0]&&a.slice(1).every((v,i)=>Math.abs(v-b[i+1])<1e-8);
  out[role]=lines.filter(l=>l.lt==='v'||!l.p.every(p=>visible.some(v=>distance(p,v)<(!finiteCuts||sameSupport(l.projectionSupport,v.projectionSupport)?.0006:1e-8))));
 }
 return out;
}

import * as THREE from 'three';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';

// Independent volume audit for round, box and polygon-prism constructions. Triangulated
// creases can look plausible while a bore is capped or an entire box survives.
// Compare actual ray parity in THREE orthogonal directions with solid-set
// membership; no rendered silhouette or percentage score supplies that truth.
export function checkConstructiveMesh(recon,geometry,{samples=360}={}) {
 const sweep=recon.parallelSections;
 if(!sweep&&!(recon.bodyComponents?.length||recon.bodyBoxes?.length)||recon.bodyStadia?.length||recon.features.some(f=>f.stadium||!['through','pocket','unknown'].includes(f.kind)))return {status:'not-applicable',tested:0,failures:[]};
 const s=recon.modelSize,axes=['x','y','z'],ext=axes.map(a=>s[a]),margin=Math.max(...ext)*.0015;
 const bodies=(recon.bodyComponents||[]).filter(c=>!c.analyticOnly).map(c=>({axis:axes.indexOf(c.axis),center:axes.map(a=>(c[a]-.5)*s[a]),r:c.r*s.x,lo:(c.lo-.5)*s[c.axis],hi:(c.hi-.5)*s[c.axis]}));
 const boxes=(recon.bodyBoxes||[]).filter(b=>!b.analyticOnly).map(b=>({lo:b.lo.map((v,i)=>(v-.5)*ext[i]),hi:b.hi.map((v,i)=>(v-.5)*ext[i])}));
 const cuts=recon.features.filter(f=>!f.profile&&['through','pocket'].includes(f.kind)).map(f=>{
  const axis={side:0,front:1,top:2}[f.role],center=f.role==='side'?[0,(.5-f.u)*s.y,(.5-f.v)*s.z]:f.role==='front'?[(f.u-.5)*s.x,0,(.5-f.v)*s.z]:[(f.u-.5)*s.x,(.5-f.v)*s.y,0];
  const range=f.axialRange||(f.kind==='pocket'?(f.role==='top'?[1-f.depth,1]:[0,f.depth]):[-Infinity,Infinity]);
  return {axis,center,r:f.r*(f.role==='side'?s.y:s.x),lo:(range[0]-.5)*ext[axis],hi:(range[1]-.5)*ext[axis]};
 });
 const prism=(role,points,range)=>{const axis={side:0,front:1,top:2}[role],ab=[0,1,2].filter(i=>i!==axis);return {axis,ab,lo:(range[0]-.5)*ext[axis],hi:(range[1]-.5)*ext[axis],points:points.map(([u,v])=>role==='side'?[(.5-u)*s.y,(.5-v)*s.z]:[(u-.5)*s.x,(.5-v)*(role==='front'?s.z:s.y)])};};
 const profiles=(recon.bodyProfiles||[]).filter(b=>!b.analyticOnly).map(b=>prism(b.role||'top',b.points,[b.lo,b.hi]));
 const polygonCuts=recon.features.filter(f=>f.profile&&['through','pocket'].includes(f.kind)).map(f=>prism(f.role,f.profile,f.axialRange||(f.kind==='through'?[0,1]:f.role==='top'?[1-f.depth,1]:[0,f.depth])));
 const inPolygon=(p,points)=>{let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};
 const inPrism=(p,b)=>p[b.axis]>b.lo&&p[b.axis]<b.hi&&inPolygon(b.ab.map(i=>p[i]),b.points);
 const sectionMaterial=p=>{
  const E={front:[0,2,1],top:[0,1,2],side:[1,2,0]}[sweep.end],q=E.map(k=>.5+(k?-1:1)*p[k]/ext[k]);
  const planes=sweep.planes?sweep.planes.map(([c,m])=>c+m*q[sweep.rad]):sweep.bands;
  const j=planes.findIndex(t=>t>q[2])-1;if(j<0)return false;
  let solid=false;
  for(const [i,r]of sweep.regions.entries()){
   const inside=r.points?inPolygon(q,r.points):Math.hypot((q[0]-r.center[0])/r.rad[0],(q[1]-r.center[1])/r.rad[1])<1;
   if(inside)solid=sweep.layers[j][i];
  }
  return solid;
 };
 const nearPrism=(p,b)=>Math.min(Math.abs(p[b.axis]-b.lo),Math.abs(p[b.axis]-b.hi))<margin||b.points.some((a,i)=>{const q=b.points[(i+1)%b.points.length],u=b.ab.map(j=>p[j]),dx=q[0]-a[0],dy=q[1]-a[1],t=Math.max(0,Math.min(1,((u[0]-a[0])*dx+(u[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(u[0]-a[0]-t*dx,u[1]-a[1]-t*dy)<margin;});
 const radial=(p,c)=>Math.hypot(...p.map((v,i)=>i===c.axis?0:v-c.center[i]));
 const inRound=(p,c)=>p[c.axis]>c.lo&&p[c.axis]<c.hi&&radial(p,c)<c.r;
 const inBox=(p,b)=>p.every((v,i)=>v>b.lo[i]&&v<b.hi[i]);
 if(!geometry.boundsTree)geometry.boundsTree=new MeshBVH(geometry);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.raycast=acceleratedRaycast;mesh.updateMatrixWorld();
 const caster=new THREE.Raycaster(),directions=[[1,0,0],[0,1,0],[0,0,1]],failures=[],perView={front:{tested:0,failed:0},side:{tested:0,failed:0},top:{tested:0,failed:0}};
 let tested=0;
 try {
 for(let j=1;j<=samples;j++) {
  const p=[(j*.61803398875)%1,(j*.41421356237)%1,(j*.73205080757)%1].map((v,i)=>(v-.5)*ext[i]);
  if([...bodies,...cuts].some(c=>Math.abs(radial(p,c)-c.r)<margin||Math.abs(p[c.axis]-c.lo)<margin||Math.abs(p[c.axis]-c.hi)<margin)||boxes.some(b=>p.some((v,i)=>Math.min(Math.abs(v-b.lo[i]),Math.abs(v-b.hi[i]))<margin))||[...profiles,...polygonCuts].some(b=>nearPrism(p,b)))continue;
  const expected=sweep?sectionMaterial(p):(bodies.some(c=>inRound(p,c))||boxes.some(b=>inBox(p,b))||profiles.some(b=>inPrism(p,b)))&&!cuts.some(c=>inRound(p,c))&&!polygonCuts.some(b=>inPrism(p,b));
  if(sweep&&axes.some((_,k)=>[-1,1].some(sign=>sectionMaterial(p.map((v,i)=>v+(i===k?sign*margin:0)))!==expected)))continue;
  for(const [axis,dir] of directions.entries()) {
   caster.set(new THREE.Vector3(...p),new THREE.Vector3(...dir));
   const hits=caster.intersectObject(mesh).map(h=>h.distance).filter((v,i,a)=>!i||v-a[i-1]>1e-7),actual=hits.length%2===1,role=['side','front','top'][axis];
   tested++;perView[role].tested++;
   if(actual!==expected){perView[role].failed++;if(failures.length<12)failures.push({point:p,role,expected,actual});}
  }
 }
 }finally{material.dispose();}
 return {status:tested>0&&!failures.length?'passed':'mismatch',tested,perView,failures};
}

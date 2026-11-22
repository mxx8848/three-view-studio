// The end view supplies closed boundaries; the elevation supplies their axial
// extent. All measurements are made BEFORE proposing material or projecting it.
import * as THREE from 'three';
import {circleFit} from './upload-lines.js';
import {MeshBVH,acceleratedRaycast} from 'three-mesh-bvh';
import {deduplicateProjection} from './upload-projection.js';
import {readWallDashes,restoreWallDashes} from './upload-dash-support.js';

const frames={front:[0,2,1],top:[0,1,2],side:[1,2,0]};
const median=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const span=(a,k)=>Math.max(...a.map(p=>p[k]))-Math.min(...a.map(p=>p[k]));
const clamp=x=>Math.max(0,Math.min(1,x));

// Vectorize straight ink in the elevation directly. Skeletons turn corners
// at T junctions, sometimes joining a thin dash to a thick shoulder. Measuring
// width perpendicular to each stroke keeps the two observations independent.
function axialInk(work){
 const {inkMask:m,sourceSize,sourceMap}=work;
 if(!m||!sourceMap||!sourceSize||work.paths.some(p=>p.manualType||p.colored))return;
 const {w,h}=sourceSize,n=[w,h],get=(k,t,a)=>k?m[t*w+a]:m[a*w+t];
 const dirs=[[],[]];
 for(const k of [0,1]){
  const strips=[];
  for(let t=0;t<n[k];t++){
   const runs=[];let lo;
   for(let a=0;a<=n[1-k];a++){
    if(a<n[1-k]&&get(k,t,a)){lo??=a;continue;}
    if(lo!==undefined){if(a-lo>=5)runs.push([lo,a-1]);lo=undefined;}
   }
   if(runs.length)strips.push({t,runs,score:runs.reduce((s,[l,h])=>s+h-l+1,0)});
  }
  // Adjacent scanlines need not describe the same shoulder: two separate
  // posts can terminate one pixel apart. Connect only overlapping ink runs.
  const parts=[],parents=[],root=i=>parents[i]===i?i:(parents[i]=root(parents[i]));
  let prev=[];
  for(const strip of strips){
   const next=[];
   for(const [l,h]of strip.runs){
    const id=parts.length;parents.push(id);parts.push({t:strip.t,l,h});next.push(id);
    for(const j of prev){const p=parts[j];if(p.t===strip.t-1&&l<=p.h&&h>=p.l)parents[root(j)]=id;}
   }
   prev=next;
  }
  const components=new Map();
  for(const [i,p]of parts.entries()){const id=root(i);if(!components.has(id))components.set(id,[]);components.get(id).push(p);}
  for(const strokes of components.values()){
   const rows=new Map();for(const {t,l,h}of strokes){if(!rows.has(t))rows.set(t,{t,runs:[],score:0});const row=rows.get(t);row.runs.push([l,h]);row.score+=h-l+1;}
   const group=[...rows.values()];if(group.length>8)return;
   const best=Math.max(...group.map(r=>r.score)),core=group.filter(r=>r.score>=best*.86);
   const t=(core[0].t+core.at(-1).t)/2,row=group.reduce((a,b)=>Math.abs(b.t-t)<Math.abs(a.t-t)?b:a);
   const runs=row.runs.map(([lo,hi])=>{
    const widths=[];for(let a=lo+1;a<hi;a++){
     let left=row.t,right=row.t;
     while(left>0&&row.t-left<8&&get(k,left-1,a))left--;
     while(right+1<n[k]&&right-row.t<8&&get(k,right+1,a))right++;
     widths.push(right-left+1);
    }
    return {lo,hi,width:median(widths),t};
   });
   dirs[k].push({t,runs});
  }
  const supports=[];
  for(const row of dirs[k].sort((a,b)=>a.t-b.t)){
   const last=supports.at(-1);
   if(last&&row.t-last.t<=1){last.runs.push(...row.runs);last.t=median(last.runs.map(r=>r.t));}
   else supports.push(row);
  }
  dirs[k]=supports;
 }
 if(dirs.some(rows=>rows.length<2||rows.length>52))return;
 const lo=dirs.map(rows=>rows[0].t),len=dirs.map((rows,k)=>rows.at(-1).t-lo[k]);
 if(Math.min(...len)<40)return;
 const [o,a,b]=sourceMap;
 const aligned=(k,v)=>(o[k]+v*((k?b:a)[k]-o[k]))*len[k];
 if([0,1].some(k=>Math.abs(aligned(k,lo[k]))>2.75||Math.abs(aligned(k,lo[k]+len[k])-len[k])>2.75||Math.abs((k?a:b)[k]-o[k])*len[k]*len[1-k]>2))return;
 const thick=median(dirs.flatMap(rows=>[...rows[0].runs,...rows.at(-1).runs]).filter(r=>r.hi-r.lo>8).map(r=>r.width));
 if(!thick)return;
 const paths=[],covered=new Uint8Array(w*h);
 for(const [k,rows]of dirs.entries())for(const row of rows){
  for(const r of row.runs){
   const repeated=row.runs.some(s=>s!==r&&Math.min(Math.abs(s.lo-r.hi),Math.abs(r.lo-s.hi))<16&&Math.max(r.hi-r.lo,s.hi-s.lo)<20);
   r.lt=r.width<=thick*.76||repeated&&r.width<thick&&r.hi-r.lo<16?'h':'v';
   const points=[r.lo,r.hi].map(v=>{const p=[];p[k]=clamp((r.t-lo[k])/len[k]);p[1-k]=clamp((v-lo[1-k])/len[1-k]);return p;});
   paths.push({id:paths.length,lt:r.lt,points,width:r.width,length:dist(...points),black:true,dashFragment:r.lt==='h'});
   for(let t=Math.max(0,Math.floor(r.t-thick/2-1));t<=Math.min(n[k]-1,Math.ceil(r.t+thick/2+1));t++)
    for(let v=r.lo;v<=r.hi;v++)covered[k?t*w+v:v*w+t]=1;
  }
 }
 // An oblique rib, a curved edge or an annotation must not silently disappear.
 let lost=0,total=0;for(let i=0;i<w*h;i++)if(m[i]){total++;if(!covered[i])lost++;}
 if(lost>Math.max(7,total*.007))return;
 // A centreline may cross an apparent hole wall. Keep its classification
 // unless a short isolated fragment sits on a train of equal measured dashes.
 for(const p of work.paths.filter(p=>p.lt==='c'||p.lt==='t')){
  const mid=p.points[Math.floor(p.points.length/2)],ax=[0,1].find(k=>span(p.points,k)*len[k]<1.6);
  if(ax===undefined||span(p.points,1-ax)*len[1-ax]>9)return;
  const support=dirs[ax].filter(g=>Math.abs(g.t-lo[ax]-mid[ax]*len[ax])<=thick).sort((a,b)=>Math.abs(a.t-lo[ax]-mid[ax]*len[ax])-Math.abs(b.t-lo[ax]-mid[ax]*len[ax]))[0];
  const alike=support?.runs.filter(r=>r.lt==='h'&&r.hi-r.lo>=4&&r.hi-r.lo<=12&&Math.min(Math.abs(r.lo-lo[1-ax]-mid[1-ax]*len[1-ax]),Math.abs(r.hi-lo[1-ax]-mid[1-ax]*len[1-ax]))<32);
  if(!alike||alike.length<2)return;
 }
 return {dirs,paths,lo,len,thick};
}

// Only accept actually closed, nearly circular loops. Four box corners (or
// a short arc extrapolated by a circle fit) are not evidence for a hole.
function boundaries(work){
 if(!work.sourceMap||work.paths.some(p=>p.manualType))return;
 const [o,a,b]=work.sourceMap,scale=[1/Math.hypot(a[0]-o[0],a[1]-o[1]),1/Math.hypot(b[0]-o[0],b[1]-o[1])];
 let polygon,roundBase;const rings=[];
 for(const p of work.paths.filter(p=>p.lt==='v'||p.lt==='h')){
  if(p.lt!=='v')return;
  const pts=p.points,px=pts.map(q=>q.map((v,k)=>v*scale[k]));
  if(pts.length<4||dist(px[0],px.at(-1))>2.75)return;
  const outside=[0,1].every(k=>span(pts,k)>.94);
  if(outside&&work.type!=='circle'){
   if(polygon||pts.length>26)return;
   polygon=pts.slice(0,-1).map(q=>q.map((v,k)=>v*scale[k]<3.5?0:(1-v)*scale[k]<3.5?1:clamp(v)));
   polygon=polygon.filter((v,i,all)=>dist(v,all[(i+1)%all.length])>1e-5);
   // Opposite chamfers measured within stroke uncertainty share a datum.
   // Otherwise their rear edge appears as a second, fictitious hidden edge.
   for(const k of [0,1]){
    const grouped=[];
    for(const p of [...polygon].sort((a,b)=>a[k]-b[k])){
     if(!grouped.length||(p[k]-grouped.at(-1)[0][k])*scale[k]>2.25)grouped.push([]);
     grouped.at(-1).push(p);
    }
    for(const g of grouped){const v=g.reduce((s,p)=>s+p[k],0)/g.length;for(const p of g)p[k]=v;}
   }
   if(polygon.length<3||polygon.length>16)return;
  }else{
   const f=circleFit(px.slice(0,-1),7);if(!f||f.r<4||f.error*f.r>1.2)return;
   const angles=px.slice(0,-1).map(p=>Math.atan2(p[1]-f.cy,p[0]-f.cx)).sort((a,b)=>a-b);
   if(angles.some((v,i)=>((angles[i+1]??angles[0]+2*Math.PI)-v)>.98))return;
   if(outside){
    if(roundBase||[0,1].some(k=>Math.abs((k?f.cy:f.cx)-scale[k]/2)>2||Math.abs(f.r-scale[k]/2)>2))return;
    roundBase={center:[.5,.5],rad:[.5,.5]};
   }else rings.push({center:[f.cx/scale[0],f.cy/scale[1]],rad:scale.map(s=>f.r/s)});
  }
 }
 if(!polygon&&!roundBase||!rings.length||rings.length>12)return;
 // Disjoint families of coaxial loops. Partial intersections need another
 // construction; they cannot be represented by a tree of nested regions.
 const groups=[];
 for(const r of rings.sort((a,b)=>b.rad[0]-a.rad[0])){
  let group=groups.find(g=>dist(g[0].center.map((v,k)=>v*scale[k]),r.center.map((v,k)=>v*scale[k]))<2);
  if(!group){group=[];groups.push(group);}
  group.push(r);
 }
 for(const group of groups){const center=[0,1].map(k=>median(group.map(r=>r.center[k])));for(const r of group)r.center=center;}
 // Convex outline: every point of each outer circle must lie on the inside
 // side of every polygon edge, with at least one source pixel of clearance.
 if(roundBase){
  if(groups.some(([r])=>Math.hypot(...r.center.map(v=>v-.5))+Math.max(...r.rad)>.496))return;
  return {root:roundBase,groups};
 }
 const area=polygon.reduce((s,p,i)=>{const q=polygon[(i+1)%polygon.length];return s+p[0]*q[1]-p[1]*q[0];},0);
 if(area<0)polygon.reverse();
 for(const [i,p]of polygon.entries()){
  const q=polygon[(i+1)%polygon.length],dx=(q[0]-p[0])*scale[0],dy=(q[1]-p[1])*scale[1],d=Math.hypot(dx,dy);
  for(const z of polygon)if(dx*(z[1]-p[1])*scale[1]-dy*(z[0]-p[0])*scale[0]<-d)return;
  for(const [r]of groups)if((dx*(r.center[1]-p[1])*scale[1]-dy*(r.center[0]-p[0])*scale[0])/d<r.rad[0]*scale[0]+1)return;
 }
 return {root:{points:polygon},groups};
}

function infer(end,elevation,section,ink){
 const E=frames[end],F=frames[elevation],axis=F.indexOf(E[2]),cross=1-axis,rad=E.indexOf(F[cross]);
 const {dirs,lo,len}=ink,groups=section.groups;
 const bands=dirs[axis].map(row=>(row.t-lo[axis])/len[axis]);
 if(bands.length>16||bands.length<3||bands.length*(1+groups.flat().length)>144)return;
 const ranges=groups.map(([r])=>[r.center[rad]-r.rad[rad],r.center[rad]+r.rad[rad]]);
 if(ranges.some(([l,h],i)=>ranges.slice(i+1).some(([a,b])=>l<b+.015&&a<h+.015)))return;
 const find=t=>dirs[cross].filter(r=>Math.abs(r.t-lo[cross]-t*len[cross])<=2.1).sort((a,b)=>Math.abs(a.t-lo[cross]-t*len[cross])-Math.abs(b.t-lo[cross]-t*len[cross]))[0];
 const root=[find(0),find(1)],walls=groups.map(g=>g.map(r=>[-1,1].map(s=>find(r.center[rad]+s*r.rad[rad]))));
 if(walls.flat(2).some(r=>!r))return;
 const regions=[{...section.root,parent:-1}],children=groups.map((g)=>{let parent=0;return g.map(r=>{const i=regions.length;regions.push({...r,parent});parent=i;return i;});});
 const local=ranges.map(([l,h])=>dirs[axis].filter((row,j)=>!j||j===bands.length-1||row.runs.some(r=>r.lo<lo[cross]+h*len[cross]&&r.hi>lo[cross]+l*len[cross])).map(row=>row.t));
 // Compare each *pair* of measured generators in a band, leaving room for
 // shoulder stroke width. A continuous outer wall and a dashed inner wall
 // are separate observations. Disagreement or an unsupported cap => abstain.
 const layers=[],used=new Set();
 for(let j=1;j<bands.length;j++){
  const a=lo[axis]+bands[j-1]*len[axis],b=lo[axis]+bands[j]*len[axis];
  const measure=(row,a,b)=>{
   const margin=Math.min(2.6,(b-a)*.18),l=a+margin,h=b-margin;
   const by=t=>row.runs.filter(r=>r.lt===t).reduce((s,r)=>s+Math.max(0,Math.min(h,r.hi+.5)-Math.max(l,r.lo-.5)),0)/(h-l);
   return {v:by('v'),h:by('h')};
  };
  const inkAt=(pair,l=a,h=b)=>pair.map(r=>measure(r,l,h));
  const outer=inkAt(root),full=outer.every(r=>r.v>.7);
  if(!full&&outer.some(r=>r.v>.25))return;
  const material=[full];
  for(const [gi,g] of groups.entries()){
   let inside=full;
   for(let ri=0;ri<g.length;ri++){
    const mid=(a+b)/2,planes=local[gi],id=children[gi][ri],reads=inkAt(walls[gi][ri],planes.filter(t=>t<mid).at(-1),planes.find(t=>t>mid)),typ=inside?'h':'v';
    const seen=reads.every(r=>r[typ]>(typ==='h'?.16:.67));
    if(seen){inside=!inside;used.add(id);}
    else if(reads.some(r=>r.v+r.h>.32))return;
    material[id]=inside;
   }
  }
  if(!material.some(Boolean))return;
  layers.push(material);
 }
 if(used.size!==regions.length-1||!layers.some(m=>m[0])||!layers.some(m=>!m[0]))return;
 return {end,regions,bands,layers};
}

// Two affine end planes need not be parallel. Measure each from the actual
// outer stroke centres, excluding the columns where another edge joins it.
// Only bore walls reaching BOTH measured planes can establish a through cut.
function inclined(end,elevation,section,work){
 if(section.groups.some(g=>g.length!==1)||!work.inkMask||work.paths.some(p=>p.manualType))return;
 const E=frames[end],F=frames[elevation],axis=F.indexOf(E[2]),cross=1-axis,rad=E.indexOf(F[cross]),{w,h}=work.sourceSize;
 const [o,ex,ey]=work.sourceMap,dx=ex[0]-o[0],dy=ey[1]-o[1],d=[dx,dy],n=[w,h];
 if(dx<=0||dy<=0||Math.abs(ex[1]-o[1])*w/dy>1.4||Math.abs(ey[0]-o[0])*h/dx>1.4)return;
 const get=(t,z)=>work.inkMask[axis===1?z*w+t:t*w+z];
 const sample=[[],[]],thick=Math.max(2,work.thickWidth||2);
 for(let t=0;t<n[cross];t++){
  const u=o[cross]+t*d[cross];if(u<.02||u>.98)continue;
  const runs=[];let lo;
  for(let z=0;z<=n[axis];z++){
   if(z<n[axis]&&get(t,z)){lo??=z;continue;}
   if(lo!==undefined){runs.push([lo,z-1]);lo=undefined;}
  }
  if(runs.length<2)continue;
  for(const [j,r]of [runs[0],runs.at(-1)].entries())if(r[1]-r[0]+1<=thick*2.6)
    sample[j].push([u,o[axis]+(r[0]+r[1])/2*d[axis]]);
 }
 const line=pts=>{
  if(pts.length<.64/d[cross])return;
  const fit=ps=>{const x=ps.reduce((s,p)=>s+p[0],0)/ps.length,y=ps.reduce((s,p)=>s+p[1],0)/ps.length;
   const m=ps.reduce((s,p)=>s+(p[0]-x)*(p[1]-y),0)/ps.reduce((s,p)=>s+(p[0]-x)**2,0);return [y-m*x,m];};
  let c=fit(pts);
  for(let j=0;j<2;j++){const errors=pts.map(([x,y])=>Math.abs(y-c[0]-x*c[1])),lim=Math.max(1.35*d[axis],median(errors)*2.5);
   const keep=pts.filter((p,i)=>errors[i]<=lim);if(keep.length<pts.length*.88)return;c=fit(keep);}
  if(pts.some(([x,y])=>Math.abs(y-c[0]-x*c[1])>2.25*d[axis]))return;
  return c;
 };
 const planes=sample.map(line);if(planes.some(p=>!p)||planes.every(p=>Math.abs(p[1])/d[axis]<7))return;
 const at=(j,t)=>planes[j][0]+planes[j][1]*t;
 if([0,1].some(u=>at(1,u)-at(0,u)<.12)||Math.abs(Math.min(at(0,0),at(0,1)))>3*d[axis]||Math.abs(Math.max(at(1,0),at(1,1))-1)>3*d[axis])return;
 const confirmed=[];
 for(const [ring]of section.groups)for(const sign of [-1,1]){
  const u=ring.center[rad]+sign*ring.rad[rad],t=Math.round((u-o[cross])/d[cross]),l=(at(0,u)-o[axis])/d[axis],r=(at(1,u)-o[axis])/d[axis];
  const rows=[];
  for(let dt=-2;dt<=2;dt++){
   const runs=[];let lo;
   for(let z=Math.ceil(l+2);z<=Math.floor(r-1);z++){
    if(z<Math.floor(r-1)&&get(t+dt,z)){lo??=z;continue;}
    if(lo!==undefined){runs.push([lo,z]);lo=undefined;}
   }
   rows.push(runs);
  }
  // Ink on both tangent lines must have a regular dash-and-gap cadence
  // over the entire distance. A blind termination or a centreline fails.
  if(!rows.some(runs=>{
   if(runs.length<3)return false;
   const lengths=runs.map(([a,b])=>b-a),mid=median(lengths),gaps=runs.slice(1).map(([a],j)=>a-runs[j][1]),gap=median(gaps);
   return gap>=1&&runs[0][0]-l<=gap+mid*.7+2&&r-runs.at(-1)[1]<=gap+mid*.7+2&&Math.max(...gaps)<=gap*2+1&&lengths.slice(1,-1).every(v=>v>=mid*.55&&v<=mid*1.65);
  }))return;
  const measured=readWallDashes(work,axis,u);if(measured)confirmed.push(measured);
 }
 const low=Math.min(at(0,0),at(0,1)),extent=Math.max(at(1,0),at(1,1))-low;
 const map=p=>p.map((v,k)=>k===axis?(v-low)/extent:v);
 return {sweep:{end,regions:[{...section.root,parent:-1},...section.groups.map(([r])=>({...r,parent:0}))],bands:[0,1],layers:[[true,...section.groups.map(()=>false)]],planes:planes.map(([a,m])=>[(a-low)/extent,m/extent]),rad},
  elevation,frame:{sourceMap:work.sourceMap.map(map),outline:work.outline.map(map),paths:restoreWallDashes(work,confirmed).map(p=>({...p,points:p.points.map(map)}))},axialScale:extent};
}

export function* measureParallelSections(recon){
 const known=Object.keys(frames).filter(k=>!recon.inferredRoles.includes(k));
 for(const end of known){
  const section=boundaries(recon.drawing[end]);if(!section)continue;
  for(const elevation of known.filter(r=>r!==end)){
   const w=recon.drawing[elevation],ink=axialInk(w),sweep=ink&&infer(end,elevation,section,ink);
   if(sweep){
    const otherFrames={};
    for(const third of known.filter(r=>r!==end&&r!==elevation)){
     const other=axialInk(recon.drawing[third]);if(other)otherFrames[third]={paths:other.paths};
    }
    yield {sweep,elevation,frame:{paths:ink.paths},otherFrames};
   }else{
    const sloped=inclined(end,elevation,section,w);if(sloped)yield sloped;
   }
  }
 }
}

// Triangulate only interfaces between material and air. Adjacent layers
// share boundaries: there is no internal cap across a continuing bore.
export function parallelSectionMesh(sweep,size){
 const {end,regions,bands,layers}=sweep,E=frames[end],s=[size.x,size.y,size.z],vertices=[];
 const loops=regions.map(r=>r.points||Array.from({length:160},(_,i)=>[0,1].map(k=>r.center[k]+r.rad[k]*[Math.cos,Math.sin][k](i*Math.PI/80))));
 const world=(p,t)=>{const q=[];q[E[0]]=p[0];q[E[1]]=p[1];q[E[2]]=sweep.planes?sweep.planes[t][0]+sweep.planes[t][1]*p[sweep.rad]:t;return q.map((v,k)=>(k?.5-v:v-.5)*s[k]);};
 const positive=end!=='front'; // determinant of ordered (end-u,end-v,axis)
 function face(a,b,c,forward){vertices.push(...a,...(forward===positive?b:c),...(forward===positive?c:b));}
 for(const [i,loop]of loops.entries()){
  const child=loops.filter((_,j)=>regions[j].parent===i),flat=[loop,...child].flat();
  const vec=l=>l.map(p=>new THREE.Vector2(...p));
  const cap=THREE.ShapeUtils.triangulateShape(vec(loop),child.map(vec));
  for(const [j,t]of bands.entries()){
   const before=!!layers[j-1]?.[i],after=!!layers[j]?.[i];
   if(before!==after)for(const f of cap)face(...f.map(k=>world(flat[k],t)),before);
   if(j>=layers.length||after===!!layers[j][regions[i].parent])continue;
   for(const [k,p]of loop.entries()){
    const q=loop[(k+1)%loop.length],a=world(p,t),b=world(q,t),c=world(q,bands[j+1]),d=world(p,bands[j+1]);
    face(a,b,c,after);face(a,c,d,after);
   }
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.computeVertexNormals();g.computeBoundingBox();
 g.userData.sectionAxis=sweep.planes?E[2]:undefined;return g;
}

// Project the returned triangle mesh. These meshes have shared, identical
// loop vertices, so edge adjacency is exact; unlike a general Boolean mesh
// they need neither a rasterized silhouette nor relaxed T-junction matching.
export function projectParallelMesh(g,size){
 const pos=g.attributes.position,edges=new Map(),vs=new Map();
 for(let i=0;i<pos.count;i+=3){
  const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(pos,i+j));
  const n=p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
  const ids=p.map(v=>{const k=v.toArray().join(',');if(!vs.has(k))vs.set(k,vs.size);return vs.get(k);});
  for(let j=0;j<3;j++){
   const k=(j+1)%3,key=[ids[j],ids[k]].sort((a,b)=>a-b).join(':');
   if(!edges.has(key))edges.set(key,{a:p[j],b:p[k],n:[]});
   edges.get(key).n.push(n);
  }
 }
 const ext=[size.x,size.y,size.z],d=Math.max(...ext),geomaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const mesh=new THREE.Mesh(g,geomaterial),ray=new THREE.Raycaster();g.boundsTree=new MeshBVH(g);mesh.raycast=acceleratedRaycast;ray.firstHitOnly=true;
 const out={},wire=[];
 try{
  for(const [role,F]of Object.entries(frames)){
   const dir=new THREE.Vector3();dir.setComponent(F[2],role==='top'?1:-1);
   const to=v=>F.slice(0,2).map(k=>.5+(k?-1:1)*v.getComponent(k)/ext[k]),ls=[];
   for(const {a,b,n}of edges.values()){
    if(n.length!==2)continue;
    const crease=n[0].dot(n[1])<.997,ds=n.map(v=>v.dot(dir));
    if(role==='front'&&n[0].dot(n[1])<1-1e-8)wire.push({a:a.toArray(),b:b.toArray(),n});
    if(!crease&&ds[0]*ds[1]>=-1e-12)continue;
    const across=b.clone().sub(a).cross(dir);if(across.length()<d*1e-9)continue;across.normalize();
    const count=Math.max(1,Math.ceil(dist(to(a),to(b))*100));
    for(let j=0;j<count;j++){
     const p=a.clone().lerp(b,(j+.5)/count);let visible=false,boundary=false;
     // At the exact junction depth a ray can lie in a cap plane. Probe
     // both sides: a nearer face must cover both to hide this edge.
     for(const sign of [-1,1]){
      const origin=p.clone().addScaledVector(across,d*1e-6*sign).addScaledVector(dir,3*d);
      ray.set(origin,dir.clone().negate());const hit=ray.intersectObject(mesh)[0];
      boundary||=!hit;visible||=!hit||hit.distance>=3*d-d*4e-5;
     }
     const ends=[j/count,(j+1)/count].map(t=>a.clone().lerp(b,t));
     const axis=g.userData.sectionAxis,section=axis!==undefined&&crease&&n.some(v=>Math.abs(v.getComponent(axis))>.02&&Math.abs(v.getComponent(axis))<.99999);
     ls.push({p:ends.map(to),world:ends.map(v=>v.toArray()),lt:visible?'v':'h',boundary,...(section?{construction:'section-generators'}:{})});
    }
   }
   out[role]=deduplicateProjection(ls);
  }
  g.userData.uploadSurfaceEdges=wire;return out;
 }finally{g.boundsTree=null;geomaterial.dispose();}
}

import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { maskLoops } from './upload-lines.js';
import { surfaceEdges } from './surface-edges.js';

// Different depths and CSG subdivisions can project onto the same interval.
// Split at all interval endpoints, keeping one stroke with visible priority.
// Interpolate its world coordinates together with the projected coordinates.
export function deduplicateProjection(lines,tolerance=1e-6) {
  const groups=[];
  for(const line of [...lines].sort((a,b)=>Math.hypot(...b.p[1].map((v,i)=>v-b.p[0][i]))-Math.hypot(...a.p[1].map((v,i)=>v-a.p[0][i])))) {
    const [a,b]=line.p,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    if(length<1e-8)continue;
    let group=groups.find(g=>Math.abs(dx*g.u[1]-dy*g.u[0])<length*1e-5&&[a,b].every(p=>Math.abs((p[0]-g.a[0])*g.u[1]-(p[1]-g.a[1])*g.u[0])<tolerance));
    if(!group){group={a,u:[dx/length,dy/length],lines:[]};groups.push(group);}
    const ts=line.p.map(p=>(p[0]-group.a[0])*group.u[0]+(p[1]-group.a[1])*group.u[1]);
    group.lines.push({line,ts,lo:Math.min(...ts),hi:Math.max(...ts)});
  }
  const result=[];
  for(const g of groups) {
    const cuts=g.lines.flatMap(s=>[s.lo,s.hi]).sort((a,b)=>a-b).filter((v,i,all)=>!i||v-all[i-1]>1e-8);
    for(let i=1;i<cuts.length;i++) {
      const lo=cuts[i-1],hi=cuts[i],mid=(lo+hi)/2;
      const candidates=g.lines.filter(s=>s.lo<=mid&&s.hi>=mid),source=candidates.find(s=>s.line.lt==='v')||candidates[0];
      if(!source)continue;
      const world=source.line.world?[lo,hi].map(t=>{const f=(t-source.ts[0])/(source.ts[1]-source.ts[0]);return source.line.world[0].map((v,j)=>v+f*(source.line.world[1][j]-v));}):undefined;
      result.push({...source.line,p:[lo,hi].map(t=>[g.a[0]+t*g.u[0],g.a[1]+t*g.u[1]]),world});
    }
  }
  return result;
}

// Raster silhouettes guarantee closed loops, but their pixel centers cannot
// supply exact projection correspondences. Recover each nearby mesh edge and
// its world point together; never move a 2D point independently of its 3D point.
function preciseBoundary(point,edges) {
  let best=null;
  for(const edge of edges) {
    const [a,b]=edge.p,dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    const p=[a[0]+t*dx,a[1]+t*dy],distance=Math.hypot(p[0]-point[0],p[1]-point[1]);
    if(distance<.004&&(!best||distance<best.distance))best={p,world:edge.world?.[0].map((v,i)=>v+t*(edge.world[1][i]-v)),distance};
  }
  return best||{p:point};
}

// The back of a curved intersection can project onto a front rim, even when
// their mesh subdivisions differ. A real rim has a jump in first-hit depth
// that persists as the two parallel rays approach the same image point.
// A smooth foreground face hides the edge equally on both sides.
function coveredByFrontRim(line,visible,view,mesh,caster,distance,diagonal) {
  if(!line.world)return false;
  const [a,b]=line.world.map(p=>new THREE.Vector3(...p));
  const tangent=b.clone().sub(a),across=tangent.clone().cross(view.dir);
  if(across.lengthSq()<1e-14*diagonal*diagonal)return false;
  across.normalize();
  function firstHit(point,offset) {
    const origin=point.clone().addScaledVector(view.dir,distance).addScaledVector(across,offset);
    caster.set(origin,view.dir.clone().negate());
    return caster.intersectObject(mesh,false)[0]?.distance??Infinity;
  }
  function jumpAt(point,offset) {
    const plus=firstHit(point,offset),minus=firstHit(point,-offset);
    const jump=Math.abs(plus-minus);
    return {near:Math.min(plus,minus),sign:plus<minus?1:-1,jump};
  }
  const offset=diagonal*1e-6,threshold=diagonal*.003,mid=a.clone().lerp(b,.5);
  const fine=jumpAt(mid,offset);
  if(!(fine.jump>threshold&&fine.near<distance-threshold))return false;
  const coarse=jumpAt(mid,4*offset);
  if(fine.sign!==coarse.sign||!(fine.jump>=coarse.jump*.8))return false;
  // Keep the rear line unless an actual foreground stroke already traces
  // the depth jump. The lookup accounts for tessellated arc endpoints, not
  // a tolerance on the position of the jump itself.
  const projected=view.to(mid),[p,q]=line.p,ux=q[0]-p[0],uy=q[1]-p[1],length=Math.hypot(ux,uy);
  return visible.some(l=>{
    const [s,t]=l.p,dx=t[0]-s[0],dy=t[1]-s[1],den=dx*dx+dy*dy;
    if(!den||Math.abs(ux*dy-uy*dx)>.08*length*Math.sqrt(den))return false;
    const x=projected[0]-s[0],y=projected[1]-s[1],f=Math.max(0,Math.min(1,(x*dx+y*dy)/den));
    return Math.hypot(x-f*dx,y-f*dy)<.005;
  });
}

// Project the corrected upload model, including its confirmed holes and pockets.
export function projectUploadSolid(geometry,size,{creaseAngle=Math.PI/7}={}) {
  geometry.computeBoundingBox();
  const diagonal=geometry.boundingBox.getSize(new THREE.Vector3()).length();
  const edges=surfaceEdges(geometry);
  geometry.userData.uploadSurfaceEdges=edges;
  geometry.boundsTree=new MeshBVH(geometry);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);mesh.raycast=acceleratedRaycast;mesh.updateMatrixWorld();
  const caster=new THREE.Raycaster();caster.firstHitOnly=true;
  const views={front:{dir:new THREE.Vector3(0,-1,0),to:p=>[(p.x+size.x/2)/size.x,(size.z/2-p.z)/size.z]},
    top:{dir:new THREE.Vector3(0,0,1),to:p=>[(p.x+size.x/2)/size.x,(size.y/2-p.y)/size.y]},
    side:{dir:new THREE.Vector3(-1,0,0),to:p=>[(size.y/2-p.y)/size.y,(size.z/2-p.z)/size.z]}};
  const output={front:[],top:[],side:[]},distance=diagonal*3;
  try {
    const silhouettes={};
    const resolution=512;
    for(const [role,view] of Object.entries(views)) {
      const mask=new Uint8Array(resolution*resolution),pos=geometry.attributes.position,index=geometry.index;
      for(let i=0;i<(index?index.count:pos.count);i+=3) {
        const points=[0,1,2].map(j=>view.to(new THREE.Vector3().fromBufferAttribute(pos,index?index.getX(i+j):i+j)).map(v=>v*(resolution-1)));
        const [a,b,c]=points,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;
        const minX=Math.max(0,Math.floor(Math.min(...points.map(p=>p[0])))),maxX=Math.min(resolution-1,Math.ceil(Math.max(...points.map(p=>p[0]))));
        const minY=Math.max(0,Math.floor(Math.min(...points.map(p=>p[1])))),maxY=Math.min(resolution-1,Math.ceil(Math.max(...points.map(p=>p[1]))));
        for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
          const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den;
          const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den;
          if(u>=-.002&&v>=-.002&&u+v<=1.002)mask[y*resolution+x]=1;
        }
      }
      silhouettes[role]=maskLoops(mask,resolution,resolution,.65).map(loop=>loop.points.map(p=>p.map(v=>Math.min(1,Math.max(0,(v-.5)/(resolution-1))))));
    }
    for(const [role,view] of Object.entries(views))for(const edge of edges) {
      if(edge.n.length!==2)continue;
      const [n1,n2]=edge.n,sharp=n1.dot(n2)<Math.cos(creaseAngle);
      // A planar wall tangent to a rounded roof has one exactly edge-on
      // normal. It is still an apparent contour from above, although the
      // normals do not strictly straddle zero and the join is smooth.
      const d1=n1.dot(view.dir),d2=n2.dot(view.dir),silhouette=d1*d2< -1e-8||Math.abs(d1)<1e-8&&Math.abs(d2)>1e-8||Math.abs(d2)<1e-8&&Math.abs(d1)>1e-8;
      if(!sharp&&!silhouette)continue;
      const p=new THREE.Vector3().fromArray(edge.a),q=new THREE.Vector3().fromArray(edge.b);
      const pa=view.to(p),pb=view.to(q);if(Math.hypot(pa[0]-pb[0],pa[1]-pb[1])<.001)continue;
      const segments=Math.min(12,Math.max(1,Math.ceil(p.distanceTo(q)/diagonal*45)));
      for(let i=0;i<segments;i++) {
        const mid=p.clone().lerp(q,(i+.5)/segments),origin=mid.clone().addScaledVector(view.dir,distance);
        caster.set(origin,view.dir.clone().negate());const hit=caster.intersectObject(mesh,false)[0];
        const hidden=hit&&hit.distance<distance-diagonal*.002;
        // Tangent edges of an internal cylinder are hidden hole walls in the
        // perpendicular views; they must not be discarded as back-facing curves.
        const ends=[p.clone().lerp(q,i/segments),p.clone().lerp(q,(i+1)/segments)];
        output[role].push({p:ends.map(view.to),world:ends.map(p=>p.toArray()),lt:hidden?'h':'v'});
      }
    }
    // Keep one copy of coincident edges. Give visible lines priority.
    for(const role of Object.keys(output)) {
      const boundary=silhouettes[role];
      const exact=output[role];
      const nearLoops=(p,loops)=>loops.some(loop=>loop.slice(1).some((b,i)=>{
        const a=loop[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
        return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)<.006;
      }));
      const nearBoundary=p=>nearLoops(p,boundary),nearOuter=p=>nearLoops(p,boundary.slice(0,1));
      output[role]=output[role].filter(line=>!nearBoundary([(line.p[0][0]+line.p[1][0])/2,(line.p[0][1]+line.p[1][1])/2]));
      // Use geometry endpoints to register a closed silhouette to the same
      // corrected coordinates used by holes, slots and the teaching points.
      const perimeter=exact.filter(line=>line.lt==='v'&&line.p.every(nearBoundary)&&nearBoundary([(line.p[0][0]+line.p[1][0])/2,(line.p[0][1]+line.p[1][1])/2]));
      const degree=new Map();for(const line of perimeter)for(const p of line.p){const key=p.map(v=>Math.round(v*100000)).join(',');degree.set(key,(degree.get(key)||0)+1);}
      const exactClosed=perimeter.length>=3&&[...degree.values()].every(n=>n%2===0);
      if(exactClosed)output[role].push(...perimeter.map(line=>({...line,boundary:nearOuter([(line.p[0][0]+line.p[1][0])/2,(line.p[0][1]+line.p[1][1])/2])})));
      else for(const loop of boundary) {
        const points=loop.map(p=>preciseBoundary(p,exact));
        for(let i=1;i<points.length;i++) {
          const a=points[i-1],b=points[i];
          output[role].push({p:[a.p,b.p],world:a.world&&b.world?[a.world,b.world]:undefined,lt:'v',boundary:loop===boundary[0]});
        }
      }
      const unique=new Map();
      for(const line of output[role]) {
        const keys=line.p.map(p=>p.map(v=>Math.round(v*10000)).join(',')).sort(),k=keys.join('|');
        if(!unique.has(k)||line.lt==='v')unique.set(k,line);
      }
      output[role]=deduplicateProjection([...unique.values()]);
      const visible=output[role].filter(l=>l.lt==='v');
      output[role]=output[role].filter(l=>l.lt==='v'||!coveredByFrontRim(l,visible,views[role],mesh,caster,distance,diagonal));
    }
    return output;
  } finally {material.dispose();geometry.boundsTree=null;}
}

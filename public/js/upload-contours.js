import {smoothProfile} from './upload-curves.js';
import {simplify} from './upload-lines.js';

// A skeleton branch often leaves several short zigzags between two long
// measured supports. Recover their intersection within the stroke tolerance.
// Parallel supports (including a real narrow step) are deliberately retained.
function cleanDetours(input,tolerance) {
  const points=input.slice(0,-1).map(p=>{const q=[...p];if(p.curved)q.curved=true;return q;});let changed=true;
  const distance=(p,a,b)=>Math.abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))/(Math.hypot(b[0]-a[0],b[1]-a[1])||1);
  while(changed&&points.length>3) {
    changed=false;
    search:for(let i=0;i<points.length;i++)for(let skip=1;skip<=4&&skip<points.length-2;skip++) {
      const at=j=>points[(j+points.length)%points.length],a=at(i-1),b=at(i),c=at(i+skip),d=at(i+skip+1);
      const u=[b[0]-a[0],b[1]-a[1]],v=[d[0]-c[0],d[1]-c[1]],lu=Math.hypot(...u),lv=Math.hypot(...v),det=u[0]*v[1]-u[1]*v[0];
      if(Math.min(lu,lv)<6*tolerance)continue;
      const middle=Array.from({length:skip+1},(_,j)=>at(i+j));
      if([a,b,c,d,...middle].some(p=>p.curved))continue;
      if(middle.slice(1).reduce((s,p,j)=>s+Math.hypot(p[0]-middle[j][0],p[1]-middle[j][1]),0)>12*tolerance)continue;
      if(Math.abs(det)<lu*lv*.15) {
        // Several branch-induced zigzags along the same incline are noise;
        // a single short step between parallel supports remains a real edge.
        if(skip<2||u[0]*v[0]+u[1]*v[1]<=0||middle.some(p=>distance(p,a,d)>2*tolerance))continue;
        const rotated=Array.from({length:points.length},(_,j)=>at(i+j));rotated.splice(0,skip+1);points.splice(0,points.length,...rotated);changed=true;break search;
      }
      const t=((c[0]-a[0])*v[1]-(c[1]-a[1])*v[0])/det,q=[a[0]+t*u[0],a[1]+t*u[1]];
      if(Math.min(...middle.map(p=>Math.hypot(q[0]-p[0],q[1]-p[1])))>3*tolerance||middle.some(p=>Math.min(distance(p,a,b),distance(p,c,d))>2*tolerance))continue;
      // Rotate the ring before splicing so a detour across its origin is safe.
      const rotated=Array.from({length:points.length},(_,j)=>at(i+j));rotated.splice(0,skip+1,q);points.splice(0,points.length,...rotated);changed=true;break search;
    }
  }
  return [...points,[...points[0]]];
}

// Trace the outside face of the measured stroke graph. Unlike a filled raster
// boundary, this follows stroke centres and shares every junction with the 2D
// drawing. Dangling internal strokes do not form part of the perimeter.
export function regularizeMeasuredContour(work,width,height,{includeMeasuredArcs=false}={}) {
  const key=p=>p.map(v=>v.toFixed(7)).join(','),nodes=new Map(),edges=[];
  for(const path of work.paths.filter(p=>p.lt==='v'&&(!p.arc||includeMeasuredArcs&&p.measuredPrimitive))) {
    const a=key(path.points[0]),b=key(path.points.at(-1));if(a===b)continue;
    const id=edges.length;edges.push({a,b,path});
    for(const k of [a,b]){if(!nodes.has(k))nodes.set(k,new Set());nodes.get(k).add(id);}
  }
  const removed=new Set(),queue=[...nodes.keys()].filter(k=>nodes.get(k).size===1);
  while(queue.length){const k=queue.pop();for(const id of nodes.get(k)){if(removed.has(id))continue;removed.add(id);const e=edges[id],other=e.a===k?e.b:e.a;nodes.get(other).delete(id);if(nodes.get(other).size===1)queue.push(other);}nodes.get(k).clear();}
  const seen=new Set(),loops=[];
  for(let firstId=0;firstId<edges.length;firstId++)for(const firstRev of [false,true]) {
    const first=firstId+':'+firstRev;if(removed.has(firstId)||seen.has(first))continue;
    let id=firstId,rev=firstRev,points=[],chain=[],closed=false;
    for(let i=0;i<=edges.length*2;i++) {
      const token=id+':'+rev;if(seen.has(token)){closed=token===first;break;}seen.add(token);
      const e=edges[id],ps=rev?[...e.path.points].reverse():e.path.points;
      points.push(...ps.slice(0,-1));chain.push({id,rev});
      const at=rev?e.a:e.b,a=ps.at(-1),b=[...ps].reverse().find(p=>Math.hypot((p[0]-a[0])*width,(p[1]-a[1])*height)>3)||ps.at(-2),back=Math.atan2((b[1]-a[1])*height,(b[0]-a[0])*width);
      const choices=[...nodes.get(at)].filter(next=>next!==id).map(next=>{
        const t=edges[next],r=t.b===at,qs=r?[...t.path.points].reverse():t.path.points;
        const d=qs.find((p,j)=>j&&Math.hypot((p[0]-a[0])*width,(p[1]-a[1])*height)>3)||qs.at(-1);
        return {id:next,rev:r,angle:d?(back-Math.atan2((d[1]-a[1])*height,(d[0]-a[0])*width)+Math.PI*2)%(Math.PI*2):0};
      }).sort((a,b)=>a.angle-b.angle);
      if(!choices.length)break;({id,rev}=choices[0]);
    }
    if(closed){points.push(points[0]);const area=points.slice(1).reduce((s,p,i)=>s+points[i][0]*p[1]-p[0]*points[i][1],0)/2;loops.push({points,chain,area});}
  }
  const loop=loops.sort((a,b)=>Math.abs(b.area)-Math.abs(a.area))[0];
  if(!loop||Math.abs(loop.area)<.15)return false;
  const oldArea=work.outline.slice(1).reduce((s,p,i)=>s+work.outline[i][0]*p[1]-p[0]*work.outline[i][1],0)/2;
  if(Math.abs(Math.abs(loop.area)-Math.abs(oldArea))>Math.abs(oldArea)*.12)return false;
  const pixels=loop.points.map(p=>{const q=[p[0]*width,p[1]*height];if(p.curved)q.curved=true;return q;});
  const smoothed=smoothProfile(cleanDetours(pixels.some(p=>p.curved)?pixels:simplify(pixels,2),4),3,{preserveJunctions:false});
  const ring=smoothed.points.map(p=>{const q=[p[0]/width,p[1]/height];if(p.curved)q.curved=true;return q;});
  // Anchor near-axis perimeter supports to the normalized datum. Tiny endpoint
  // offsets from skeleton branches must not tilt a horizontal or vertical edge.
  for(let i=1;i<ring.length;i++) {
    const a=ring[i-1],b=ring[i];if(a.curved||b.curved)continue;
    for(const axis of [0,1]) {
      const other=1-axis;
      if(Math.abs(a[other]-b[other])<.06||Math.abs(a[axis]-b[axis])>.006)continue;
      const value=(a[axis]+b[axis])/2,datum=Math.abs(value)<.012?0:Math.abs(value-1)<.012?1:value;
      a[axis]=b[axis]=datum;
    }
  }
  ring[ring.length-1]=[...ring[0]];
  const nearest=p=>{
    let best;
    for(let i=1;i<ring.length;i++) {
      const a=ring[i-1],b=ring[i],dx=(b[0]-a[0])*width,dy=(b[1]-a[1])*height;
      const t=Math.max(0,Math.min(1,((p[0]-a[0])*width*dx+(p[1]-a[1])*height*dy)/(dx*dx+dy*dy||1)));
      const q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=Math.hypot((p[0]-q[0])*width,(p[1]-q[1])*height);
      if(!best||distance<best.distance)best={q,at:i-1+t,distance};
    }return best;
  };
  const junctions=new Map();
  for(const {id} of loop.chain)for(const p of [edges[id].path.points[0],edges[id].path.points.at(-1)])junctions.set(key(p),nearest(p));
  for(const path of work.paths) {
    // Guides intersect the new perimeter along their existing axis; moving
    // their endpoint by nearest distance would turn a vertical axis oblique.
    const axis=path.lt==='v'?-1:[0,1].find(axis=>Math.max(...path.points.map(p=>p[axis]))-Math.min(...path.points.map(p=>p[axis]))<1/(axis?height:width));
    for(const p of path.points) {
      const match=junctions.get(key(p));if(!match)continue;let q=match.q;
      if(axis!==undefined&&axis>=0) {
        const candidates=[];
        for(let i=1;i<ring.length;i++) {
          const a=ring[i-1],b=ring[i],delta=b[axis]-a[axis];if(Math.abs(delta)<1e-10)continue;
          const t=(p[axis]-a[axis])/delta;if(t<0||t>1)continue;
          candidates.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
        }
        if(candidates.length)q=candidates.sort((a,b)=>Math.hypot((a[0]-match.q[0])*width,(a[1]-match.q[1])*height)-Math.hypot((b[0]-match.q[0])*width,(b[1]-match.q[1])*height))[0];
      }
      p[0]=q[0];p[1]=q[1];
    }
  }
  const count=ring.length-1;
  for(const {id,rev} of loop.chain) {
    const path=edges[id].path,ps=rev?[...path.points].reverse():path.points;
    const a=nearest(ps[0]),b=nearest(ps.at(-1));let end=b.at;if(end<=a.at+1e-8)end+=count;
    const points=[a.q];for(let i=Math.floor(a.at)+1;i<end;i++)points.push(ring[i%count]);points.push(b.q);
    path.points=rev?points.reverse():points;path.perimeter=true;
  }
  work.outline=ring;work.contourRegularized=true;
  return true;
}

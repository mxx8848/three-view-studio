import * as THREE from 'three';

// CSG splits one face edge without always splitting the adjacent triangle.
// Match intervals on the same 3D line, so T-junctions neither erase real rims
// nor create false diagonal seams on planar faces.
export function surfaceEdges(geometry) {
  geometry.computeBoundingBox();
  const diagonal=geometry.boundingBox.getSize(new THREE.Vector3()).length();
  const tolerance=Math.max(1e-9,diagonal*2e-6),directionTolerance=2e-4,groups=new Map();
  const pos=geometry.attributes.position,index=geometry.index,count=index?index.count:pos.count;
  for(let i=0;i<count;i+=3) {
    const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(pos,index?index.getX(i+j):i+j));
    const normal=points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0]));
    const longest=Math.max(points[0].distanceTo(points[1]),points[1].distanceTo(points[2]),points[2].distanceTo(points[0]));
    // CSG leaves slivers below position precision. Their cross products have
    // arbitrary directions and turn a smooth bore into parallel fake creases.
    if(normal.length()<longest*tolerance)continue;normal.normalize();
    for(let j=0;j<3;j++) {
      const a=points[j],b=points[(j+1)%3],direction=b.clone().sub(a),length=direction.length();
      if(length<tolerance)continue;direction.divideScalar(length);
      const components=direction.toArray(),axis=components.map(Math.abs).indexOf(Math.max(...components.map(Math.abs)));
      if(components[axis]<0)direction.negate();
      const axes=[0,1,2].filter(i=>i!==axis),v=direction.toArray(),intercept=a.clone().addScaledVector(direction,-a.getComponent(axis)/v[axis]);
      const values=[v[axes[0]]/v[axis],v[axes[1]]/v[axis],intercept.getComponent(axes[0]),intercept.getComponent(axes[1])];
      const steps=[directionTolerance,directionTolerance,tolerance,tolerance],bucket=values.map((v,i)=>Math.floor(v/steps[i]));
      let group=null;
      // Neighbor buckets prevent rounding boundaries from breaking a real rim.
      search:for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(let k=-1;k<=1;k++)for(let l=-1;l<=1;l++) {
        const candidates=groups.get([axis,bucket[0]+i,bucket[1]+j,bucket[2]+k,bucket[3]+l].join(','));
        for(const candidate of candidates||[])if(values.every((v,i)=>Math.abs(v-candidate.values[i])<=steps[i])){group=candidate;break search;}
      }
      if(!group){group={direction,base:a.clone().addScaledVector(direction,-a.dot(direction)),segments:[],values};const key=[axis,...bucket].join(',');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(group);}
      const ta=a.dot(group.direction),tb=b.dot(group.direction);
      group.segments.push({lo:Math.min(ta,tb),hi:Math.max(ta,tb),normal});
    }
  }
  const output=[];
  for(const {direction,base,segments} of [...groups.values()].flat()) {
    const cuts=segments.flatMap(s=>[s.lo,s.hi]).sort((a,b)=>a-b).filter((v,i,all)=>i===0||v-all[i-1]>tolerance);
    for(let i=1;i<cuts.length;i++) {
      const lo=cuts[i-1],hi=cuts[i],mid=(lo+hi)/2,n=[];
      if(hi-lo<tolerance)continue;
      for(const s of segments)if(mid>s.lo-tolerance&&mid<s.hi+tolerance&&!n.some(v=>v.dot(s.normal)>1-1e-8))n.push(s.normal);
      if(n.length<2)continue;
      output.push({a:base.clone().addScaledVector(direction,lo).toArray(),b:base.clone().addScaledVector(direction,hi).toArray(),n});
    }
  }
  return output;
}

import assert from 'node:assert/strict';
import {layeredStructureHypotheses} from '../public/js/upload-layered-structures.js';

const view=()=>({paths:[],curveDatums:[],sourceSize:{w:400,h:400}});
function stroke(w,x1,y1,x2,y2,lt='v'){
 w.paths.push({id:w.paths.length,lt,points:[[x1,y1],[x2,y2]]});
}
const H=(w,y,l,r)=>stroke(w,l,y,r,y),V=(w,x,t,b)=>stroke(w,x,t,x,b);
function dashed(w,x,y,endX,endY){
 for(let i=0;i<5;i++)stroke(w,x+(endX-x)*i/5,y+(endY-y)*i/5,
  x+(endX-x)*(i===4?1:(i+.78)/5),y+(endY-y)*(i===4?1:(i+.78)/5),'h');
}
function baseGroove(w,l,r,v){
 V(w,l,v,1);V(w,r,v,1);H(w,v,l,r);
}

for(const t of [-.025,0,.04]){
 const front=view(),side=view(),d={drawing:{front,side},inferredRoles:['top']};
 baseGroove(front,.19+t,.8,.86);baseGroove(side,.32,.72+t,.8);
 dashed(front,0,.8,.18+t,.8);dashed(side,.32,.86,.72+t,.86);
 const f=structuredClone(front),s=structuredClone(side);
 // Stepped plate, crossed feet, and a finite circular opening.
 const stop=.53+t,shoulder=.81+t,cy=.33,r=.1+t;
 front.curveDatums.push({u:.5,v:cy,rx:r,ry:r});
 for(const x of [.12,.88])V(front,x,0,.65);
 for(const x of [.27,.73])V(front,x,0,.86);
 H(front,.65,0,.27);H(front,.65,.73,1);V(side,shoulder,0,.65);H(side,.65,shoulder,1);
 for(const v of [cy-r,cy+r])dashed(side,0,v,stop,v);
 dashed(side,stop,0,stop,.86);
 const [plate]=layeredStructureHypotheses(d);
 assert.equal(plate.family,'forked-plate-crossed-base-grooves');
 assert.ok(Math.abs(plate.features.at(-1).axialRange[0]-(1-stop))<1e-8);
 side.paths=side.paths.filter(p=>p.points[0][0]!==stop);
 assert.deepEqual(layeredStructureHypotheses(d),[],'bore stop needs a hidden end edge');

 // Concentric half-round channels meet at a measured change of depth.
 const small=.14+t,large=.26+t,step=.48+t,lip=.17;
 f.curveDatums=[small,large].map(rx=>({u:.51,v:0,rx,ry:rx}));
 V(s,lip,0,1);H(s,large,0,lip);V(s,step,0,.61);H(s,.61,step,1);
 dashed(s,0,small,step,small);dashed(s,step,large,1,large);
 V(f,.1,0,.61);V(f,.9,0,.61);H(f,.61,0,.1);H(f,.61,.9,1);
 const data={drawing:{front:f,side:s},inferredRoles:['top']};
 const [saddle]=layeredStructureHypotheses(data);
 assert.equal(saddle.family,'stepped-open-saddle-crossed-base-grooves');
 assert.ok(Math.abs(saddle.features[0].axialRange[0]-(1-step))<1e-8);
 s.paths=s.paths.filter(p=>p.points[0][1]!==small);
 assert.deepEqual(layeredStructureHypotheses(data),[],'a second concentric arc alone does not establish the change of groove depth');

 // Through bores meet under a slot; either end of the tube may be open.
 for(const sign of [-1,1]){
  const a=view(),b=view(),u=.5,depth=.51+t,rv=.19+t,outer=.43;
  a.curveDatums=[{u,v:1,rx:.34,ry:.34},{u,v:.42,rx:rv,ry:rv}];
  b.curveDatums=[{u,v:depth,rx:.5,ry:outer},{u,v:depth,rx:rv,ry:rv*outer/.5}];
  for(const x of [.16,.84]){V(b,x,0,.1);V(b,x,.9,1);}
  const reach=outer*Math.sqrt(1-(rv/.5)**2);
  for(const x of [u-rv,u+rv]){
   V(a,x,0,.42);dashed(a,x,.42,x,1);
   V(b,x,Math.min(depth,depth+sign*reach),Math.max(depth,depth+sign*reach));
   dashed(b,x,Math.min(depth,depth-sign*reach),x,Math.max(depth,depth-sign*reach));
  }
  const tubeData={drawing:{front:a,top:b},inferredRoles:['side']};
  const [tube]=layeredStructureHypotheses(tubeData);
  assert.equal(tube?.family,'open-tube-cross-bore-arched-base',`tube variation ${t} opening ${sign}`);
  assert.deepEqual(tube.features.at(-1).axialRange,sign===1?[0,1-depth]:[1-depth,1]);
  for(const p of b.paths.filter(p=>p.lt==='h'))p.manualType=true;
  assert.deepEqual(layeredStructureHypotheses(tubeData),[],'do not reinterpret manual classifications as evidence for a slot');
 }
}
console.log('12 layered structure variants and 12 missing or conflicting evidence controls passed');

for(const sign of [-1,1])for(const rad of [.22,.31]){
 const front=view(),top=view(),c={u:.5,v:.47,rx:rad,ry:rad*.62,ids:[999]};
 const open=sign<0?0:1,far=.5-sign*rad,lo=c.v-c.ry,hi=c.v+c.ry;
 front.curveDatums=[c];top.curveDatums=[{u:.5,v:.5,rx:.5,ry:.5},{u:.5,v:.5,rx:.25,ry:.25}];
 V(front,1-open,0,1);V(front,open,0,lo);V(front,open,hi,1);
 for(const y of [lo,hi])H(front,y,Math.min(.5,open),Math.max(.5,open));
 front.paths.push({id:999,arc:true,lt:'v',points:[[.5,lo],[far,c.v],[.5,hi]]});
 dashed(top,far,.16,far,.27);dashed(top,far,.73,far,.84);
 const r={drawing:{front,top},inferredRoles:['side']};
 const [h]=layeredStructureHypotheses(r);assert.equal(h?.family,'axial-tube-round-ended-side-slot');
 assert.equal(h.features.at(-1).profile[0][0],sign<0?-.02:.5);
 top.paths=[];assert.deepEqual(layeredStructureHypotheses(r),[],'do not assume a through slot from the front outline alone');
}
console.log('4 round-ended radial slot variants and 4 missing plan controls passed');

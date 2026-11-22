// Union of a horizontal tube and a vertical cylindrical boss. Both positive
// cylinders and both bores are measured independently in the end/plan views.
// The elevation's intersection branches distinguish this from a drilled box.
export function hasOrthogonalBossEvidence(recon) {
 const {top,side}=recon.drawing;
 if(recon.inferredRoles.some(r=>['top','side'].includes(r)))return false;
 const rings=w=>(w.curveDatums||[]).filter(c=>c.rx>.05&&c.u-c.rx>-.02&&c.u+c.rx<1.02).sort((a,b)=>b.rx-a.rx);
 const a=rings(top),b=rings(side);
 return a.length===2&&b.length===2&&Math.abs(a[0].ry-.5)<.025&&Math.abs(b[0].rx-.5)<.025&&b[0].v-b[0].ry>.04&&Math.hypot(a[0].u-a[1].u,a[0].v-a[1].v)<.02&&Math.hypot(b[0].u-b[1].u,b[0].v-b[1].v)<.02;
}

// Jointly measure a circular mouth and its independently observed generators.
// Raster circles and one-pixel dash trains have different centre biases; using
// only one of them can shift the other view's hole wall by several pixels.
function jointBore(recon,feature,wallViews) {
 const s=recon.modelSize,base=feature.r*(feature.role==='side'?s.y:s.x),radii=[base,base],centers={u:[feature.u,feature.u],v:[feature.v,feature.v]};
 for(const [role,axis,center,extent] of wallViews) {
  if(recon.inferredRoles.includes(role))continue;
  const w=recon.drawing[role],[a,b,c]=w.sourceMap||[],pixel=a?Math.abs((axis?c:b)[axis]-a[axis]):1/(axis?w.sourceSize.h:w.sourceSize.w),tol=3*pixel,values=[];
  for(const sign of [-1,1]) {
   const expected=center+sign*base/extent,positions=[];
   for(const p of w.paths.filter(p=>!p.arc&&(['h','t'].includes(p.lt)||(p.lt==='v'&&p.width<w.thickWidth*.75)))) {
    const points=a&&p.measuredPoints?.length?p.measuredPoints.map(q=>a.map((v,i)=>v+q[0]*(b[i]-v)+q[1]*(c[i]-v))):p.points;
    if(points.length<2)continue;
    const trim=Math.floor(points.length*.15),core=trim?points.slice(trim,-trim):points;
    const coords=core.map(q=>q[axis]);
    if(Math.max(...coords)-Math.min(...coords)>tol||Math.max(...core.map(q=>q[1-axis]))-Math.min(...core.map(q=>q[1-axis]))<.025)continue;
    const at=coords.reduce((sum,v)=>sum+v,0)/coords.length;
    if(Math.abs(at-expected)<tol)positions.push(at);
   }
   if(positions.length){positions.sort((a,b)=>a-b);values.push(positions[Math.floor(positions.length/2)]);}
  }
  if(values.length===2){
   radii.push((values[1]-values[0])*extent/2);
   const field=feature.role==='top'?(role==='side'?'v':'u'):(role==='top'?'u':'v');
   centers[field].push((values[1]+values[0])/2);
  }
 }
 const value=radii.reduce((a,b)=>a+b,0)/radii.length,pixel=recon.modelSize.x/recon.drawing.top.sourceSize.w;
 return {...feature,...Object.fromEntries(Object.entries(centers).map(([k,vs])=>[k,vs.reduce((a,b)=>a+b,0)/vs.length])),r:(Math.abs(value-base)<=pixel*1.5?value:base)/(feature.role==='side'?s.y:s.x)};
}
export function orthogonalBossHypotheses(recon) {
 const {drawing:d,modelSize:s}=recon,out=[];
 if(['top','side'].some(r=>recon.inferredRoles.includes(r)))return out;
 const rings=r=>(d[r].curveDatums||[]).filter(c=>c.rx>.05&&c.u-c.rx>-.02&&c.u+c.rx<1.02).sort((a,b)=>b.rx-a.rx);
 const top=rings('top'),side=rings('side');if(top.length!==2||side.length!==2)return out;
 const [a,b]=top,[c,e]=side,tol=Math.max(.009,2/Math.min(d.top.sourceSize.w,d.side.sourceSize.w));
 if(Math.hypot(a.u-b.u,a.v-b.v)>tol||Math.hypot(c.u-e.u,c.v-e.v)>tol||Math.abs(a.v-c.u)>tol||Math.abs(c.rx-.5)>tol||Math.abs(a.ry-.5)>tol||b.rx>a.rx*.85||e.rx>c.rx*.85||c.v-c.ry<.04)return out;
 let R=c.rx*s.y,r=a.rx*s.x;let z=1-c.v;
 if(Math.abs(R-c.ry*s.z)>tol*s.x||Math.abs(r-a.ry*s.y)>tol*s.x)return out;
 const sourcePixel=(role,axis,extent)=>{
  const w=d[role],m=w.sourceMap;
  return extent*(m?Math.abs(m[axis+1][axis]-m[0][axis]):1/(axis?w.sourceSize.h:w.sourceSize.w));
 };
 const pixel=Math.max(sourcePixel('top',0,s.x),sourcePixel('side',0,s.y));
 // Equal measured radii are coupled only inside raster uncertainty. Otherwise
 // retain their difference and use the curved cylinder intersection equation.
 const uncertainty=pixel*1.5;
 if(Math.abs(R-r)<uncertainty)R=r=(R+r)/2;
 // A fitted circular rim touching the measured bottom must remain tangent
 // there after radius coupling; otherwise the bounding envelope slices off
 // a narrow strip and creates a real, spurious flat face in the CSG mesh.
 if(Math.abs(z*s.z-R)<2.25*sourcePixel('side',1,s.z))z=R/s.z;
 const centerY=Math.abs(a.v-c.u)*s.y<uncertainty?1-(a.v+c.u)/2:1-a.v;
 // A hidden generator may meet a circular rim: the traced path then turns
 // at the junction. Test its straight measured segments, not the whole path.
 const walls=(role,axis,at)=>{
  const w=d[role],map=w.sourceMap;
  const pixel=map?Math.abs(map[axis+1][axis]-map[0][axis]):1/(axis?w.sourceSize.h:w.sourceSize.w);
  const tolerance=Math.max(tol,2.25*pixel);
  return at.every(value=>w.paths.filter(p=>['h','t'].includes(p.lt)||(p.lt==='v'&&p.width<w.thickWidth*.75)).some(p=>!p.arc&&p.points.slice(1).some((b,i)=>Math.abs(p.points[i][axis]-value)<tolerance&&Math.abs(b[axis]-value)<tolerance&&Math.abs(b[1-axis]-p.points[i][1-axis])>.025)));
 };
 if(!walls('side',0,[c.u-b.rx*s.x/s.y,c.u+b.rx*s.x/s.y])||!walls('top',1,[a.v-e.rx,a.v+e.rx]))return out;
 // Require each upper intersection branch, allowing a gap where it crosses
 // a hidden generator. Use physical distances so unequal view scales work.
 const front=d.front;
 const measured=p=>front.sourceMap&&p.measuredPoints?.length?p.measuredPoints.map(q=>front.sourceMap[0].map((v,i)=>v+q[0]*(front.sourceMap[1][i]-v)+q[1]*(front.sourceMap[2][i]-v))):p.points;
 const branch=sign=>front.paths.filter(p=>!p.arc&&['v','t'].includes(p.lt)).flatMap(measured).filter(q=>{const x=(q[0]-a.u)*s.x,h=R*R-r*r+x*x;return h>=0&&sign*(q[0]-a.u)>.05&&sign*(q[0]-a.u)<a.rx*.98&&Math.abs((1-q[1])*s.z-(z*s.z+Math.sqrt(h)))<tol*s.x;});
 if(!recon.inferredRoles.includes('front')&&[-1,1].some(sign=>{const points=branch(sign);return points.length<3||Math.max(...points.map(q=>q[0]))-Math.min(...points.map(q=>q[0]))<.075;}))return out;
 const horizontal=jointBore(recon,{role:'side',u:1-centerY,v:e.v,r:e.rx,kind:'through',structural:true},[['top',1,1-centerY,s.y],['front',1,e.v,s.z]]);
 const vertical=jointBore(recon,{role:'top',u:b.u,v:1-centerY,r:b.rx,kind:'through',structural:true},[['side',0,1-centerY,s.y],['front',0,b.u,s.x]]);
 // A communicating bore ends in the horizontal passage. Extending it through
 // the lower shell creates an unsupported second mouth. Require both measured
 // upper walls to terminate at that passage and no lower wall evidence.
 const sidePixel=sourcePixel('side',1,1),wallTolerance=2.25*sourcePixel('side',0,1);
 const verticalWalls=[c.u-b.rx*s.x/s.y,c.u+b.rx*s.x/s.y].map(at=>d.side.paths.filter(p=>!p.arc&&['v','t','h'].includes(p.lt)&&p.points.length>1&&p.points.every(q=>Math.abs(q[0]-at)<wallTolerance)&&Math.max(...p.points.map(q=>q[1]))-Math.min(...p.points.map(q=>q[1]))>.025));
 if(verticalWalls.every((ps,i)=>{
  if(!ps.length)return false;
  const at=c.u+(i?1:-1)*b.rx*s.x/s.y,dx=(at-e.u)/e.rx;
  if(Math.abs(dx)>=1)return false;
  const end=e.v-e.ry*Math.sqrt(1-dx*dx),ys=ps.flatMap(p=>p.points.map(q=>q[1]));
  const dash=Math.min(.06,...ps.map(p=>Math.max(...p.points.map(q=>q[1]))-Math.min(...p.points.map(q=>q[1]))));
  // The last measured dash may stop one white gap before the circular mouth;
  // it may never continue past the independently measured intersection.
  return Math.min(...ys)<dash+2.25*sidePixel&&end-Math.max(...ys)<dash+2.25*sidePixel&&Math.max(...ys)-end<2.25*sidePixel;
 })) {
  vertical.axialRange=[1-e.v,1];
  vertical.evidence='左视两侧竖孔壁终止于横孔上缘，未见穿出下壁；竖孔仅与横向孔道连通';
 }
 out.push({family:'orthogonal-tube-vertical-boss',target:'front',components:[{axis:'x',x:.5,y:centerY,z,r:R/s.x,lo:0,hi:1},{axis:'z',x:a.u,y:centerY,z:.5,r:r/s.x,lo:z,hi:1}],boxes:[],features:[horizontal,vertical],explanation:['俯视同心圆给出竖直圆柱凸台和竖孔，左视同心圆给出横向圆管和横孔；两对孔壁线分别核对另一方向的孔径。',vertical.axialRange?'先将两个圆柱求并集，再减去横孔和上方连通孔。左视两侧孔壁在横孔上缘终止，保留下方管壁；该深度解释仍需回投核对。':'先将两个正圆柱求并集，再减去两个贯通孔。主视相贯分支来自外圆柱交线，下方凹弧来自竖孔与横管外壁交线。','用圆柱方程求相贯线，逐段判断前后遮挡。生成后分别回投主视、左视、俯视，检查缺线、多线和虚实线。']});
 return out;
}

export function classifyOrthogonalBossLines(recon,h) {
 const top=h.components.find(c=>c.axis==='z'),side=h.components.find(c=>c.axis==='x'),s=recon.modelSize;
 const centers={front:[top.x,1-side.z],top:[top.x,1-top.y],side:[1-side.y,1-side.z]};
 for(const [role,w] of Object.entries(recon.drawing)) {
  if(recon.inferredRoles.includes(role))continue;
  const datum=(w.curveDatums||[]).slice().sort((a,b)=>b.rx-a.rx)[0];
  const center=datum?[datum.u,datum.v]:centers[role];
  for(const axis of [0,1]) {
   const paths=w.paths.filter(p=>!p.arc&&p.points.length>1&&p.points.every(q=>Math.abs(q[axis]-center[axis])<.006));
   const values=paths.flatMap(p=>p.points.map(q=>q[1-axis]));
   // An axis must actually protrude beyond the measured outline; a line at
   // the centre of an object alone is not evidence of a centreline.
   if(values.length&&Math.min(...values)<-.015&&Math.max(...values)>1.015)for(const p of paths)p.lt='c';
  }
 }
 // Raster resizing can give thin dashes the same measured width as an outer
 // contour. Require separated runs on both independently measured bore-wall
 // supports before correcting that classification; do not bridge white gaps.
 const ft=h.features.find(f=>f.role==='top'),fs=h.features.find(f=>f.role==='side');
 for(const [role,axis,values] of [['side',0,[ft.v-ft.r*s.x/s.y,ft.v+ft.r*s.x/s.y]],['top',1,[fs.u-fs.r,fs.u+fs.r]],['front',0,[ft.u-ft.r,ft.u+ft.r]],['front',1,[fs.v-fs.r*s.y/s.z,fs.v+fs.r*s.y/s.z]]]) {
  if(recon.inferredRoles.includes(role))continue;
  const w=recon.drawing[role],tol=Math.max(2.25,w.thickWidth)/(axis?w.sourceSize.h:w.sourceSize.w);
  for(const value of values){const ps=w.paths.filter(p=>!p.arc&&p.lt!=='c'&&p.points.length>1&&p.points.every(q=>Math.abs(q[axis]-value)<tol));
   const runs=ps.map(p=>[Math.min(...p.points.map(q=>q[1-axis])),Math.max(...p.points.map(q=>q[1-axis]))]).filter(r=>r[1]-r[0]>.008).sort((a,b)=>a[0]-b[0]);
   const thinPair=values.every(at=>w.paths.some(p=>!p.arc&&p.lt!=='c'&&p.width<w.thickWidth*.75&&p.points.length>1&&p.points.every(q=>Math.abs(q[axis]-at)<tol)&&Math.max(...p.points.map(q=>q[1-axis]))-Math.min(...p.points.map(q=>q[1-axis]))>.025));
   if((runs.length>=3&&runs.some((r,i)=>i&&r[0]-runs[i-1][1]>.008))||thinPair)for(const p of ps){p.lt='h';p.dashFragment=true;}
  }
 }
 const front=recon.drawing.front;if(recon.inferredRoles.includes('front'))return;
 const R=side.r*s.x,r=top.r*s.x,z=side.z*s.z;
 for(const p of front.paths) {
  if(p.arc||p.lt==='c'||p.points.length<2)continue;
  const probes=p.points.filter(q=>Math.abs(q[0]-top.x)>.015),tol=Math.max(2.25,front.thickWidth)*s.x/front.sourceSize.w;
  if(!probes.length)continue;
  const on=(a,b,sign)=>probes.filter(q=>{const x=(q[0]-top.x)*s.x,d=a*a-b*b+x*x;return d>=0&&Math.abs((1-q[1])*s.z-z-sign*Math.sqrt(d))<tol;}).length>=Math.ceil(probes.length*.8);
  if(on(R,r,1))p.lt='v';
  else if(probes.every(q=>Math.abs(q[0]-top.x)<ft.r+.008)&&[1,-1].some(sign=>on(fs.r*s.y,ft.r*s.x,sign))) {p.lt='h';p.dashFragment=true;}
 }
}

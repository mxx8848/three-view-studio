import {extractUploadLines,simplify,circleFit} from './upload-lines.js';

const median=a=>a.sort((a,b)=>a-b)[Math.floor(a.length/2)];
function regression(points,axis) {
 const n=points.length,m=points.reduce((s,p)=>s+p[1-axis],0)/n,b=points.reduce((s,p)=>s+p[axis],0)/n;
 const den=points.reduce((s,p)=>s+(p[1-axis]-m)**2,0);if(!den)return null;
 const slope=points.reduce((s,p)=>s+(p[1-axis]-m)*(p[axis]-b),0)/den;
 return {slope,intercept:b-slope*m};
}
function solve(a) {
 for(let i=0;i<8;i++){
  let k=i;for(let j=i+1;j<8;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;
  if(Math.abs(a[k][i])<1e-10)return null;[a[i],a[k]]=[a[k],a[i]];
  const d=a[i][i];for(let j=i;j<=8;j++)a[i][j]/=d;
  for(let k=0;k<8;k++)if(k!==i){const d=a[k][i];for(let j=i;j<=8;j++)a[k][j]-=d*a[i][j];}
 }return [...a.map(r=>r[8]),1];
}
const apply=(h,[x,y])=>{const d=h[6]*x+h[7]*y+h[8];return [(h[0]*x+h[1]*y+h[2])/d,(h[3]*x+h[4]*y+h[5])/d];};
function transform(from,to){const rows=[];for(let i=0;i<4;i++){const[x,y]=from[i],[u,v]=to[i];rows.push([x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]);}return solve(rows);}

function measuredEllipse(work) {
 const scale=Math.min(work.w,work.h),center=[work.w/2,work.h/2];
 const points=work.paths.filter(p=>p.lt==='v'&&p.measuredPoints?.length>scale*.18).filter(p=>{
  const fit=circleFit(p.measuredPoints,5);return fit&&fit.r>scale*.22&&fit.r<scale*.8&&fit.error<.04;
 }).flatMap(p=>p.measuredPoints);
 if(points.length<scale*1.5)return null;
 const rows=points.map(p=>{const[x,y]=p.map((v,k)=>(v-center[k])/scale);return [x*x,x*y,y*y,x,y];}),a=Array.from({length:5},()=>Array(6).fill(0));
 for(const row of rows)for(let i=0;i<5;i++){for(let j=0;j<5;j++)a[i][j]+=row[i]*row[j];a[i][5]+=row[i];}
 for(let i=0;i<5;i++){let k=i;for(let j=i+1;j<5;j++)if(Math.abs(a[j][i])>Math.abs(a[k][i]))k=j;if(Math.abs(a[k][i])<1e-10)return null;[a[i],a[k]]=[a[k],a[i]];const d=a[i][i];for(let j=i;j<=5;j++)a[i][j]/=d;for(let k=0;k<5;k++)if(k!==i){const d=a[k][i];for(let j=i;j<=5;j++)a[k][j]-=d*a[i][j];}}
 const[A,B,C,D,E]=a.map(r=>r[5]),det=A*C-B*B/4;if(det<=0)return null;
 const cx=(B*E/2-C*D)/(2*det),cy=(B*D/2-A*E)/(2*det),f=1+A*cx*cx+B*cx*cy+C*cy*cy;
 const angle=Math.atan2(B,A-C)/2,co=Math.cos(angle),si=Math.sin(angle),l1=(A*co*co+B*co*si+C*si*si)/f,l2=(A*si*si-B*co*si+C*co*co)/f;
 if(l1<=0||l2<=0)return null;
 const r1=scale/Math.sqrt(l1),r2=scale/Math.sqrt(l2),r=(r1+r2)/2,c=[center[0]+cx*scale,center[1]+cy*scale];
 if(Math.max(r1,r2)/Math.min(r1,r2)>1.2||r<scale*.3||r>scale*.55)return null;
 const bins=new Set();let bad=0;
 for(const p of points){const x=p[0]-c[0],y=p[1]-c[1],u=(x*co+y*si)/r1,v=(-x*si+y*co)/r2;if(Math.abs(Math.hypot(u,v)-1)*r>2.25)bad++;bins.add(Math.floor(((Math.atan2(v,u)+Math.PI*2)%(Math.PI*2))*36/(Math.PI*2)));}
 if(bad>points.length*.04||bins.size<34)return null;
 const xx=r/r1*co*co+r/r2*si*si,xy=(r/r1-r/r2)*co*si,yy=r/r1*si*si+r/r2*co*co;
 const forward=[xx,xy,c[0]-xx*c[0]-xy*c[1],xy,yy,c[1]-xy*c[0]-yy*c[1],0,0,1];
 return {forward,c,r,points:points.length};
}

// Correct only a coherent photograph frame, before thinning and curve fitting.
// Long measured near-axis supports establish the frame; genuine inclines are
// never used as axes. All four masks receive exactly the same inverse warp.
export function extractPhotoLines(input,calibration=null) {
 const raw=extractUploadLines(input),{w,h}=input,span=Math.min(w,h),supports=[[],[]];
 for(const p of raw.paths.filter(p=>p.lt!=='ignore')) {
  const points=p.measuredPoints||p.points,vertices=simplify(points,Math.max(.85,raw.thickWidth*.22));
  for(let i=1;i<vertices.length;i++){
   const a=vertices[i-1],b=vertices[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
   const axis=Math.abs(dx)<Math.abs(dy)*.13?0:Math.abs(dy)<Math.abs(dx)*.13?1:-1;
   if(axis<0||len<span*.08)continue;
   const lo=Math.min(a[1-axis],b[1-axis]),hi=Math.max(a[1-axis],b[1-axis]);
   const dense=points.filter(q=>q[1-axis]>=lo&&q[1-axis]<=hi&&Math.abs((q[0]-a[0])*dy-(q[1]-a[1])*dx)/len<2);
   const fit=regression(dense,axis);if(!fit)continue;
   const rms=Math.sqrt(dense.reduce((s,p)=>s+(p[axis]-fit.slope*p[1-axis]-fit.intercept)**2,0)/dense.length);
   if(rms>.9)continue;
   supports[axis].push({...fit,lo,hi,len,visible:p.lt==='v'||p.lt!=='c'&&p.width>=Math.max(2,raw.thickWidth*.7),width:p.width});
  }
 }
 const visible=raw.paths.filter(p=>p.lt==='v'&&p.length>span*.1).flatMap(p=>p.points);
 if(!visible.length)return raw;
 const lo=[0,1].map(k=>Math.min(...visible.map(p=>p[k]))),hi=[0,1].map(k=>Math.max(...visible.map(p=>p[k])));
 const edges=[0,1].map(axis=>[lo[axis],hi[axis]].map(at=>{
  const near=supports[axis].filter(s=>s.visible&&Math.abs(s.slope*((axis?w:h)/2)+s.intercept-at)<(hi[axis]-lo[axis])*.09);
  // A partial shoulder is not the outside of a rectangular photo frame.
  // Require most of each side, otherwise a stepped/forked outline supplies
  // four unrelated supports and creates a false projective distortion.
  if(near.reduce((sum,s)=>sum+s.len,0)<(hi[1-axis]-lo[1-axis])*.7)return null;
  const points=near.flatMap(s=>[[s.slope*s.lo+s.intercept,s.lo],[s.slope*s.hi+s.intercept,s.hi]].map(p=>axis?[p[1],p[0]]:p));
  return regression(points,axis);
 }));
 let forward,inverse,method;
 if(edges.flat().every(Boolean)) {
  const intersect=(v,h)=>{const x=(v.slope*h.intercept+v.intercept)/(1-v.slope*h.slope);return [x,h.slope*x+h.intercept];};
  const from=[intersect(edges[0][0],edges[1][0]),intersect(edges[0][1],edges[1][0]),intersect(edges[0][1],edges[1][1]),intersect(edges[0][0],edges[1][1])];
  const to=[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]];
  forward=transform(from,to);inverse=transform(to,from);method='four-supported-sides';
 }else if(supports.every(ss=>ss.length>=2)) {
  const slopes=supports.map(ss=>median(ss.map(s=>s.slope)));
  // Several skeleton fragments of ONE inclined face are still only one
  // direction datum. A shear needs widely separated parallel supports.
  const independent=supports.every((ss,k)=>{
   const offsets=ss.filter(s=>Math.abs(s.slope-slopes[k])<.018).map(s=>s.slope*(k?w:h)/2+s.intercept);
   return offsets.length>=2&&Math.max(...offsets)-Math.min(...offsets)>span*.10;
  });
  if(independent&&!supports.some(ss=>ss.reduce((sum,s)=>sum+s.len,0)<span*.35)){
   const [v,u]=slopes,cx=w/2,cy=h/2;
   forward=[1,-v,v*cy,-u,1,u*cx,0,0,1];
   const from=[[0,0],[w,0],[w,h],[0,h]],to=from.map(p=>apply(forward,p));inverse=transform(to,from);method='paired-measured-directions';
  }
 }
 const ellipse=measuredEllipse(raw);
 if(ellipse&&method==='paired-measured-directions'){
  forward=ellipse.forward;const from=[[0,0],[w,0],[w,h],[0,h]],to=from.map(p=>apply(forward,p));inverse=transform(to,from);method='complete-measured-ellipse';
 }
 if(calibration){
  const {box,reference,h:homography}=calibration,from=[[0,0],[w,0],[w,h],[0,h]];
  const global=p=>apply(homography,[p[0]+box.x-reference.x,p[1]+box.y-reference.y]);
  const projected=from.map(global),minimum=[0,1].map(k=>Math.min(...projected.map(p=>p[k]))),maximum=[0,1].map(k=>Math.max(...projected.map(p=>p[k]))),center=minimum.map((v,k)=>(v+maximum[k])/2);
  const fit=calibration.fit??Math.min(1,(w-2)/(maximum[0]-minimum[0]),(h-2)/(maximum[1]-minimum[1]));
  const to=projected.map(p=>p.map((v,i)=>(v-center[i])*fit+[w/2,h/2][i]));
  forward=transform(from,to);inverse=transform(to,from);method='shared-photo-plane';
 }
 if(!forward||!inverse)return raw;
 const corners=[[0,0],[w,0],[w,h],[0,h]],drift=Math.max(...corners.map(p=>Math.hypot(...apply(forward,p).map((v,i)=>v-p[i]))));
 // Clean scans stay byte-for-byte on the established recognition path.
 if(drift<Math.max(1.5,span*.009)||drift>span*.16)return raw;
 const masks={};
 for(const name of ['mask','colorMask','darkMask','blackMask'])if(input[name]){
  const out=new Uint8Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const p=apply(inverse,[x,y]),xx=Math.round(p[0]),yy=Math.round(p[1]);
   if(xx>=0&&xx<w&&yy>=0&&yy<h)out[y*w+x]=input[name][yy*w+xx];
  }masks[name]=out;
 }
 const result=extractUploadLines({...masks,w,h});
 result.photoCorrection={method,forward,inverse,maxDisplacement:drift,sourceSize:{w,h}};
 return result;
}

export function extractPhotoViews(inputs,boxes) {
 const works=Object.fromEntries(Object.entries(inputs).map(([role,input])=>[role,extractPhotoLines(input)]));
 const reference=Object.entries(works).filter(([,w])=>w.photoCorrection?.method==='four-supported-sides').sort((a,b)=>b[1].w*b[1].h-a[1].w*a[1].h)[0];
 if(reference){
 const h=reference[1].photoCorrection.forward,ref=boxes[reference[0]];
 const fit=Math.min(1,...Object.entries(inputs).flatMap(([role,{w,h:height}])=>{
  const box=boxes[role],ps=[[0,0],[w,0],[w,height],[0,height]].map(p=>apply(h,[p[0]+box.x-ref.x,p[1]+box.y-ref.y]));
  return [0,1].map(k=>([w,height][k]-2)/(Math.max(...ps.map(p=>p[k]))-Math.min(...ps.map(p=>p[k]))));
 }));
 for(const role of Object.keys(works)){
  const corrected=extractPhotoLines(inputs[role],{box:boxes[role],reference:ref,h,fit});
  if(corrected.photoCorrection?.method==='shared-photo-plane')works[role]=corrected;
 }
 }
 return works;
}

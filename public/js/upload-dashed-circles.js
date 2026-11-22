import {circleFit} from './upload-lines.js';

// Broken circular ink cannot be found by closed-loop tracing. Propose circles
// at measured axis supports, then require distributed radial ink and repeated
// white gaps. No missing-view or model coordinates enter this measurement.
export function measuredDashedCircles(work) {
 const groups=[[],[]],pixel=Math.max(1,Math.min(work.w,work.h)/600);
 for(const p of work.paths.filter(p=>p.width<work.thickWidth*.65))for(let i=1;i<p.points.length;i++) {
  const a=p.points[i-1],b=p.points[i];
  for(const axis of [0,1])if(Math.abs(a[axis]-b[axis])<pixel*.5&&Math.abs(a[1-axis]-b[1-axis])>8*pixel) {
   const value=(a[axis]+b[axis])/2;let g=groups[axis].find(g=>Math.abs(g.value-value)<pixel);
   if(!g){g={value,length:0};groups[axis].push(g);}g.length+=Math.abs(a[1-axis]-b[1-axis]);
  }
 }
 const points=work.paths.filter(p=>p.width<work.thickWidth*.65).flatMap(p=>p.measuredPoints||p.points),out=[];
 for(const gx of groups[0].filter(g=>g.length>30*pixel))for(const gy of groups[1].filter(g=>g.length>30*pixel)) {
  const hist=new Map();
  for(const p of points){const r=Math.hypot(p[0]-gx.value,p[1]-gy.value),bin=Math.round(r/pixel);hist.set(bin,(hist.get(bin)||0)+1);}
  const peaks=[...hist].filter(([bin,n])=>bin>12&&bin<Math.min(work.w,work.h)*.48/pixel&&n>18).sort((a,b)=>b[1]-a[1]);
  for(const [bin] of peaks) {
   let fit={cx:gx.value,cy:gy.value,r:bin*pixel};
   for(let j=0;j<3;j++) {
    const near=points.filter(p=>Math.abs(Math.hypot(p[0]-fit.cx,p[1]-fit.cy)-fit.r)<1.4*pixel);
    fit=circleFit(near);if(!fit)break;
   }
   if(!fit||fit.error>.025||Math.hypot(fit.cx-gx.value,fit.cy-gy.value)>2.25*pixel||out.some(c=>Math.hypot(c.cx-fit.cx,c.cy-fit.cy)<2*pixel&&Math.abs(c.r-fit.r)<2*pixel))continue;
   const count=Math.max(180,Math.ceil(2*Math.PI*fit.r)),ink=work.inkMask||work.mask,occupied=[];
   if(!ink)continue;
   for(let i=0;i<count;i++) {
    const angle=i*2*Math.PI/count;let hit=false;
    for(const dr of [-1,0,1]){const x=Math.round(fit.cx+(fit.r+dr)*Math.cos(angle)),y=Math.round(fit.cy+(fit.r+dr)*Math.sin(angle));if(x>=0&&y>=0&&x<work.w&&y<work.h&&ink[y*work.w+x])hit=true;}
    occupied.push(hit);
   }
   const coverage=occupied.filter(Boolean).length/count,empty=occupied.findIndex(v=>!v),gaps=[];let length=0;
   for(let j=1;j<=count;j++){if(!occupied[(empty+j)%count])length++;else if(length){gaps.push(length);length=0;}}
   if(length)gaps.push(length);
   const substantial=gaps.filter(v=>v>=3),typical=[...substantial].sort((a,b)=>a-b)[Math.floor(substantial.length/2)];
   const quarters=[0,1,2,3].every(k=>occupied.slice(Math.floor(k*count/4),Math.floor((k+1)*count/4)).filter(Boolean).length>count*.035);
   if(coverage<.3||coverage>.9||!quarters||substantial.length<5||substantial.filter(v=>v>=typical*.45&&v<=typical*1.8).length/substantial.length<.7)continue;
   out.push({...fit,spans:[[0,Math.PI*2]],dashed:true,coverage,gaps:substantial.length});
  }
 }
 return out;
}

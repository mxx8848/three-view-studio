import {measuredCircles} from './upload-primitives.js';
import {measuredDashedCircles} from './upload-dashed-circles.js';

export function tangentWebProfile(small,r,big,R,aspect=1) {
 const dx=big.u-small.u,dy=(big.v-small.v)*aspect,d=Math.hypot(dx,dy),a=(r-R)/d;
 if(!Number.isFinite(a)||Math.abs(a)>=1)return null;
 const b=Math.sqrt(1-a*a),normals=[-1,1].map(sign=>[a*dx/d-sign*b*dy/d,a*dy/d+sign*b*dx/d]);
 const contact=(c,r,n)=>[c.u+r*n[0],c.v+r*n[1]/aspect];
 return [contact(small,r,normals[0]),contact(big,R,normals[0]),contact(big,R,normals[1]),contact(small,r,normals[1])];
}

// A measured axis crosses a circular centre and extends beyond its rim. A
// bore wall is offset from that centre and cannot satisfy this condition.
export function classifyCompoundAxes(recon,{includeVisible=false}={}) {
 for(const [role,w] of Object.entries(recon.drawing)) {
  if(recon.inferredRoles?.includes(role))continue;
  const groups=[];
  for(const path of w.paths.filter(p=>!p.arc&&!p.colored&&(includeVisible?['v','h','t','c']:['h','t','c']).includes(p.lt)&&p.width<w.thickWidth*.8)) {
   const ps=path.points;
   for(const axis of [0,1]) {
    const values=ps.map(p=>p[axis]);if(Math.max(...values)-Math.min(...values)>.003)continue;
    const value=values.reduce((s,v)=>s+v,0)/values.length;
    let g=groups.find(g=>g.axis===axis&&Math.abs(g.value-value)<.003);
    if(!g){g={axis,value,paths:[],ends:[]};groups.push(g);}g.paths.push(path);g.ends.push(...ps.map(p=>p[1-axis]));
   }
  }
  for(const g of groups) {
   const lo=Math.min(...g.ends),hi=Math.max(...g.ends);
   const centered=(w.curveDatums||[]).some(c=>Math.abs(g.value-(g.axis?c.v:c.u))<.004&&lo<(g.axis?c.u-c.rx:c.v-c.ry)-.012&&hi>(g.axis?c.u+c.rx:c.v+c.ry)+.012);
   const other=role==='front'?'top':role==='top'?'front':null;
   const transferred=(other&&g.axis===0&&lo<1&&hi>1.015&&hi-lo>.2&&(recon.drawing[other]?.curveDatums||[]).some(c=>Math.abs(c.u-g.value)<.004))||role==='side'&&g.axis===0&&lo<1&&hi>1.015&&hi-lo>.2&&(recon.drawing.top?.curveDatums||[]).some(c=>Math.abs(c.v-g.value)<.004);
   const endAxis=role==='side'&&g.axis===1&&lo<-.015&&hi>.2&&(recon.drawing.front?.curveDatums||[]).some(c=>Math.abs(c.v-g.value)<.004);
   if(centered||transferred||endAxis)for(const path of g.paths)path.lt='c';
  }
 }
}

// Read measured circles in the same affine frame as the drawing. This also
// supports mixed circular outlines with long straight tangent connections.
export function compoundHypotheses(recon,linework) {
 const out=[],s=recon.modelSize;
 if(!recon.inferredRoles?.length||!['front','top','side'].every(role=>recon.drawing?.[role]?.sourceMap?.length===3&&linework[role]?.paths))return out;
 const map=(role,p)=>{const [a,b,c]=recon.drawing[role].sourceMap;return a.map((v,i)=>v+p[0]*(b[i]-v)+p[1]*(c[i]-v));};
 const circles=(role,hidden=false)=>{const w=linework[role],visible=measuredCircles(hidden?{...w,paths:w.paths.map(p=>({...p,lt:p.lt==='ignore'?'ignore':'v'}))}:w),all=hidden?[...visible,...measuredDashedCircles(w).filter(c=>!visible.some(v=>Math.hypot(c.cx-v.cx,c.cy-v.cy)<2&&Math.abs(c.r-v.r)<2))]:visible;return all.map(c=>{const p=map(role,[c.cx,c.cy]),q=map(role,[c.cx+c.r,c.cy]),r=map(role,[c.cx,c.cy+c.r]);return {u:p[0],v:p[1],r:Math.abs(q[0]-p[0]),ry:Math.abs(r[1]-p[1]),span:c.spans.reduce((n,[a,b])=>n+b-a,0)};});};
 const lines=role=>recon.drawing[role].paths.filter(p=>p.lt==='v'&&!p.arc).flatMap(p=>p.points.slice(1).map((b,i)=>[p.points[i],b]));
 const rect=(a,b,c,d)=>[[a,c],[b,c],[b,d],[a,d],[a,c]];
 if(recon.inferredRoles.includes('front')&&recon.drawing.top.type==='circle') {
  const top=circles('top').filter(c=>c.span>6).sort((a,b)=>b.r-a.r),side=circles('side',true).filter(c=>c.span>5.5).sort((a,b)=>a.v-b.v);
  if(top.length===3&&side.length===4){
   const upper=side.slice(0,2).sort((a,b)=>b.r-a.r),lower=side.slice(2).sort((a,b)=>b.r-a.r),outer=top[0],column=top[1],bore=top[2];
   const verts=lines('top').filter(([a,b])=>Math.abs(a[0]-b[0])<.005&&Math.abs(a[1]-b[1])>.06&&a[0]>.02&&a[0]<.98).map(([a])=>a[0]),horiz=lines('top').filter(([a,b])=>Math.abs(a[1]-b[1])<.005&&Math.abs(a[0]-b[0])>.2).map(([a])=>a[1]);
   const left=Math.min(...verts),right=Math.max(...verts),base=1-lower[0].v;
   const step=lines('side').filter(([a,b])=>Math.abs(a[1]-b[1])<.005&&a[1]>.7&&a[1]<.95&&Math.abs(a[0]-b[0])>.03).map(([a])=>1-a[1]).sort((a,b)=>a-b)[0];
   const flat=Math.max(...horiz.filter(v=>v>.85&&v<.98));
   // Unequal intersecting bores are still valid members of this family.
   // Radius equality is a measured relationship to test, not a prerequisite
   // for proposing the solid or permission to copy one hole's diameter.
   if(left>.02&&left<.2&&right>.8&&right<.98&&step&&flat&&lower[1].r<lower[0].r&&upper[1].r<upper[0].r){
    const components=[{axis:'z',x:.5,y:.5,z:.5,r:.5,lo:0,hi:step},{axis:'z',x:.5,y:.5,z:.5,r:.5,lo:step,hi:base},{axis:'z',x:.5,y:.5,z:.5,r:column.r,lo:base,hi:1},{axis:'x',x:.5,y:1-lower[0].u,z:base,r:lower[0].r*s.y/s.x,lo:left,hi:.5},{axis:'x',x:.5,y:1-upper[0].u,z:1-upper[0].v,r:upper[0].r*s.y/s.x,lo:.5,hi:right}];
    const features=[{role:'top',u:.5,v:.5,r:bore.r,kind:'through'},{role:'side',u:lower[1].u,v:lower[1].v,r:lower[1].r,kind:'through',axialRange:[left,.5]},{role:'side',u:upper[1].u,v:upper[1].v,r:upper[1].r,kind:'through',axialRange:[.5,right]},{role:'side',u:lower[0].u,v:lower[0].v,r:lower[0].r,kind:'through',axialRange:[0,left]},...[[0,1-flat],[flat,1]].map(([a,b])=>({role:'top',profile:rect(0,1,a,b),kind:'pocket',depth:1-step}))];
    out.push({family:'stepped-cylinder-offset-tubes',requiresReview:true,target:'front',components,features,flange:{step,base,flat},boxes:[],measurements:{top:{envelope:outer,column,bore},side:{upper,lower}},explanation:['俯视的三圈同心圆确定圆底座、竖直立柱和竖孔；左视的两组不同高度同心圆分别确定两侧圆管与横孔，虚线圆也必须作为结构证据。','两侧管口端面由俯视的直壁限定，横孔分别接入中央竖孔。底座两条弦及左视台阶限定局部削平的高度，不能把整圈底座削低。','主视的实线交界与孔内虚线均由圆柱方程联立求交，逐段核对前后材料遮挡；管口位置与底座外圆共同约束。']});
   }
  }
 }
 if(recon.inferredRoles.includes('side')) {
  const top=circles('top'),front=circles('front'),main=top.filter(c=>c.span>6).sort((a,b)=>b.r-a.r);
  if(main.length>=2&&front.length===1){
   const outer=top.toSorted((a,b)=>b.r-a.r)[0],big=main.find(c=>Math.abs(c.u-outer.u)<.015&&c.r<outer.r*.8),inner=big&&main.find(c=>Math.hypot(c.u-big.u,c.v-big.v)<.015&&c.r<big.r*.8),small=big&&main.find(c=>c.u<big.u-.25),bore=front[0];
   const levels=lines('front').filter(([a,b])=>Math.abs(a[1]-b[1])<.006&&Math.abs(a[0]-b[0])>.08).map(([a])=>a[1]);
   const lower=levels.filter(v=>v>.6&&v<.9).sort((a,b)=>b-a)[0],shoulder=levels.filter(v=>v>.35&&v<.7).sort((a,b)=>a-b)[0];
   if(inner&&small&&outer.r>big.r*1.3&&outer.u>big.u-.02&&Math.abs(bore.u-big.u)<.025&&lower&&shoulder){
    const smallCircles=top.filter(c=>Math.hypot(c.u-small.u,c.v-small.v)<.035&&c.r>small.r*1.4).sort((a,b)=>a.r-b.r);
    const smallOuter=smallCircles[0],smallRelief=smallCircles.at(-1);
    if(smallOuter&&smallRelief&&smallRelief.r>smallOuter.r+.01){
     const R=outer.r,r=smallOuter.r;
     // True common tangents use the full measured centre vector. Assuming
     // equal raster rows introduces tiny corners, projected as long false
     // vertical seams even when the circles differ by less than one pixel.
     const profile=tangentWebProfile(small,r,big,R,s.y/s.x);
     if(!profile)return out;
     const components=[{axis:'z',x:big.u,y:1-big.v,z:.5,r:R,lo:0,hi:1},{axis:'z',x:small.u,y:1-small.v,z:.5,r:r,lo:0,hi:1-lower}];
     const features=[{role:'top',u:big.u,v:big.v,r:inner.r,kind:'through'},{role:'top',u:big.u,v:big.v,r:big.r,kind:'through',axialRange:[1-lower,1]},{role:'top',u:small.u,v:small.v,r:small.r,kind:'through'},{role:'top',u:small.u,v:small.v,r:smallRelief.r,kind:'through',axialRange:[1-lower,1-shoulder]},{role:'front',u:bore.u,v:bore.v,r:bore.r,kind:'through'},{role:'front',profile:rect(bore.u-bore.r,bore.u+bore.r,0,bore.v),kind:'through',axialRange:[0,.5]}];
     out.push({family:'tangent-base-stepped-tube',requiresReview:true,target:'side',components,profiles:[{points:profile,lo:0,hi:1-shoulder}],features,boxes:[],shoulder:1-shoulder,mainRadius:big.r,measurements:{top:{envelope:outer,counterbore:big,bore:inner,smallOuter,smallBore:small,smallRelief},front:{bore}},explanation:['俯视的大、小端圆弧和两条公切线确定连接体；主视的两个高度台阶区分小端底脚、连接台和高圆筒，不能整体等高拉伸。','大端同心圆与主视隐藏台阶共同确定有底的沉孔及下部通孔。小端通孔和中间高度的圆弧退让分别取实测孔径，不能复制大端尺寸。','主视圆孔与上方两条直壁组成横孔及单侧U形开口槽。用俯视可见槽壁区分前后方向，再求圆筒、沉孔与槽壁的交线并判断虚实。']});
    }
   }
  }
 }
 return out;
}

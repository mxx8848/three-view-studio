import { maskLoops, simplify } from './upload-lines.js';

const NAMES={front:'主视图',top:'俯视图',side:'左视图'};
const pathData=points=>points.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(' ');

// Keep measured circles as analytic SVG arcs at every display zoom. Geometry
// samples remain available for modelling, but the screen never traces pixels.
function measuredPathData(path) {
  const c=path.analyticArc;if(!c)return pathData(path.points);
  const span=c.to-c.from,n=Math.max(1,Math.ceil(Math.abs(span)/Math.PI));
  const at=a=>`${(c.u+c.rx*Math.cos(a)).toFixed(6)},${(c.v+c.ry*Math.sin(a)).toFixed(6)}`;
  let d=`M${at(c.from)}`;
  for(let i=1;i<=n;i++)d+=` A${c.rx.toFixed(6)},${c.ry.toFixed(6)} 0 0 ${span>=0?1:0} ${at(c.from+span*i/n)}`;
  return d;
}

// Join actual projected edges into paths. Curve anchors teach a few meaningful
// points while the exact projected arc is drawn between them, never a chord.
export function projectedLessonPaths(lines,minLength=.025) {
  const paths=[];
  for(const category of ['outline','visible','hidden']) {
    const lt=category==='hidden'?'h':'v';
    const vertices=new Map(),edges=[],seen=new Set(),keys=new Set();
    const vertex=(p,world)=>{const key=p.map(v=>Math.round(v*1000000)).join(',');if(!vertices.has(key))vertices.set(key,{p,world,edges:[]});return key;};
    for(const line of lines.filter(p=>p.lt===lt&&(lt==='h'||!!p.boundary===(category==='outline')))) {
      const a=vertex(line.p[0],line.world?.[0]),b=vertex(line.p[1],line.world?.[1]);
      const k=[a,b].sort().join('|');if(a===b||keys.has(k))continue;keys.add(k);
      const id=edges.length;edges.push([a,b,line.construction]);vertices.get(a).edges.push(id);vertices.get(b).edges.push(id);
    }
    const trace=(start,edge)=>{
      const chain=[vertices.get(start)],methods=new Set();let at=start,id=edge;
      while(!seen.has(id)) {
        seen.add(id);const [a,b,method]=edges[id];methods.add(method);at=at===a?b:a;const v=vertices.get(at);chain.push(v);
        if(v.edges.length!==2)break;const next=v.edges.find(i=>!seen.has(i));if(next===undefined)break;id=next;
      }
      const length=chain.slice(1).reduce((s,p,i)=>s+Math.hypot(p.p[0]-chain[i].p[0],p.p[1]-chain[i].p[1]),0);
      // Short CSG junction spans can close a genuine contour. Dropping them
      // leaves gaps in a completed missing view, especially around cutouts.
      if(length<Math.max(.0000001,minLength))return;
      const closed=chain[0]===chain.at(-1),points=chain.map(v=>v.p),mid=Math.floor(points.length/2);
      const anchors=closed?[...simplify(points.slice(0,mid+1),.025).slice(0,-1),...simplify(points.slice(mid),.025)]:simplify(points,.025);
      let from=0;
      for(const anchor of anchors.slice(1)) {
        const to=points.indexOf(anchor,from+1);if(to<0)continue;
        paths.push({points:points.slice(from,to+1),a:chain[from],b:chain[to],lt,construction:methods.has('auxiliary-plane')?'auxiliary-plane':methods.has('section-generators')?'section-generators':undefined,stage:category==='outline'?0:category==='visible'?1:2});from=to;
      }
    };
    for(const [key,v] of vertices)if(v.edges.length!==2)for(const id of v.edges)if(!seen.has(id))trace(key,id);
    for(let id=0;id<edges.length;id++)if(!seen.has(id))trace(edges[id][0],id);
  }
  return paths;
}

export function boardLayout(size) {
  const scale=330/Math.max(size.x,size.y,size.z),w=size.x*scale,d=size.y*scale,h=size.z*scale;
  const left=60,top=60,gap=95,sx=left+w+gap,ty=top+h+gap;
  return {w,d,h,left,top,sx,ty,width:sx+d+65,height:ty+d+65};
}

export function constructionPlan(recon,linework=null,selectedTarget=null) {
  if(recon.drawing)linework=recon.drawing;
  const bounds=role=>recon.drawing?{x:0,y:0,w:1,h:1}:recon.silhouetteBounds[role];
  const target=selectedTarget||recon.completionRole||recon.inferredRoles[0]||'side',n=recon.res;
  if(recon.profileStructureFit?.unresolved){
    const kind=recon.viewStates?.[target]?.kind,blank=kind==='blank'||kind==='reference';
    return {target,points:[],edges:[],blank,partial:kind==='partial',autonomous:blank,fromModel:false,total:1,contourReview:!!recon.contourReviewRoles?.length,unresolved:recon.lessonError||'孔槽结构尚未通过核对'};
  }
  const projected=recon.lessonProjections?projectedLessonPaths(recon.completionProjections?.[target]||recon.lessonProjections[target],0):null;
  const uv=(p,role)=>role==='front'?[p.x,1-p.z]:role==='top'?[p.x,1-p.y]:[1-p.y,1-p.z];
  // Find support in BOTH source views, rather than choosing the first occupied voxel.
  const sourceRoles=['front','top','side'].filter(role=>role!==target);
  const sourceSegments=Object.fromEntries(sourceRoles.map(role=>{
    const b=bounds(role);
    return [role,(linework?.[role]?.paths||[]).filter(p=>p.lt==='v'||p.lt==='h').flatMap(p=>p.points.slice(1).map((q,i)=>[p.points[i],q].map(a=>[(a[0]-b.x)/b.w,(a[1]-b.y)/b.h])))];
  }));
  const sourceDistance=(p,role)=>{
    const q=uv(p,role);let best=1;
    for(const [a,b] of sourceSegments[role]){
      const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
      best=Math.min(best,Math.hypot(q[0]-a[0]-dx*t,q[1]-a[1]-dy*t));
    }
    return best;
  };
  const supportTolerance=role=>{
    const size=linework?.[role]?.sourceSize;
    return size?Math.min(.01,1.5/Math.min(size.w,size.h)):.025;
  };
  // The target fixes two coordinates. Its third coordinate is free along the
  // viewing ray: choose the common measured intersection in both known views,
  // rather than the arbitrary front/back mesh vertex returned by CSG.
  const registerPoint=p=>{
    const axis=target==='side'?'x':target==='front'?'y':'z',candidates=[p[axis]];
    for(const role of sourceRoles)for(const [a,b] of sourceSegments[role]) {
      const free=role==='front'?(axis==='x'?0:1):role==='top'?(axis==='x'?0:1):(axis==='y'?0:1),fixed=1-free,q=uv(p,role),delta=b[fixed]-a[fixed];
      if(Math.abs(delta)<1e-10)continue;
      const t=(q[fixed]-a[fixed])/delta;if(t<0||t>1)continue;
      const value=a[free]+t*(b[free]-a[free]);candidates.push(axis==='x'?value:1-value);
    }
    let best=p,error=Infinity;
    for(const value of candidates) {
      if(Math.abs(value-p[axis])>Math.min(.01,...sourceRoles.map(supportTolerance)))continue;
      const q={...p,[axis]:value},residual=Math.max(...sourceRoles.map(role=>sourceDistance(q,role)));
      if(residual<error-1e-10||Math.abs(residual-error)<1e-10&&Math.abs(value-p[axis])<Math.abs(best[axis]-p[axis])){error=residual;best=q;}
    }
    return {...best,sourceResidual:error,confirmed:!linework||error<Math.min(.0015,...sourceRoles.map(supportTolerance))};
  };
  const loops=maskLoops(recon.filledProjections[target],n,n,.65);
  let pts=loops[0]?.points.slice(0,-1)||[];
  // Prefer vertices actually measured on the upload, including its internal visible edges.
  if(projected?.length) {
    pts=[];
    for(const path of projected)for(const endpoint of [path.a,path.b]) {
      const existing=pts.find(p=>p.stage===path.stage&&Math.hypot(p[0]/n-endpoint.p[0],p[1]/n-endpoint.p[1])<.000002);
      if(!existing){const p=endpoint.p.map(v=>v*n);p.world=endpoint.world;p.stage=path.stage;p.construction=path.construction;pts.push(p);}
      // Raster silhouette anchors and precise edge anchors must remain at the
      // same target coordinate; never overwrite an anchor with a nearby world point.
    }
  } else if(linework) {
    const b=bounds(target);
    const actual=linework[target].paths.filter(p=>p.lt==='v'&&p.length>10)
      .flatMap(p=>p.points).map(p=>[(p[0]-b.x)/b.w*n,(p[1]-b.y)/b.h*n]);
    const unique=[];
    for(const p of actual)if(p.every(v=>v>=0&&v<=n)&&!unique.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<2))unique.push(p);
    if(unique.length>=3)pts=unique;
  }
  if(!projected&&pts.length>28)pts=Array.from({length:28},(_,i)=>pts[Math.floor(i*pts.length/28)]);
  const points=[];
  for(const pt of pts) {
    if(pt.world){
      const [x,y,z]=pt.world,p={x:x/recon.modelSize.x+.5,y:y/recon.modelSize.y+.5,z:z/recon.modelSize.z+.5};
      points.push({...registerPoint(p),stage:pt.stage,construction:pt.construction,fromModel:true,name:points.length<26?String.fromCharCode(65+points.length):`P${points.length+1}`});continue;
    }
    let found=null,best=Infinity;
    for(let v=Math.max(0,Math.floor(pt[1])-2);v<Math.min(n,Math.ceil(pt[1])+2);v++)for(let u=Math.max(0,Math.floor(pt[0])-2);u<Math.min(n,Math.ceil(pt[0])+2);u++) {
      const distance=Math.hypot(u+.5-pt[0],v+.5-pt[1])/n;
      for(let other=0;other<n;other++) {
        const x=target==='side'?other:u,y=target==='front'?other:target==='side'?n-1-u:n-1-v,z=target==='top'?other:n-1-v;
        if(!recon.occupancy[(z*n+y)*n+x])continue;
        const p={x:target==='side'?(x+.5)/n:pt[0]/n,y:target==='front'?(y+.5)/n:target==='side'?1-pt[0]/n:1-pt[1]/n,z:target==='top'?(z+.5)/n:1-pt[1]/n};
        const support=sourceRoles.map(role=>sourceDistance(p,role));
        const score=distance*.15+support[0]+support[1];
        if(score<best){best=score;found={...p,confirmed:!linework||support.every((d,i)=>d<supportTolerance(sourceRoles[i]))};}
      }
    }
    if(found)points.push({...found,stage:pt.stage,name:points.length<26?String.fromCharCode(65+points.length):`P${points.length+1}`});
  }
  const edges=[];
  if(projected?.length) {
    const nearest=(p,stage)=>points.findIndex(q=>{const at=uv(q,target);return q.stage===stage&&Math.hypot(at[0]-p[0],at[1]-p[1])<.000002;});
    for(const path of projected){const a=nearest(path.a.p,path.stage),b=nearest(path.b.p,path.stage);if(a>=0&&b>=0)edges.push([a,b,{points:path.points,lt:path.lt,stage:path.stage}]);}
  } else if(linework) {
    const b=bounds(target);
    const nearest=p=>{
      const u=(p[0]-b.x)/b.w,v=(p[1]-b.y)/b.h;
      let distance=.06,index=-1;
      points.forEach((q,i)=>{const qu=target==='side'?1-q.y:q.x,qv=target==='top'?1-q.y:1-q.z,d=Math.hypot(u-qu,v-qv);if(d<distance){distance=d;index=i;}});return index;
    };
    for(const p of linework[target].paths.filter(p=>p.lt==='v'))for(let i=1;i<p.points.length;i++) {
      const a=nearest(p.points[i-1]),b=nearest(p.points[i]);if(a>=0&&b>=0&&a!==b)edges.push([a,b]);
    }
  } else for(let i=1;i<points.length;i++)edges.push([i-1,i]);
  const blank=!(linework?.[target]?.paths||[]).some(p=>p.lt!=='ignore'&&p.length>3);
  const partial=recon.viewStates?.[target]?.kind==='partial';
  return {target,points,edges,blank,partial,verificationStatus:recon.modelVerification?.status,structureExplanation:recon.structureExplanation,autonomous:recon.inferredRoles.includes(target)&&!partial,fromModel:!!projected,total:2+points.length*4+1};
}

export function uploadStep(plan,index) {
  if(plan.unresolved)return {title:'结构核对未通过 · 保留已知图线',explain:plan.unresolved,rule:plan.contourReview?'请对照原图检查识别轮廓':'请对照原图核对结构条件',check:'保留题目给出的线，暂不添加候选边或生成实体。'};
  if(index===0)return {title:plan.partial?'视图部分缺线 · 保留已有图线并补全':plan.blank?'空白视图 · 由两幅已知图自主补全':'先核对校正后的已知线稿',explain:(plan.partial?'该视图已经给出部分图线。保留原有实线和隐藏线，结合其余视图求解缺失部分；已有图线始终显示。':plan.blank?'补画区未识别到有效图线，不沿用框的边界或虚构辅助线；根据另外两幅图的长度、高度、深度求解候选实体，再投影补画。':'近水平、近竖直的线已取直，有依据的圆弧已拟合成圆。')+'先确定整体外轮廓，再补内部可见结构，最后处理隐藏边。深灰粗实线表示可见轮廓，紫红细虚线表示遮挡边，蓝色点画线表示中心轴线。点击图线可改判，下方可展开原照片对照。',rule:'外轮廓 → 内部可见结构 → 隐藏线',check:'真实斜面保留斜线；孔、槽和外轮廓应分别辨认。'};
  if(index===1)return {title:plan.structureExplanation?.length?'识别形体与孔槽，建立投影依据':'建立 45° 等距转向基准',explain:(plan.structureExplanation||[]).join(' ')+'主视图在左上、俯视图在下、左视图在右。俯视图的深度先向右传到 45° 线，再向上转入左视图，转向前后距离相等。',rule:'长对正 · 高平齐 · 宽相等',check:'45° 线只用于转移深度，是作图辅助线。'};
  if(index>=plan.total-1)return plan.verificationStatus==='passed'?{title:'完成候选补画，已知视图核对通过',explain:'检查可见轮廓是否闭合、隐藏边是否用虚线。右侧实体已同步生成；由另外两图推导的补图仍需独立核对。',rule:'可见用粗实线，遮挡用细虚线',check:'已知图通过不代表唯一解；切深和尺寸应以题目标注为准。'}:{title:'候选补画 · 核对尚未通过',explain:'当前图线来自候选实体，不能作为已确认答案。请查看实体上方主视、左视、俯视的差异定位，再对照原图复核结构。',rule:'先核对结构，再确认补画',check:'不匹配或未检测的实体不会标为解题完成。'};
  const pi=Math.floor((index-2)/4),phase=(index-2)%4,p=plan.points[pi];
  const a=p.name.toLowerCase(),source=plan.target==='front'?`俯视点 ${a}′（蓝）和左视点 ${a}″（紫）`:plan.target==='top'?`主视点 ${a}（橙）和左视点 ${a}″（紫）`:`主视点 ${a}（橙）和俯视点 ${a}′（蓝）`;
  const rules=['同名点对应同一空间位置',plan.target==='front'?'长对正 + 高平齐':plan.target==='top'?'主、俯视长度不变':'主、左视高度不变','45° 转向：深度等距传递','先定两端，再辨可见性'];
  const titles=['读出两幅已知视图中的同名点','作投影线，保留已有坐标','经 45° 转向，求出目标交点','连接定位点，补画结构边界'];
  const explanations=[p.confirmed?`找到${source}。同名点是同一空间点在不同视图中的投影；先核对它所在的外轮廓、孔壁或槽边，再开始投射。`:`点 ${p.name} 来自当前孔槽设定的模型投影；已知图线尚未同时支持${source}。先结合尺寸确认这处结构，图中虚圈表示待核对的对应点。`,
    plan.target==='front'?`从 ${a}′ 向上作绿色投影线确定长度，从 ${a}″ 向左作紫色水平线确定高度。`:plan.target==='top'?`从主视点 ${a} 向下作绿色投影线；俯视点的长度位置与它完全相同。`:`从主视点 ${a} 向右作紫色水平线；左视点的高度与它完全相同。`,
    plan.target==='front'?`蓝线从 ${a}′ 向右到 45° 线，再向上核对 ${a}″ 的深度。绿色长度线与紫色高度线的交点，就是主视点 ${a}。`:plan.target==='top'?`从 ${a}″ 向下到 45° 线，再沿蓝线向左；它与绿色长度线的交点，就是俯视点 ${a}′。`:`从 ${a}′ 沿蓝线向右到 45° 线，再向上转；与紫色高度线相交，得到左视点 ${a}″。`,
    '只连接两端均已确定、且结构上相连的边。橙色突出本次补线，青绿色保留已完成轮廓；被遮挡的孔壁、棱线用紫红色细虚线。相贯曲线按同一分支的已求点顺序连接，不能任意改画成圆弧。'];
  if(p.confirmed&&phase===0&&p.construction==='auxiliary-plane')explanations[0]+=' 此点由辅助截面同时截两圆柱面得到：求两条截线的公共点，再转移其长度、深度和高度。';
  if(p.confirmed&&phase===0&&p.construction==='section-generators')explanations[0]+=' 此点是圆柱素线与切平面的交点：先在已知视图求交，再投射到目标视图；斜截形不按圆拟合。';
  if(!p.confirmed) {
    titles.splice(0,4,'核对模型候选点的结构','核对原图中的定位依据','查看待核对的目标点','核对候选连接边');
    explanations[0]=`点 ${p.name} 来自当前孔槽设定的模型投影；已知图线尚未同时支持${source}。请结合原图尺寸确认这处结构。`;
    explanations[1]='已有图线尚不能可靠定位这组同名点，因此暂不绘制投射线。先核对孔槽设定和原图对应边。';
    explanations[2]='虚圈仅表示模型在补画区的候选位置；确认两幅已知视图的对应结构后，才能用投影线定位。';
    explanations[3]='本次连接是模型给出的候选边，请与原图尺寸及已有图线核对。';
  }
  const coords=`点 ${p.name}：长度 ${(p.x*100).toFixed(1)}%、深度 ${(p.y*100).toFixed(1)}%、高度 ${(p.z*100).toFixed(1)}%（相对零件总尺寸，从左、前、下起量）。`;
  const check=phase===0?coords+(p.confirmed?'':' 虚圈点需要核对结构。'):phase===2?'核对交点：长度、高度、深度应同时满足三视图对应关系。':phase===3?'不要连接没有结构关系的点；隐藏边与辅助投影线要区分。':'辅助线用于定位，完成后不作为零件轮廓。';
  const group=p.stage===0?'外轮廓':p.stage===1?'内部可见结构':p.stage===2?'隐藏结构':'';
  return {title:`${group?group+' · ':''}点 ${p.name} · ${titles[phase]}`,explain:explanations[phase],rule:rules[phase],check,point:pi,phase};
}

export function renderUploadBoard(recon,linework,index,opts={}) {
  if(recon.drawing)linework=recon.drawing;
  const l=boardLayout(recon.modelSize),plan=recon.plan||constructionPlan(recon),step=uploadStep(plan,index);
  const {w,d,h,left,top,sx,ty}=l;
  const map={front:p=>[left+p.x*w,top+(1-p.z)*h],top:p=>[left+p.x*w,ty+(1-p.y)*d],side:p=>[sx+(1-p.y)*d,top+(1-p.z)*h]};
  const out=[`<svg class="upload-drafting-svg" viewBox="0 0 ${l.width} ${l.height}" role="img" aria-label="上传题三视图与45度转向作图板" xmlns="http://www.w3.org/2000/svg">`,
    '<defs><marker id="draft-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M1,1 L7,4 L1,7" fill="none" stroke="#3476c6" stroke-width="1.3"/></marker></defs><rect width="100%" height="100%" fill="white"/>'];
  for(const role of ['front','top','side']) {
    const b=recon.drawing?{x:0,y:0,w:1,h:1}:recon.silhouetteBounds[role],work=linework[role],x=role==='side'?sx:left,y=role==='top'?ty:top,vw=role==='side'?d:w,vh=role==='top'?d:h;
    out.push(`<g data-view-role="${role}"><text x="${x}" y="${y-22}" class="board-view-title">${NAMES[role]}${plan.target===role?' · 补画区':''}</text><text x="${x}" y="${y-8}" class="board-view-rule">${role==='front'?'长度 × 高度':role==='top'?'长度 × 深度 · 长对正':'深度 × 高度 · 高平齐'}</text>`);
    const transform=`translate(${x} ${y}) scale(${vw/b.w} ${vh/b.h}) translate(${-b.x} ${-b.y})`;
    out.push(`<g transform="${transform}">`);
    for(const p of work.paths) {
      if(plan.autonomous&&role===plan.target)continue;
      // Complete measured views remain the reference at every step. Candidate
      // model edges are only added to missing or partial views below.
      const style={v:['#263238',2.15,''],t:['#4d7280',.82,''],h:['#a23c87',1.05,p.dashFragment?'':' stroke-dasharray="5 3"'],c:['#3476c6',.72,p.dashFragment?'':' stroke-dasharray="12 3 2 3"'],ignore:['#9aa5aa',.7,'']}[p.lt]||['#263238',2.15,''];
      out.push(`<path data-upload-line="${role}:${p.id}" data-line-type="${p.lt}" d="${measuredPathData(p)}" fill="none" stroke="${style[0]}" stroke-width="${style[1]}" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"${style[2]}><title>点击校正线型</title></path>`);
    }
    out.push('</g></g>');
    // An empty/reference view has no measured datum. Derive centre lines from
    // confirmed feature axes, never from the position or size of its crop.
    if(role===plan.target&&plan.autonomous&&index>=1) {
      const axes=new Map();
      for(const f of (recon.features||[]).filter(f=>!f.profile&&['through','pocket'].includes(f.kind)&&f.role!==role)) {
        const vertical=f.role==='top'||f.role==='front'&&role==='top';
        const coordinate=f.role==='top'?(role==='front'?f.u:1-f.v):f.role==='front'?(role==='top'?f.u:f.v):role==='front'?f.v:1-f.u;
        // Axial ranges use physical X/Y/Z coordinates. Screen depth and height
        // run in reverse; finite plate bores must not acquire full-body axes.
        const range=f.axialRange||[0,1];
        const [start,end]=f.role==='side'?range:[1-range[1],1-range[0]];
        const key=(vertical?'v':'h')+coordinate.toFixed(6);
        if(!axes.has(key))axes.set(key,{vertical,coordinate,ranges:[]});
        axes.get(key).ranges.push([start,end]);
      }
      for(const {vertical,coordinate,ranges} of axes.values()) {
        const spans=[];
        const length=vertical?vh:vw;
        for(const [a,b] of ranges.sort((a,b)=>a[0]-b[0])) {
          const start=a*length-10,end=b*length+10,last=spans.at(-1);
          if(last&&start<=last[1])last[1]=Math.max(last[1],end);
          else spans.push([start,end]);
        }
        for(const [start,end] of spans) {
          const points=vertical?[[x+coordinate*vw,y+start],[x+coordinate*vw,y+end]]:[[x+start,y+coordinate*vh],[x+end,y+coordinate*vh]];
          out.push(`<path class="generated-axis" d="${pathData(points)}" fill="none" stroke="#3476c6" stroke-width=".72" stroke-dasharray="12 3 2 3"/>`);
        }
      }
    }
  }
  if(index>=1)out.push(`<g class="miter-construction"><line class="miter-line" x1="${sx}" y1="${ty}" x2="${sx+d}" y2="${ty+d}"/><text x="${sx+d*.5+12}" y="${ty+d*.5}" class="miter-label">45°</text><text x="${sx}" y="${ty-18}" class="board-view-title">宽相等 · 等距转向</text></g>`);
  const current=step.point??-1;
  const done=index>=plan.total-1?plan.points.length:Math.floor(Math.max(0,index-2)/4)+(step.phase===3?1:0);
  for(const [a,b,path] of plan.edges||[])if(a<done&&b<done&&!(recon.answerProjections&&index>=plan.total-1)&&!plan.points.some((p,i)=>i>=done&&(p.stage??0)<(path?.stage??0))) {
    const p=path?path.points.map(q=>plan.target==='front'?[left+q[0]*w,top+q[1]*h]:plan.target==='top'?[left+q[0]*w,ty+q[1]*d]:[sx+q[0]*d,top+q[1]*h]):[map[plan.target](plan.points[a]),map[plan.target](plan.points[b])];
    out.push(`<path class="constructed-edge${path?.lt==='h'?' constructed-hidden':''}${step.phase===3&&(a===current||b===current)?' current-edge':''}" d="${pathData(p)}"/>`);
  }
  if(current>=0&&plan.points[current]&&index<plan.total-1) {
    const p=plan.points[current],a=map.front(p),b=map.top(p),c=map.side(p),turn=[c[0],b[1]],phase=index>=plan.total-1?3:step.phase;
    out.push('<g class="active-projectors">');
    if(phase>=1&&p.confirmed)out.push(`<path class="length-projector" d="M${b[0]},${b[1]} L${a[0]},${a[1]}"/><path class="height-projector" d="M${a[0]},${a[1]} L${c[0]},${c[1]}"/>`);
    if(phase>=2&&p.confirmed)out.push(`<path class="depth-transfer" marker-end="url(#draft-arrow)" d="${plan.target==='top'?`M${c[0]},${c[1]} L${turn[0]},${turn[1]} L${b[0]},${b[1]}`:`M${b[0]},${b[1]} L${turn[0]},${turn[1]} L${c[0]},${c[1]}`}"/>`);
    out.push('</g>');
    for(const [role,pt] of Object.entries({front:a,top:b,side:c}))if((p.confirmed&&role!==plan.target)||role===plan.target&&phase>=2)out.push(`<g class="construction-point point-${role}${role===plan.target?' target-point':''}${p.confirmed?'':' unconfirmed'}" data-point-role="${role}"><circle class="point-halo" cx="${pt[0]}" cy="${pt[1]}" r="8"/><circle cx="${pt[0]}" cy="${pt[1]}" r="3.5"/><text x="${pt[0]+8}" y="${pt[1]-8}">${p.name.toLowerCase()}${role==='top'?'′':role==='side'?'″':''}</text></g>`);
    if(phase>=2&&p.confirmed)out.push(`<circle class="turning-point" cx="${turn[0]}" cy="${turn[1]}" r="4"/>`);
  }
  for(let i=0;i<done&&index<plan.total-1;i++) {
    const p=plan.points[i],pt=map[plan.target](p);
    out.push(`<circle class="completed-point" cx="${pt[0]}" cy="${pt[1]}" r="2.7"/>`);
  }
  if(opts.features)for(const [i,f] of (recon.features||[]).entries()) {
    const x=f.role==='side'?sx:left,y=f.role==='top'?ty:top,vw=f.role==='side'?d:w,vh=f.role==='top'?d:h;
    if(f.profile)out.push(`<path class="feature-region" d="${pathData(f.profile.map(p=>[x+p[0]*vw,y+p[1]*vh]))}"/>`);
    else out.push(`<ellipse class="feature-region" cx="${x+f.u*vw}" cy="${y+f.v*vh}" rx="${f.r*vw}" ry="${f.r*vw}"/>`);
    const label=f.profile?f.profile[0]:[f.u,f.v];
    out.push(`<text class="feature-number" x="${x+label[0]*vw+8}" y="${y+label[1]*vh-8}">特征 ${i+1}</text>`);
  }
  if(recon.answerProjections&&index>=plan.total-1) {
    const roles=new Set(Object.keys(recon.completionProjections||{}));
    if(plan.autonomous||plan.partial)roles.add(plan.target);
    for(const role of roles) {
      const x=role==='side'?sx:left,y=role==='top'?ty:top,vw=role==='side'?d:w,vh=role==='top'?d:h;
      out.push(`<g class="model-answer" data-answer-role="${role}" stroke-linecap="round" stroke-linejoin="round">`);
      for(const line of projectedLessonPaths(recon.completionProjections?.[role]||recon.answerProjections[role],0))out.push(`<path d="${pathData(line.points.map(p=>[x+p[0]*vw,y+p[1]*vh]))}" stroke="${line.lt==='h'?'#a23c87':'#0f766e'}" stroke-width="${line.lt==='h'?1:2.15}" ${line.lt==='h'?'stroke-dasharray="5 3"':''} fill="none"/>`);
      out.push('</g>');
    }
  }
  out.push('</svg>');return out.join('');
}

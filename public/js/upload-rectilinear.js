// Inverse first-angle projection for parts bounded by orthogonal planes.
// Grid coordinates increase right/down in the drawings: X, reversed Y, reversed Z.
const frames={front:[0,2,1,true],top:[0,1,2,false],side:[1,2,0,false]};
const roles=Object.keys(frames);
const first=m=>m&-m;
// Each bit is one material interval on a sight ray, nearest bit first.
// A change of nearest face is visible. A change only behind that face is hidden.
const kind=(a,b)=>a===b?'':first(a)===first(b)?'h':'v';
const all=(n,f)=>Array.from({length:n},(_,i)=>f(i));

function measure(recon) {
 const samples=[[],[],[]],lines={};
 for(const role of roles) {
  const state=recon.viewStates[role],work=recon.drawing[role];
  if(!['complete','partial'].includes(state.kind))continue;
  // An open fragment normalized to its own tight bounds has no full datum.
  if(state.kind==='partial'&&!state.closedFrame&&!state.registered)return null;
  const [u,v]=frames[role],map=work.sourceMap;
  const pixels=map?[1/Math.hypot(map[1][0]-map[0][0],map[2][0]-map[0][0]),1/Math.hypot(map[1][1]-map[0][1],map[2][1]-map[0][1])]:[work.sourceSize.w,work.sourceSize.h];
  if(pixels.some(p=>!Number.isFinite(p)||p<16))return null;
  const spans=[];
  for(const path of work.paths.filter(p=>['v','h'].includes(p.lt))) {
   if(path.arc||path.analyticArc)return null;
   for(let i=1;i<path.points.length;i++) {
    const a=path.points[i-1],b=path.points[i],d=a.map((x,k)=>Math.abs(b[k]-x)*pixels[k]),k=d[0]<d[1]?0:1;
    if(d[1-k]<2.5)continue; // raster corners and junction burrs
    if(d[k]>1.8||d[k]>.15*d[1-k]) {
     // Thinning can bevel a measured rectangle's outside corner by a few
     // pixels. Its distance from the ideal corner must pass the pixel audit.
     const corner=a.map(x=>Math.round(x)),touches=[a,b].every(q=>q.every((x,j)=>Math.abs(x-corner[j])*pixels[j]<=3.1));
     if(work.type==='rectangle'&&touches&&d[0]*d[1]/Math.hypot(...d)<=2.25)continue;
     return null;
    }
    if([...a,...b].some(x=>x<-.035||x>1.035))return null;
    const at=(a[k]+b[k])/2,tol=2.25/pixels[k];
    samples[[u,v][k]].push({at,w:d[1-k],tol});
    spans.push({k,at,lo:Math.min(a[1-k],b[1-k]),hi:Math.max(a[1-k],b[1-k]),lt:path.lt,tol,alongTol:2.25/pixels[1-k]});
   }
  }
  if(!spans.length)return null;
  lines[role]=spans;
 }
 if(Object.keys(lines).length<2)return null;
 const planes=samples.map(ss=>{
  const clusters=[];
  for(const s of ss.sort((a,b)=>a.at-b.at)) {
   const c=clusters.at(-1);
   if(c&&s.at-c.min<=Math.min(c.tol,s.tol)){c.at=(c.at*c.w+s.at*s.w)/(c.w+s.w);c.w+=s.w;c.tol=Math.min(c.tol,s.tol);}
   else clusters.push({...s,min:s.at});
  }
  if(!clusters.length||clusters[0].at>clusters[0].tol||1-clusters.at(-1).at>clusters.at(-1).tol)return [];
  return clusters.map((s,i)=>i===0?0:i===clusters.length-1?1:s.at);
 });
 if(planes.some(p=>p.length<2||p.length>7)||planes.reduce((s,p)=>s+p.length-2,0)<2)return null;
 return {planes,lines};
}

function edges(planes,role,visit) {
 const [u,v]=frames[role],axes=[planes[u],planes[v]],nx=axes[0].length-1,ny=axes[1].length-1;
 const index=(x,y)=>x<0||y<0||x>=nx||y>=ny?-1:y*nx+x;
 for(let k=0;k<2;k++)for(let i=0;i<axes[k].length;i++)for(let j=0;j<axes[1-k].length-1;j++){
  const at=axes[k][i],lo=axes[1-k][j],hi=axes[1-k][j+1];
  visit(k,at,lo,hi,k?index(j,i-1):index(i-1,j),k?index(j,i):index(i,j));
 }
}

// Constraints are sampled over the whole elementary edge, not at an arbitrary
// midpoint (which may land in white space between two hidden dashes).
function observed(lines,k,at,lo,hi,partial) {
 const lengths={v:0,h:0};
 for(const lt of ['v','h']) {
  let end=lo;
  for(const l of lines.filter(l=>l.lt===lt&&l.k===k&&Math.abs(l.at-at)<=l.tol).sort((a,b)=>a.lo-b.lo)) {
   const a=Math.max(end,lo,l.lo),b=Math.min(hi,l.hi);
   if(b>a){lengths[lt]+=b-a;end=b;}
  }
 }
 const visible=lengths.v/(hi-lo),hidden=lengths.h/(hi-lo);
 if(visible>.68&&hidden<.12)return 'v';
 if(hidden>.22&&visible<.12)return 'h';
 if(visible+hidden>.12)return 'conflict';
 return partial?null:'';
}

function layout(planes,role) {
 const [u,v,d,reverse]=frames[role],n=planes.map(p=>p.length-1);
 return all(n[u]*n[v],i=>all(n[d],j=>{
  const q=[];q[u]=i%n[u];q[v]=Math.floor(i/n[u]);q[d]=reverse?n[d]-1-j:j;
  return q[0]+n[0]*(q[1]+n[1]*q[2]);
 }));
}

export function solveRectilinear(recon,{maxNodes=2400,maxMilliseconds=450}={}) {
 const measured=measure(recon);if(!measured)return {status:'not-applicable'};
 const {planes,lines}=measured,n=planes.map(p=>p.length-1),rays=[],constraints=[],initial=[[0]];
 // Index zero is an exterior (empty) ray shared by all views.
 rays.push([]);
 for(const [role,ink] of Object.entries(lines)){
  const offset=rays.length,ls=layout(planes,role);rays.push(...ls);
  for(const ray of ls)initial.push(all(1<<ray.length,i=>i));
  let bad=false;
  edges(planes,role,(k,at,lo,hi,a,b)=>{
   const lt=observed(ink,k,at,lo,hi,recon.viewStates[role].kind==='partial');
   if(lt==='conflict')bad=true;
   else if(lt!==null)constraints.push([a<0?0:offset+a,b<0?0:offset+b,lt]);
  });
  if(bad)return {status:'not-applicable'};
 }
 const count=n.reduce((a,b)=>a*b),solutions=[],deadline=performance.now()+maxMilliseconds;
 let nodes=0,limited=false;
 function search(domains) {
  if(limited||solutions.length>=2)return;
  if(++nodes>maxNodes||performance.now()>deadline){limited=true;return;}
  let changed;
  do {
   changed=false;
   for(const [a,b,lt] of constraints)for(const [i,j] of [[a,b],[b,a]]){
    const ds=domains[i],other=domains[j],next=ds.filter(m=>other.some(h=>kind(m,h)===lt));
    if(!next.length)return;
    if(next.length<ds.length){domains[i]=next;changed=true;}
   }
   const allowed=new Uint8Array(count).fill(3);
   rays.forEach((ray,i)=>{
    const ds=domains[i],any=ds.reduce((a,b)=>a|b,0),every=ds.reduce((a,b)=>a&b,-1);
    ray.forEach((cell,j)=>{allowed[cell]&=(any&(1<<j)?2:0)|(every&(1<<j)?0:1);});
   });
   if(allowed.includes(0))return;
   for(let i=1;i<rays.length;i++){
    const ds=domains[i],next=ds.filter(m=>rays[i].every((cell,j)=>allowed[cell]&(m&(1<<j)?2:1)));
    if(!next.length)return;
    if(ds.length!==next.length){domains[i]=next;changed=true;}
   }
  }while(changed);
  let branch=0;
  for(let i=1;i<domains.length;i++)if(domains[i].length>1&&(!branch||domains[i].length<domains[branch].length))branch=i;
  if(!branch){
   const filled=new Uint8Array(count);rays.forEach((r,i)=>r.forEach((cell,j)=>{filled[cell]=(domains[i][0]>>j)&1;}));
   if(filled.some(Boolean))solutions.push(filled);
   return;
  }
  for(const m of domains[branch]){const next=domains.slice();next[branch]=[m];search(next);if(limited||solutions.length>1)break;}
 }
 search(initial);
 if(solutions.length===2){
  const cell=solutions[0].findIndex((value,i)=>value!==solutions[1][i]),at=[cell%n[0],Math.floor(cell/n[0])%n[1],Math.floor(cell/(n[0]*n[1]))];
  const point=at.map((j,i)=>{const mid=(planes[i][j]+planes[i][j+1])/2;return i?1-mid:mid;});
  return {status:'ambiguous',point,nodes};
 }
 if(solutions.length!==1||limited)return {status:limited?'budget':'inconsistent',nodes};
 const filled=solutions[0],boxes=[];
 for(let z=0;z<n[2];z++)for(let y=0;y<n[1];y++)for(let x=0;x<n[0];x++)if(filled[x+n[0]*(y+n[1]*z)])
  boxes.push({lo:[planes[0][x],1-planes[1][y+1],1-planes[2][z+1]],hi:[planes[0][x+1],1-planes[1][y],1-planes[2][z]]});
 return {status:'solved',grid:{planes,filled},boxes,nodes};
}

export function gridProjection({planes,filled},size) {
 const ext=[size.x,size.y,size.z],result={};
 for(const role of roles) {
  const [u,v,d,reverse]=frames[role],masks=layout(planes,role).map(ray=>ray.reduce((mask,cell,j)=>mask|(filled[cell]<<j),0));
  const lines=[];result[role]=lines;
  edges(planes,role,(k,at,lo,hi,a,b)=>{
   const x=masks[a]||0,y=masks[b]||0,lt=kind(x,y);if(!lt)return;
   const j=31-Math.clz32(first(x^y)),depth=planes[d][reverse?planes[d].length-1-j:j];
   const p=[lo,hi].map(t=>k?[t,at]:[at,t]);
   const world=p.map(([s,t])=>{const q=[];q[u]=s;q[v]=t;q[d]=depth;return q.map((w,i)=>(i?.5-w:w-.5)*ext[i]);});
   lines.push({lt,p,world,boundary:!x||!y});
  });
 }
 return result;
}

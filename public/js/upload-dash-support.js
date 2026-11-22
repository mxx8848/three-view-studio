// Read the original scanlines, not the polygon produced by thinning at a
// T-junction. A wall datum selects where to look; it cannot create ink.
// Origin, stroke ends and gaps below all come from the source mask.
export function readWallDashes(work,along,transverse){
 const {sourceMap,sourceSize,inkMask}=work;if(!sourceMap||!sourceSize||!inkMask||work.paths.some(p=>p.manualType))return;
 const [o,X,Y]=sourceMap,d=[X[0]-o[0],Y[1]-o[1]],{w,h}=sourceSize,cross=1-along,n=[w,h];
 if(d.some(v=>v<=0)||Math.abs(X[1]-o[1])*w/d[1]>1.5||Math.abs(Y[0]-o[0])*h/d[0]>1.5)return;
 const t0=(transverse-o[cross])/d[cross],choices=[];
 for(let t=Math.ceil(t0-2);t<=Math.floor(t0+2);t++){
  const runs=[];let start;
  for(let s=0;s<=n[along];s++){
   if(s<n[along]&&inkMask[along===0?t*w+s:s*w+t]){start??=s;continue;}
   if(start!==undefined){runs.push([start,s-1]);start=undefined;}
  }
  const short=runs.filter(([a,b])=>b-a>=3&&b-a<Math.max(12,Math.min(22,.085/d[along])));
  if(short.length<3)continue;
  const lens=short.map(([a,b])=>b-a+1).sort((a,b)=>a-b),typ=lens[lens.length>>1];
  const regular=short.filter(([a,b])=>b-a+1>=typ*.65&&b-a+1<=1.55*typ);
  if(regular.length<short.length*.70)continue;
  const cadence=regular.filter(([a],i)=>i&&a-regular[i-1][1]>=2&&a-regular[i-1][1]<=typ*1.5);
  if(cadence.length<2)continue;
  const score=cadence.length+regular.length*.2-Math.abs(t-t0)*.07;
  // An end dash may join a circular rim or a cap. Preserve the observed
  // portion of that run; a long continuous line cannot extend the wall.
  choices.push({t,score,typ,runs:runs.filter(([a,b])=>b-a+1>=2&&b-a+1<=typ*1.8&&regular.some(([l,h])=>(l!==a||h!==b)&&Math.min(Math.abs(l-b),Math.abs(h-a))<=typ*2))});
 }
 if(!choices.length)return;
 const best=choices.sort((a,b)=>b.score-a.score)[0],at=o[cross]+best.t*d[cross];
 const runs=best.runs.map(r=>r.map(v=>Math.max(0,Math.min(1,o[along]+v*d[along])))).filter(([a,b])=>b>a);
 return {along,at,runs,typ:best.typ*d[along],tol:d[cross]*2};
}

export function restoreWallDashes(work,walls){
 if(!walls.length)return work.paths;
 const paths=[];
 for(const p of work.paths){
  if(p.manualType||p.arc||p.hiddenCircle||p.lt==='c'){paths.push(p);continue;}
  const parts=p.points.slice(1).map((b,i)=>[p.points[i],b]);
  const belongs=([a,b])=>walls.some(({along:k,at,runs,tol,typ})=>{
   let limit=tol;
   if(p.lt==='h'&&Math.abs(a[1-k]-b[1-k])<tol*.4){
    const [o,X,Y]=work.sourceMap,d=[X[0]-o[0],Y[1]-o[1]],{w}=work.sourceSize;
    let ink=0;for(let j=1;j<=5;j++){const q=a.map((v,i)=>Math.round((v+(b[i]-v)*j/6-o[i])/d[i]));ink+=work.inkMask[q[1]*w+q[0]]||0;}
    // Junction regularization may snap a dash onto a parallel but empty
    // column. Only move it further if the original pixels contradict it.
    if(ink<=1)limit=tol*2.3;
   }
   if(Math.max(Math.abs(a[1-k]-at),Math.abs(b[1-k]-at))>limit||Math.abs(a[k]-b[k])>typ*1.85)return false;
   const m=(a[k]+b[k])/2;return runs.some(([lo,hi])=>lo-tol<m&&m<hi+tol);
  });
  if(!parts.some(belongs)){paths.push(p);continue;}
  for(const points of parts.filter(l=>!belongs(l)))paths.push({...p,points});
 }
 for(const {along:k,at,runs}of walls)for(const r of runs)paths.push({lt:'h',points:r.map(v=>k===0?[v,at]:[at,v]),width:work.thinWidth||1,black:true,dashFragment:true,length:r[1]-r[0]});
 return paths;
}

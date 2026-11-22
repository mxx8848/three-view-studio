// Feature cutters use the final measured datums, never the earlier flood-fill
// boundaries (which follow the outside of the ink rather than stroke centres).
export function alignMeasuredDatumSizes(recon) {
  if(recon.sectionFrames||Object.values(recon.drawing).some(w=>w.expandedDatum)) {
    const lengths={x:[],y:[],z:[]};
    for(const role of ['front','top','side'].filter(r=>!recon.inferredRoles.includes(r))) {
      const [a,b,c]=recon.drawing[role].sourceMap;
      lengths[role==='side'?'y':'x'].push(1/Math.hypot(b[0]-a[0],b[1]-a[1]));
      lengths[role==='top'?'y':'z'].push(1/Math.hypot(c[0]-a[0],c[1]-a[1]));
    }
    const measured=Object.fromEntries(Object.entries(lengths).map(([a,v])=>[a,v.reduce((s,x)=>s+x,0)/v.length]));
    if(Object.values(measured).every(v=>Number.isFinite(v)&&v>0)) {
      const max=Math.max(...Object.values(measured));recon.modelSize=Object.fromEntries(Object.entries(measured).map(([a,v])=>[a,v/max]));
    }
  }
  const axes=['x','y','z'],prior=axes.map(a=>Math.log(recon.modelSize[a])),matrix=axes.map((_,i)=>axes.map((_,j)=>i===j?.01:0)),rhs=prior.map(v=>v*.01),constraints=[];
  for(const role of ['front','top','side']) {
    if(recon.inferredRoles.includes(role))continue;
    const w=recon.drawing[role];
    const datums=w.measuredPrimitives?w.curveDatums:w.type==='circle'?[{rx:.5,ry:.5}]:[];
    if(!datums?.length)continue;
    const ratios=datums.map(c=>Math.log(c.ry/c.rx)).sort((a,b)=>a-b),value=ratios[Math.floor(ratios.length/2)];
    const a=role==='side'?1:0,b=role==='top'?1:2;
    matrix[a][a]++;matrix[b][b]++;matrix[a][b]--;matrix[b][a]--;rhs[a]+=value;rhs[b]-=value;
    constraints.push({role,a:axes[a],b:axes[b],ratio:Math.exp(value)});
  }
  for(let i=0;i<3;i++) {
    const d=matrix[i][i];for(let k=i;k<3;k++)matrix[i][k]/=d;rhs[i]/=d;
    for(let j=0;j<3;j++)if(j!==i){const f=matrix[j][i];for(let k=i;k<3;k++)matrix[j][k]-=f*matrix[i][k];rhs[j]-=f*rhs[i];}
  }
  const scale=Math.exp(Math.max(...rhs));axes.forEach((a,i)=>recon.modelSize[a]=Math.exp(rhs[i])/scale);
  recon.measuredSizeConstraints=constraints;
}

export function registerMeasuredFeatures(recon) {
  alignMeasuredDatumSizes(recon);
  const added=[];
  for(const role of ['front','top','side']) {
    if(recon.inferredRoles.includes(role))continue;
    const work=recon.drawing[role];
    for(const c of work.curveDatums||[]) {
      const arcs=work.paths.filter(p=>c.ids.includes(p.id));
      const angles=new Set(arcs.flatMap(p=>p.points.map(q=>Math.round(((Math.atan2((q[1]-c.v)/c.ry,(q[0]-c.u)/c.rx)+Math.PI*2)%(Math.PI*2))*72/(Math.PI*2))%72)));
      const internal=c.u-c.rx>.02&&c.u+c.rx<.98&&c.v-c.ry>.02&&c.v+c.ry<.98;
      // An open semicircular notch may meet the bottom edge, but an outer
      // circular rim must never become a through-hole candidate.
      const notch=c.u-c.rx>.02&&c.u+c.rx<.98&&c.v>.97&&c.v<1.03&&angles.size>=33&&angles.size<=40;
      if(!(internal&&angles.size>=68)&&!notch)continue;
      const existing=recon.features.find(f=>f.role===role&&!f.profile&&Math.hypot(f.u-c.u,f.v-c.v)<.05&&Math.abs(f.r-c.rx)<.05);
      if(existing){existing.u=c.u;existing.v=c.v;existing.r=c.rx;existing.measured=true;}
      else {const f={role,u:c.u,v:c.v,r:c.rx,kind:'unknown',measured:true,evidence:notch?'实测半圆开口；切削方向需由另一视图验证':'完整实测圆周；切削方向需由另一视图验证'};recon.features.push(f);added.push(f);}
    }
  }
  for(const f of recon.features.filter(f=>f.profile)) {
    const work=recon.drawing[f.role],size=work.sourceSize||{w:200,h:200};
    const supports=[[],[]];
    for(const p of work.paths.filter(p=>p.lt==='v'&&!p.arc))for(let i=1;i<p.points.length;i++) {
      const a=p.points[i-1],b=p.points[i];
      for(const axis of [0,1])if(Math.abs(a[axis]-b[axis])<1e-7&&Math.abs(a[1-axis]-b[1-axis])>.08)supports[axis].push(a[axis]);
    }
    for(const p of f.profile)for(const axis of [0,1]) {
      const at=supports[axis].toSorted((a,b)=>Math.abs(a-p[axis])-Math.abs(b-p[axis]))[0];
      if(at!==undefined&&Math.abs(at-p[axis])<Math.min(.035,3/(axis?size.h:size.w)))p[axis]=at;
    }
    const circle=recon.features[f.joinedCircle];
    if(circle&&!circle.profile&&circle.role===f.role) {
      const x=supports[0].toSorted((a,b)=>Math.abs(a-f.slotEdge)-Math.abs(b-f.slotEdge))[0];
      if(x!==undefined&&Math.abs(x-f.slotEdge)<.04)f.slotEdge=x;
      const aspect=(f.role==='side'?recon.modelSize.y:recon.modelSize.x)/(f.role==='top'?recon.modelSize.y:recon.modelSize.z),ry=circle.r*aspect;
      f.profile=[[f.slotEdge,circle.v-ry],[circle.u,circle.v-ry],[circle.u,circle.v+ry],[f.slotEdge,circle.v+ry],[f.slotEdge,circle.v-ry]];
    }
  }
  // A closed cell in a line drawing can be a boss, a rib, or two intersecting
  // silhouettes. A horizontal line alone does not establish a pocket.
  for(const f of recon.features)if(f.profile&&f.kind==='pocket') {
    f.kind='unknown';f.proposedDepth=f.depth;
    f.evidence='封闭区域与水平线的候选对应，需用实体投影验证切削';
  }
  for(const f of recon.features)if(!f.profile&&f.role==='top'&&f.kind==='through'&&f.evidence==='主视与左视的两组隐藏孔壁均支持贯通') {
    f.kind='unknown';f.evidence='两幅图存在孔壁候选，需比较通孔与有实测槽底的盲孔';
  }
  return added;
}

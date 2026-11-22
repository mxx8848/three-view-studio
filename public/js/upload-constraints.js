import {circleFit} from './upload-lines.js';

const key=p=>p.map(v=>v.toFixed(8)).join(',');
const copy=p=>{const q=[...p];if(p.curved)q.curved=true;return q;};

// Recover a complete measured ring across centreline and wall junctions.
// A local arc alone is insufficient; require almost full angular support.
export function fitClosedMeasuredRings(paths) {
  const candidates=paths.filter(p=>['v','t'].includes(p.lt)&&p.points.length>=5).map(path=>({path,fit:circleFit(path.points,5)})).filter(({path,fit})=>fit&&fit.error<.035&&fit.r>5&&path.points.slice(1).every((b,i)=>[.25,.5,.75].every(t=>{
    const a=path.points[i],x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
    return Math.abs(Math.hypot(x-fit.cx,y-fit.cy)-fit.r)<Math.max(1.5,fit.r*.025);
  })));
  const used=new Set(),rings=[];
  for(const seed of candidates) {
    if(used.has(seed.path))continue;
    const group=candidates.filter(p=>!used.has(p.path)&&Math.hypot(p.fit.cx-seed.fit.cx,p.fit.cy-seed.fit.cy)<Math.max(5,seed.fit.r*.15)&&Math.abs(p.fit.r-seed.fit.r)<Math.max(5,seed.fit.r*.15));
    const fit=circleFit(group.flatMap(p=>p.path.points),5);if(!fit||fit.error>.025)continue;
    for(const path of paths.filter(p=>!used.has(p)&&!group.some(q=>q.path===p)&&['v','t','h'].includes(p.lt))) {
      const near=p=>Math.abs(Math.hypot(p[0]-fit.cx,p[1]-fit.cy)-fit.r)<Math.max(2,fit.r*.05);
      const length=path.points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-path.points[i][0],p[1]-path.points[i][1]),0);
      if(length<fit.r*1.1&&path.points.every(near)&&path.points.slice(1).every((p,i)=>near([(p[0]+path.points[i][0])/2,(p[1]+path.points[i][1])/2])))group.push({path});
    }
    const bins=new Set();
    for(const {path} of group)for(let i=1;i<path.points.length;i++) {
      const a=path.points[i-1],b=path.points[i];
      for(let t=0;t<=1;t+=.1)bins.add(Math.floor(((Math.atan2(a[1]+(b[1]-a[1])*t-fit.cy,a[0]+(b[0]-a[0])*t-fit.cx)+Math.PI*2)%(Math.PI*2))*72/(Math.PI*2)));
    }
    if(bins.size<60)continue;
    const ringId=group[0].path.id;
    for(const {path} of group) {
      used.add(path);
      // Short straight bridges belong to the wall at a tangent. Keep them;
      // the complete ring is drawn independently rather than bending a wall.
      if(path.points.length<5)continue;
      if(path.id!==ringId){path.mergedInto=ringId;continue;}
      const steps=Math.max(128,Math.ceil(Math.PI*2*fit.r));
      path.points=Array.from({length:steps+1},(_,i)=>{const angle=Math.PI*2*i/steps,p=[fit.cx+fit.r*Math.cos(angle),fit.cy+fit.r*Math.sin(angle)];p.curved=true;return p;});
      path.lt='v';path.measuredRing=true;
    }
    rings.push({...fit,ids:group.map(p=>p.path.id)});
  }
  return rings;
}

export function limitMeasuredDrift(work,references,width,height,tolerance=2) {
  const distance=(p,points)=>{let best=Infinity;for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],dx=(b[0]-a[0])*width,dy=(b[1]-a[1])*height,t=Math.max(0,Math.min(1,((p[0]-a[0])*width*dx+(p[1]-a[1])*height*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best,Math.hypot((p[0]-a[0])*width-t*dx,(p[1]-a[1])*height-t*dy));
  }return best;};
  let restored=0,maxDrift=0;
  for(const path of work.paths) {
    const source=references.find(p=>p.id===path.id);if(!source||!['v','h'].includes(source.lt)||path.perimeter||path.measuredRing||path.mergedInto!==undefined)continue;
    const drift=Math.max(...path.points.map(p=>distance(p,source.points)),...source.points.map(p=>distance(p,path.points)));
    if(drift>tolerance){path.points=source.points.map(copy);path.arc=false;restored++;}
    else maxDrift=Math.max(maxDrift,drift);
  }
  work.sourceFidelity={restored,maxDrift,tolerance};
}

// Fit connected measured arc fragments together. Pixel junctions split a
// single U-shaped rim into multiple paths; fitting each separately leaves
// different centres and small flat spots between them.
export function joinMeasuredArcs(paths,width,height,allowEllipse=true) {
  // Curved flags can be lost when a path is resampled at a graph junction.
  // Recover dense, demonstrably circular runs before joining the graph.
  const measured=paths.filter(p=>p.lt==='v'&&!p.arc);
  const fits=new Map();
  for(const p of measured)if(p.points.length>=8) {
    const ps=p.points.map(q=>[q[0]*width,q[1]*height]),f=circleFit(ps);
    if(f&&f.r>=8&&f.error<.025&&ps.every(q=>Math.abs(Math.hypot(q[0]-f.cx,q[1]-f.cy)-f.r)<3))fits.set(p,f);
  }
  const candidates=measured.filter(p=>fits.has(p)||p.points.some(q=>q.curved));
  const groups=[];
  const touches=(a,b)=>[a.points[0],a.points.at(-1)].some(p=>[b.points[0],b.points.at(-1)].some(q=>Math.hypot((p[0]-q[0])*width,(p[1]-q[1])*height)<2));
  for(const path of candidates) {
    const matches=groups.filter(g=>g.some(p=>touches(p,path)));
    if(!matches.length)groups.push([path]);
    else {matches[0].push(path);for(const g of matches.slice(1)){matches[0].push(...g);groups.splice(groups.indexOf(g),1);}}
  }
  const constraints=[];
  // Two measured arcs on the same circle can be separated by short, sparse
  // junction paths. Use the dense arcs as evidence, not the coarse chords.
  for(let i=0;i<groups.length;i++)for(let j=i+1;j<groups.length;j++) {
    const a=groups[i].map(p=>fits.get(p)).find(Boolean),b=groups[j].map(p=>fits.get(p)).find(Boolean);
    if(!a||!b||Math.hypot(a.cx-b.cx,a.cy-b.cy)>Math.max(3,a.r*.12)||Math.abs(a.r-b.r)>Math.max(3,a.r*.06))continue;
    const near=p=>Math.abs(Math.hypot(p[0]*width-a.cx,p[1]*height-a.cy)-a.r)<Math.max(3,a.r*.06);
    const bridges=measured.filter(p=>!candidates.includes(p)&&p.points.length<=6&&p.points.every(near)&&p.points.slice(1).every((q,k)=>near([(q[0]+p.points[k][0])/2,(q[1]+p.points[k][1])/2])));
    const connected=[...groups[i]];let changed=true;
    while(changed){changed=false;for(const p of [...bridges,...groups[j]])if(!connected.includes(p)&&connected.some(q=>touches(p,q))){connected.push(p);changed=true;}}
    if(!groups[j].every(p=>connected.includes(p)))continue;
    groups[i].push(...connected.filter(p=>!groups[i].includes(p)));groups.splice(j--,1);
  }
  for(const group of groups.filter(g=>g.length>1)) {
    const seeds=group.filter(p=>candidates.includes(p));
    const samples=seeds.flatMap(path=>Array.from({length:17},(_,i)=>path.points[Math.round(i*(path.points.length-1)/16)]).map(p=>[p[0]*width,p[1]*height]));
    const fit=circleFit(samples);
    if(!fit||fit.error>.025||fit.r<8||samples.some(p=>Math.abs(Math.hypot(p[0]-fit.cx,p[1]-fit.cy)-fit.r)>Math.max(3,fit.r*.03)))continue;
    const original=new Map(paths.map(p=>[p,p.points.map(copy)])),moves=new Map();
    for(const path of group)for(const p of [path.points[0],path.points.at(-1)]) {
      let angle=Math.atan2(p[1]*height-fit.cy,p[0]*width-fit.cx);
      for(const other of paths.filter(p=>p.lt==='v'&&!group.includes(p))) {
        const ps=original.get(other),at=[0,ps.length-1].find(i=>Math.hypot((ps[i][0]-p[0])*width,(ps[i][1]-p[1])*height)<4);
        if(at===undefined)continue;
        const a=ps[at],b=ps[at===0?1:at-1];
        if(Math.abs(a[0]-b[0])*width<1&&Math.abs(a[1]-b[1])*height>10&&Math.abs(Math.abs(p[0]*width-fit.cx)-fit.r)<3) {
          const x=(fit.cx+(p[0]*width<fit.cx?-fit.r:fit.r))/width;
          angle=p[0]*width<fit.cx?Math.PI:0;
          for(let i=0;i<ps.length;i++)if(Math.abs(ps[i][0]-a[0])*width<1)other.points[i][0]=x;
        } else if(Math.abs(a[1]-b[1])*height<1&&Math.abs(a[0]-b[0])*width>10&&Math.abs(Math.abs(p[1]*height-fit.cy)-fit.r)<3) {
          const y=(fit.cy+(p[1]*height<fit.cy?-fit.r:fit.r))/height;
          angle=p[1]*height<fit.cy?-Math.PI/2:Math.PI/2;
          for(let i=0;i<ps.length;i++)if(Math.abs(ps[i][1]-a[1])*height<1)other.points[i][1]=y;
        }
        if(angle===Math.PI||angle===0||angle===-Math.PI/2||angle===Math.PI/2)moves.set(key(a),[(fit.cx+fit.r*Math.cos(angle))/width,(fit.cy+fit.r*Math.sin(angle))/height]);
      }
      moves.set(key(p),[(fit.cx+fit.r*Math.cos(angle))/width,(fit.cy+fit.r*Math.sin(angle))/height]);
    }
    for(const path of paths)for(let i=0;i<path.points.length;i++) {
      const q=moves.get(key(original.get(path)[i]));if(q){path.points[i][0]=q[0];path.points[i][1]=q[1];}
    }
    // A guide intersecting a corrected junction must remain a straight guide;
    // moving only its endpoint creates a little sloping tail at the tangent.
    for(const path of paths.filter(p=>p.lt!=='v')) {
      const ps=original.get(path),move=ps.map(p=>moves.get(key(p))).find(Boolean);
      if(!move)continue;
      for(const axis of [0,1])if((Math.max(...ps.map(p=>p[axis]))-Math.min(...ps.map(p=>p[axis])))*(axis?height:width)<1)
        for(const p of path.points)p[axis]=move[axis];
    }
    for(const path of group) {
      const angles=path.points.map(p=>Math.atan2(p[1]*height-fit.cy,p[0]*width-fit.cx));
      for(let i=1;i<angles.length;i++){while(angles[i]-angles[i-1]>Math.PI)angles[i]-=2*Math.PI;while(angles[i]-angles[i-1]<-Math.PI)angles[i]+=2*Math.PI;}
      const from=angles[0],span=angles.at(-1)-from,steps=Math.max(8,Math.ceil(Math.abs(span)*fit.r));
      path.points=Array.from({length:steps+1},(_,i)=>{const angle=from+span*i/steps,p=[(fit.cx+fit.r*Math.cos(angle))/width,(fit.cy+fit.r*Math.sin(angle))/height];p.curved=true;return p;});
    }
    constraints.push({u:fit.cx/width,v:fit.cy/height,rx:fit.r/width,ry:fit.r/height,ids:group.map(p=>p.id)});
  }
  // A view displayed with independent width/height scales turns a measured
  // circle into an axis-aligned ellipse. Fitting its left and right halves as
  // pixel circles gives very different centres. Recover that common metric
  // only for two dense arc supports; the recursive graph checks still require
  // connected, measured bridges before changing the drawing.
  if(!constraints.length&&allowEllipse&&fits.size===2) {
    const supports=[...fits.keys()],points=supports.flatMap(p=>Array.from({length:33},(_,i)=>p.points[Math.round(i*(p.points.length-1)/32)]));
    const evaluate=scale=>circleFit(points.map(p=>[p[0]*width,p[1]*height*scale]));
    let lo=.5,hi=2;
    for(let i=0;i<40;i++) {
      const a=lo+(hi-lo)/3,b=hi-(hi-lo)/3;
      if((evaluate(a)?.error??Infinity)<(evaluate(b)?.error??Infinity))hi=b;else lo=a;
    }
    const scale=(lo+hi)/2,fit=evaluate(scale);
    if(fit&&fit.error<.01&&Math.abs(scale-1)>.03)return joinMeasuredArcs(paths,width,height*scale,false);
  }
  return constraints;
}

export function alignCurveOutline(work) {
  for(const c of work.curveDatums||[]) {
    const samples=work.paths.filter(p=>c.ids.includes(p.id)).flatMap(p=>p.points);
    const supported=(x,y)=>samples.some(p=>Math.hypot((p[0]-c.u)/c.rx-x,(p[1]-c.v)/c.ry-y)<.04);
    // The raster fallback must use the same fitted curve as the measured
    // paths. Otherwise a smooth drawing can still extrude a polygonal slot.
    for(const p of work.outline) {
      const x=(p[0]-c.u)/c.rx,y=(p[1]-c.v)/c.ry,r=Math.hypot(x,y);
      if(r>0&&Math.abs(r-1)<.09&&supported(x/r,y/r)) {
        p[0]=c.u+c.rx*x/r;p[1]=c.v+c.ry*y/r;p.curved=true;
      } else if(p[1]<c.v&&Math.abs(Math.abs(x)-1)<.09&&supported(Math.sign(x),0))p[0]=c.u+Math.sign(x)*c.rx;
    }
    if(work.outline.length)work.outline[work.outline.length-1]=copy(work.outline[0]);
  }
}

// A verified closed circular silhouette is one geometric rim. Rendering its
// separately clipped raster paths leaves visible gaps at branch junctions.
export function closeCircularRim(work) {
  if(work.type!=='circle')return;
  const near=p=>Math.abs(Math.hypot(p[0]-.5,p[1]-.5)-.5)<.02;
  const rim=work.paths.filter(path=>path.lt==='v'&&path.points.every(near)&&path.points.slice(1).every((b,i)=>near([(path.points[i][0]+b[0])/2,(path.points[i][1]+b[1])/2])));
  if(!rim.length)return;
  const paths=work.paths.filter(p=>!rim.includes(p));
  // Closing a measured rim replaces its paths, not its geometric evidence.
  // Keep only datums actually supported by those paths; an arbitrary circular
  // silhouette must not create a new measured ring for structural inference.
  const rimDatums=(work.curveDatums||[]).filter(c=>c.ids.length&&c.ids.every(id=>rim.some(p=>p.id===id)));
  work.curveDatums=(work.curveDatums||[]).filter(c=>c.ids.every(id=>paths.some(p=>p.id===id)));
  for(const path of paths.filter(p=>!p.arc)) {
    const ps=path.points;
    for(const p of [ps[0],ps.at(-1)]) {
      if(!near(p))continue;
      const vertical=ps.every(q=>Math.abs(q[0]-p[0])<.002),horizontal=ps.every(q=>Math.abs(q[1]-p[1])<.002);
      if(vertical&&Math.abs(p[0]-.5)<=.5)p[1]=.5+Math.sign(p[1]-.5)*Math.sqrt(.25-(p[0]-.5)**2);
      else if(horizontal&&Math.abs(p[1]-.5)<=.5)p[0]=.5+Math.sign(p[0]-.5)*Math.sqrt(.25-(p[1]-.5)**2);
    }
  }
  const id=Math.max(...work.paths.map(p=>p.id))+1;
  const points=Array.from({length:193},(_,i)=>[.5+.5*Math.cos(i*Math.PI/96),.5+.5*Math.sin(i*Math.PI/96)]);
  work.outline=points.map(copy);
  work.paths=[...paths,{id,lt:'v',arc:true,perimeter:true,length:Math.PI,analyticArc:{u:.5,v:.5,rx:.5,ry:.5,from:0,to:Math.PI*2},points}];
  for(const c of rimDatums)work.curveDatums.push({...c,u:.5,v:.5,rx:.5,ry:.5,ids:[id]});
}

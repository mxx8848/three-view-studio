// 由三视图反推三维：三视图轮廓的"视觉体（visual hull）"
// 原理与人工作图一致：物体上任一点在三个视图中的投影都必须落在各自的轮廓内，
// 因此把三个轮廓按"长对正 / 高平齐 / 宽相等"对齐后逐体素取交，即得一个包含真实实体的近似体。
// 这是"从打印版三视图反求形体"的可实现核心 —— 对正投影图是严格的，代价是体素化近似（棱边呈台阶状）。
// 两视图只能推导最大外轮廓近似，不能宣称唯一恢复实体。

/** 在视图框内做泛洪填充，得到被轮廓围住的区域（轮廓本身算实心） */
function fillSilhouette(ink, W, H, box) {
  if (box.blank) return { mask: new Uint8Array(16), w: 4, h: 4, x0: 0, y0: 0, fillRatio: 0, cropFillRatio: 0, exteriorRatio: 1 };
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(W, Math.ceil(box.x + box.w));
  const y1 = Math.min(H, Math.ceil(box.y + box.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 4 || h < 4) return null;

  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (bg[i]) return;
    if (ink[(y + y0) * W + (x + x0)]) return; // 碰到墨迹就停
    bg[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  const mask = new Uint8Array(w * h);
  let inside = 0;
  let enclosed = 0;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      // 未被外部泛洪到 = 轮廓内部（含轮廓线本身）
      if (!bg[i]) {
        mask[i] = 1;
        inside += 1;
        if (!ink[(y + y0) * W + (x + x0)]) enclosed += 1;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  // A closed inner line can denote a boss, recess, blind hole or through hole.
  // Silhouettes alone do not justify subtracting a tunnel through the model.
  // Exterior centerlines and stray annotation strokes must not enlarge a closed solid.
  if (enclosed > 12) {
    const interior = mask.map((value,i) => value && !ink[(Math.floor(i/w)+y0)*W+i%w+x0] ? 1 : 0);
    const supportRadius=Math.max(2,Math.min(12,Math.ceil(Math.min(w,h)*.02)));
    minX=w;minY=h;maxX=-1;maxY=-1;inside=0;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const i=y*w+x;
      if(!mask[i])continue;
      let supported=!!interior[i];
      for(let dy=-supportRadius;dy<=supportRadius&&!supported;dy++)for(let dx=-supportRadius;dx<=supportRadius;dx++) {
        if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&interior[(y+dy)*w+x+dx]) {supported=true;break;}
      }
      mask[i]=supported?1:0;
      if(supported){inside++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
    }
  }
  if (!inside) return { mask, w, h, x0, y0, fillRatio: 0, cropFillRatio: 0, exteriorRatio: 1 };
  const tightW = maxX - minX + 1;
  const tightH = maxY - minY + 1;
  const tightMask = new Uint8Array(tightW * tightH);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      tightMask[(y - minY) * tightW + x - minX] = mask[y * w + x];
    }
  }
  const exteriorRatio = (w * h - inside) / (w * h);
  return {
    mask: tightMask, w: tightW, h: tightH, x0: x0 + minX, y0: y0 + minY,
    fillRatio: enclosed / (tightW * tightH), cropFillRatio: inside / (w * h), exteriorRatio,
  };
}

function closeTinyGaps(source, width, height, box) {
  const x0 = Math.max(0, Math.floor(box.x)), y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.w)), y1 = Math.min(height, Math.ceil(box.y + box.h));
  const w = x1 - x0, h = y1 - y0;
  const dilated = new Uint8Array(w * h);
  const result = source.slice();
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    let value = 0;
    for (let dy = -1; dy <= 1 && !value; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && source[(y0 + yy) * width + x0 + xx]) { value = 1; break; }
    }
    dilated[y * w + x] = value;
  }
  for (let y = 1; y < h - 1; y += 1) for (let x = 1; x < w - 1; x += 1) {
    let value = 1;
    for (let dy = -1; dy <= 1 && value; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (!dilated[(y + dy) * w + x + dx]) { value = 0; break; }
    }
    if (value) result[(y0 + y) * width + x0 + x] = 1;
  }
  return result;
}

/** 最近邻采样 */
function sample(sil, u, v) {
  const x = Math.min(sil.w - 1, Math.max(0, Math.round(u * (sil.w - 1))));
  const y = Math.min(sil.h - 1, Math.max(0, Math.round(v * (sil.h - 1))));
  return sil.mask[y * sil.w + x] === 1;
}

function rasterizeSilhouette(silhouette, resolution) {
  const mask = new Uint8Array(resolution * resolution);
  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      if (sample(silhouette, (x + 0.5) / resolution, (y + 0.5) / resolution)) mask[y * resolution + x] = 1;
    }
  }
  return mask;
}

/** 判断三个视图框各自的角色（主/俯/左） */
export function assignRoles(views) {
  if (views.length < 3) return null;
  // 主视图：最靠上的一块；俯视图：在主视图正下方且 x 范围重叠；左视图：在主视图右侧且 y 重叠
  const byTop = [...views].sort((a, b) => a.y - b.y);
  const front = byTop[0];
  const overlapX = (a, b) => {
    const l = Math.max(a.x, b.x);
    const r = Math.min(a.x + a.w, b.x + b.w);
    return Math.max(0, r - l) / Math.min(a.w, b.w);
  };
  const overlapY = (a, b) => {
    const t = Math.max(a.y, b.y);
    const bo = Math.min(a.y + a.h, b.y + b.h);
    return Math.max(0, bo - t) / Math.min(a.h, b.h);
  };
  const rest = views.filter((v) => v !== front);
  let top = null;
  let side = null;
  for (const v of rest) {
    const ox = overlapX(front, v);
    const oy = overlapY(front, v);
    if (ox > oy && v.y > front.y) top = v;
    else if (oy > ox && v.x > front.x) side = v;
  }
  if (!top || !side) {
    // 退路：按位置粗分
    const others = rest.sort((a, b) => a.y - b.y);
    top = top || others.find((v) => v.y > front.y) || others[0];
    side = side || others.find((v) => v !== top) || others[1];
  }
  if (!top || !side) return null;
  return { front, top, side };
}

/**
 * 反推
 * @param {{ink:Uint8Array,w:number,h:number,views:Array}} input
 * @param {{res?:number}} opts
 */
export function reconstructFromViews(input, opts = {}) {
  const res = Math.round(Math.min(96, Math.max(24, Number(opts.res) || 56)));
  const roles = input.roles?.front && input.roles?.top && input.roles?.side
    ? input.roles
    : assignRoles(input.views);
  if (!roles) {
    return { ok: false, reason: '需要识别到 3 块视图区域才能反推；当前不足 3 块。' };
  }
  const silhouette=role=>fillSilhouette(closeTinyGaps(input.ink,input.w,input.h,roles[role]),input.w,input.h,roles[role]);
  const sFront = silhouette('front');
  const sTop = silhouette('top');
  const sSide = silhouette('side');
  if (!sFront || !sTop || !sSide) {
    return { ok: false, reason: '视图区域过小，无法填充轮廓。' };
  }
  const quality = [sFront.fillRatio, sTop.fillRatio, sSide.fillRatio];
  const validView = quality.map((q) => q >= 0.20);
  // Closed-area quality describes a silhouette, not whether a view exists.
  // Keep the measured drawing even when a missing outer edge prevents filling.
  const viewStates=Object.fromEntries(['front','top','side'].map((role,index)=>{
    const box=roles[role],work=input.linework?.[role];
    let points=work&&!box.blank?work.paths.filter(p=>['v','h'].includes(p.lt)&&p.length>3).flatMap(p=>p.points):[];
    if(!work&&!box.blank)for(let y=Math.max(0,Math.floor(box.y));y<Math.min(input.h,box.y+box.h);y++)for(let x=Math.max(0,Math.floor(box.x));x<Math.min(input.w,box.x+box.w);x++)if(input.ink[y*input.w+x])points.push([x-box.x,y-box.y]);
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),extent=values=>values.length?values.reduce((b,v)=>[Math.min(b[0],v),Math.max(b[1],v)],[Infinity,-Infinity]):[0,0];
    const [x0,x1]=extent(xs),[y0,y1]=extent(ys),present=x1-x0>box.w*.12&&y1-y0>box.h*.12;
    return [role,{kind:validView[index]?(box.partial?'partial':'complete'):present||box.partial&&points.length?'partial':points.length?'reference':'blank',...(box.partial&&validView[index]?{closedFrame:true}:{}),bounds:{x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)}}];
  }));
  const missing = validView.map((valid, index) => valid ? -1 : index).filter((index) => index >= 0);
  if (missing.length > 1) {
    const names = ['主视图', '俯视图', '左视图'];
    return { ok: false, reason: `${missing.map((i) => names[i]).join('和')}都需要补全，无法仅由一幅视图推导；请确认框选区域和图像清晰度。` };
  }

  // 图像坐标：主视 (x,-z)、俯视 (x,-y)、左视 (-y,-z)。
  // 独立归一化是视觉体近似；尺寸差异另行报告，不能等同于完成照片校正。
  let filled = 0;
  const occ = new Uint8Array(res * res * res);
  const frontMask = rasterizeSilhouette(sFront, res);
  const topMask = rasterizeSilhouette(sTop, res);
  const sideMask = rasterizeSilhouette(sSide, res);
  const inferredRoles = [];
  if (missing.length === 1) {
    const view = missing[0];
    inferredRoles.push(['front', 'top', 'side'][view]);
    if (view === 0) {
      frontMask.fill(0);
      for (let k = 0; k < res; k += 1) for (let i = 0; i < res; i += 1) {
        for (let j = 0; j < res; j += 1) {
          if (topMask[j * res + i] && sideMask[k * res + j]) { frontMask[k * res + i] = 1; break; }
        }
      }
    } else if (view === 1) {
      topMask.fill(0);
      for (let j = 0; j < res; j += 1) for (let i = 0; i < res; i += 1) {
        for (let k = 0; k < res; k += 1) {
          if (frontMask[k * res + i] && sideMask[k * res + j]) { topMask[j * res + i] = 1; break; }
        }
      }
    } else {
      sideMask.fill(0);
      for (let k = 0; k < res; k += 1) for (let j = 0; j < res; j += 1) {
        for (let i = 0; i < res; i += 1) {
          if (frontMask[k * res + i] && topMask[j * res + i]) { sideMask[k * res + j] = 1; break; }
        }
      }
    }
  }
  for (let k = 0; k < res; k += 1) {
    for (let j = 0; j < res; j += 1) {
      for (let i = 0; i < res; i += 1) {
        if (!frontMask[k * res + i] || !topMask[j * res + i] || !sideMask[k * res + j]) continue;
        // Image rows run down; world Z (height) and Y (depth) run up.
        occ[((res - 1 - k) * res + (res - 1 - j)) * res + i] = 1;
        filled += 1;
      }
    }
  }
  if (!filled) {
    return { ok: false, reason: '三个轮廓的交集为空，检查视图是否识别正确或是否为同一物体。' };
  }

  const projections = {
    front: new Uint8Array(res * res),
    top: new Uint8Array(res * res),
    side: new Uint8Array(res * res),
  };
  for (let k = 0; k < res; k += 1) {
    for (let j = 0; j < res; j += 1) {
      for (let i = 0; i < res; i += 1) {
        if (!occ[((res - 1 - k) * res + (res - 1 - j)) * res + i]) continue;
        projections.front[k * res + i] = 1;
        projections.top[j * res + i] = 1;
        projections.side[k * res + j] = 1;
      }
    }
  }
  const projectionFit = {};
  for (const [name, expected] of Object.entries({ front: frontMask, top: topMask, side: sideMask })) {
    let supported = 0, total = 0;
    for (let i = 0; i < expected.length; i += 1) {
      if (expected[i]) { total += 1; supported += projections[name][i]; }
    }
    projectionFit[name] = total ? supported / total : 0;
  }
  for (const [name, mask] of Object.entries(projections)) {
    const filledMask = mask.slice();
    for (let y = 0; y < res; y += 1) {
      for (let x = 0; x < res; x += 1) {
        const i = y * res + x;
        if (!filledMask[i]) continue;
        if (x === 0 || y === 0 || x === res - 1 || y === res - 1
          || !filledMask[i - 1] || !filledMask[i + 1]
          || !filledMask[i - res] || !filledMask[i + res]) mask[i] = 1;
        else mask[i] = 0;
      }
    }
    projections[name] = mask;
  }

  const rawDimensions = {
    width: validView[0] && validView[1] ? (sFront.w + sTop.w) / 2 : validView[0] ? sFront.w : sTop.w,
    height: validView[0] && validView[2] ? (sFront.h + sSide.h) / 2 : validView[0] ? sFront.h : sSide.h,
    depth: validView[1] && validView[2] ? (sTop.h + sSide.w) / 2 : validView[1] ? sTop.h : sSide.w,
  };
  const maxDimension = Math.max(rawDimensions.width, rawDimensions.height, rawDimensions.depth);
  const modelSize = {
    x: rawDimensions.width / maxDimension,
    y: rawDimensions.depth / maxDimension,
    z: rawDimensions.height / maxDimension,
  };

  // 体素面提取：只输出"实心-空心"之间的界面四边形
  const positions = [];
  const indices = [];
  const sx = modelSize.x / res;
  const sy = modelSize.y / res;
  const sz = modelSize.z / res;
  const baseX = -modelSize.x / 2;
  const baseY = -modelSize.y / 2;
  const baseZ = -modelSize.z / 2;
  const pushQuad = (quad) => {
    const start = positions.length / 3;
    for (const p of quad) positions.push(p[0], p[1], p[2]);
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  const at = (i, j, k) =>
    i < 0 || j < 0 || k < 0 || i >= res || j >= res || k >= res
      ? 0
      : occ[(k * res + j) * res + i];

  for (let k = 0; k < res; k += 1) {
    for (let j = 0; j < res; j += 1) {
      for (let i = 0; i < res; i += 1) {
        if (!at(i, j, k)) continue;
        const x0 = baseX + i * sx;
        const x1 = x0 + sx;
        const y0 = baseY + j * sy; // 深度 → three 的 Y，和题库模型坐标一致
        const y1 = y0 + sy;
        const z0 = baseZ + k * sz; // 高度 → three 的 Z
        const z1 = z0 + sz;
        if (!at(i - 1, j, k)) pushQuad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
        if (!at(i + 1, j, k)) pushQuad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]);
        if (!at(i, j - 1, k)) pushQuad([[x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y0, z0]]);
        if (!at(i, j + 1, k)) pushQuad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]);
        if (!at(i, j, k - 1)) pushQuad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]);
        if (!at(i, j, k + 1)) pushQuad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
      }
    }
  }

  return {
    ok: true,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    cells: filled,
    occupancy: occ,
    res,
    modelSize,
    projections,
    silhouettes: { front: sFront, top: sTop, side: sSide },
    filledProjections: (() => {
      const out = { front: new Uint8Array(res*res), top: new Uint8Array(res*res), side: new Uint8Array(res*res) };
      for (let z=0;z<res;z++)for(let y=0;y<res;y++)for(let x=0;x<res;x++)if(occ[(z*res+y)*res+x]) {
        out.front[(res-1-z)*res+x]=1;out.top[(res-1-y)*res+x]=1;out.side[(res-1-z)*res+res-1-y]=1;
      }
      return out;
    })(),
    projectionFit,
    silhouetteBounds: Object.fromEntries(Object.entries({ front: sFront, top: sTop, side: sSide })
      .map(([role, sil]) => [role, { x: sil.x0 - Math.floor(roles[role].x), y: sil.y0 - Math.floor(roles[role].y), w: sil.w, h: sil.h }])),
    dimensionChecks: [
      { label: '长对正', a: sFront.w, b: sTop.w, inferred: !validView[0] || !validView[1] },
      { label: '高平齐', a: sFront.h, b: sSide.h, inferred: !validView[0] || !validView[2] },
      { label: '宽相等', a: sTop.h, b: sSide.w, inferred: !validView[1] || !validView[2] },
    ].map(check => ({ ...check, error: Math.abs(check.a - check.b) / Math.max(check.a, check.b) })),
    quality: {
      frontFill: +quality[0].toFixed(3),
      topFill: +quality[1].toFixed(3),
      sideFill: +quality[2].toFixed(3),
      frontCropFill: +sFront.cropFillRatio.toFixed(3),
      topCropFill: +sTop.cropFillRatio.toFixed(3),
      sideCropFill: +sSide.cropFillRatio.toFixed(3),
    },
    roles,
    inferredRoles,
    completionRole:Object.keys(roles).find(role=>viewStates[role].kind==='partial'),
    viewStates,
  };
}

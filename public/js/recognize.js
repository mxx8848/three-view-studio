// 图形识别：从照片里提取可复核的证据 —— 视图分区、线宽分布、虚线段占比。
// 设计立场：不做"黑箱识别后直接出答案"。识别结果只用于给出候选与置信度，
// 最终由用户在"识别结果"面板里确认/改选，避免错误无声传播。

const MAX_SIDE = 1800;

/** Otsu 阈值（用于灰度二值化，也复用于线宽双峰分割） */
function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < hist.length; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 0;
  for (let t = 0; t < hist.length; t += 1) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

function toGrayCanvas(img) {
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    // 亮度：人眼加权，避免红蓝笔迹被判成背景
    gray[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return { w, h, gray, canvas: cv, ctx };
}

/** 粗网格连通域：把三个视图分离开（标准布局是 L 形，不能只按行列切） */
function segmentViews(ink, w, h, cell = 24) {
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const occ = new Uint8Array(gw * gh);
  const MIN_CELL_INK = 6;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!ink[y * w + x]) continue;
      const gx = (x / cell) | 0;
      const gy = (y / cell) | 0;
      occ[gy * gw + gx] += 1;
    }
  }
  for (let i = 0; i < occ.length; i += 1) occ[i] = occ[i] >= MIN_CELL_INK ? 1 : 0;

  const label = new Int32Array(gw * gh).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < occ.length; i += 1) {
    if (!occ[i] || label[i] >= 0) continue;
    const id = comps.length;
    const box = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, cells: 0 };
    stack.push(i);
    label[i] = id;
    while (stack.length) {
      const j = stack.pop();
      const gx = j % gw;
      const gy = (j / gw) | 0;
      box.cells += 1;
      if (gx < box.x0) box.x0 = gx;
      if (gx > box.x1) box.x1 = gx;
      if (gy < box.y0) box.y0 = gy;
      if (gy > box.y1) box.y1 = gy;
      const nb = [
        [gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1],
      ];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (occ[k] && label[k] < 0) {
          label[k] = id;
          stack.push(k);
        }
      }
    }
    comps.push(box);
  }

  const minCells = Math.max(6, (gw * gh) * 0.004);
  return comps
    .filter((b) => b.cells >= minCells)
    .map((b) => ({
      x: b.x0 * cell,
      y: b.y0 * cell,
      w: Math.min(w, (b.x1 + 1) * cell) - b.x0 * cell,
      h: Math.min(h, (b.y1 + 1) * cell) - b.y0 * cell,
      cells: b.cells,
    }))
    .sort((a, b) => b.cells - a.cells)
    .slice(0, 4);
}

/** 线宽与线段长度统计：用"行游程 / 列游程"近似笔画横截面与笔画长度 */
function strokeStats(ink, w, h) {
  const rowRun = new Int32Array(w * h);
  const colRun = new Int32Array(w * h);

  for (let y = 0; y < h; y += 1) {
    let x = 0;
    while (x < w) {
      if (!ink[y * w + x]) { x += 1; continue; }
      let e = x;
      while (e < w && ink[y * w + e]) e += 1;
      const len = e - x;
      for (let k = x; k < e; k += 1) rowRun[y * w + k] = len;
      x = e;
    }
  }
  for (let x = 0; x < w; x += 1) {
    let y = 0;
    while (y < h) {
      if (!ink[y * w + x]) { y += 1; continue; }
      let e = y;
      while (e < h && ink[e * w + x]) e += 1;
      const len = e - y;
      for (let k = y; k < e; k += 1) colRun[k * w + x] = len;
      y = e;
    }
  }

  const thickHist = new Uint32Array(64);
  const dirHist = new Uint32Array(512);
  let inkCount = 0;
  let thickSum = 0;
  const dirLens = [];

  for (let i = 0; i < w * h; i += 1) {
    if (!ink[i]) continue;
    inkCount += 1;
    const t = Math.min(rowRun[i] || 1, colRun[i] || 1);
    const d = Math.max(rowRun[i] || 1, colRun[i] || 1);
    thickSum += t;
    thickHist[Math.min(63, t)] += 1;
    dirHist[Math.min(511, d)] += 1;
    if ((i & 7) === 0) dirLens.push(d); // 抽样，控制内存
  }
  if (!inkCount) return null;

  const thickThr = otsu(thickHist, inkCount);
  let thickPx = 0;
  for (let t = thickThr + 1; t < 64; t += 1) thickPx += thickHist[t];

  const dirThr = otsu(dirHist, inkCount);
  let shortPx = 0;
  for (let d = 0; d < Math.min(dirThr, 60); d += 1) shortPx += dirHist[d];

  dirLens.sort((a, b) => a - b);
  const medianDir = dirLens.length ? dirLens[dirLens.length >> 1] : 0;

  return {
    inkCount,
    inkRatio: inkCount / (w * h),
    meanThickness: thickSum / inkCount,
    thickThr,
    thickPct: thickPx / inkCount,
    thinPct: 1 - thickPx / inkCount,
    dashPct: shortPx / inkCount,
    medianRunLength: medianDir,
    w, h,
  };
}

/**
 * 主入口：分析一张图片
 * @param {HTMLImageElement|ImageBitmap} img
 */
export function analyzeImage(img,problemCandidates=[]) {
  const { w, h, gray, canvas } = toGrayCanvas(img);

  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) hist[gray[i]] += 1;
  const thr = otsu(hist, gray.length);

  const ink = new Uint8Array(w * h);
  // 图纸是"白底黑线"，比阈值暗的算墨迹
  const inkThreshold = Math.max(40, thr * 0.92);
  for (let i = 0; i < gray.length; i += 1) ink[i] = gray[i] <= inkThreshold ? 1 : 0;

  const stats = strokeStats(ink, w, h);
  const views = segmentViews(ink, w, h);

  const notes = [];
  if (!stats || stats.inkRatio < 0.002) {
    return {
      ok: false,
      width: w, height: h,
      reason: '几乎没有检测到线条：请确认照片正对、光线均匀，且图形占画面主体。',
      canvas,
    };
  }
  if (stats.inkRatio > 0.25) notes.push('墨迹占比偏高，可能有过深的阴影或背景干扰。');
  if (views.length < 2) notes.push(`只分出 ${views.length} 块图形区域，可能裁剪过紧或视图间距太小。`);
  if (views.length > 3) notes.push(`分出 ${views.length} 块区域，可能是视图内的孤立标注被当成了独立图形。`);

  const thickPct = Math.round(stats.thickPct * 100);
  const dashPct = Math.round(stats.dashPct * 100);

  // 候选匹配：用"视图块数量 + 主体长宽比"做弱匹配，仅作提示
  const main = views[0];
  const aspect = main ? main.w / main.h : 0;
  const candidates = problemCandidates.map((p) => {
    const target = p.views.front.w / p.views.front.h;
    const score = Math.max(0, 1 - Math.abs(aspect - target) / Math.max(0.6, target));
    return { id: p.id, title: p.title, score: +score.toFixed(2) };
  }).sort((a, b) => b.score - a.score);

  return {
    ok: true,
    width: w, height: h,
    threshold: thr,
    inkRatio: +stats.inkRatio.toFixed(4),
    views,
    viewCount: views.length,
    strokes: {
      meanThicknessPx: +stats.meanThickness.toFixed(2),
      thickPct,
      thinPct: 100 - thickPct,
      dashPct,
      medianRunLengthPx: stats.medianRunLength,
    },
    guess: {
      thick: thickPct > 55 ? '以粗实线为主' : thickPct < 30 ? '以细线/虚线为主' : '粗线与细线并存',
      hasDashed: dashPct > 12,
    },
    candidates: candidates.slice(0, 3),
    confidence: views.length === 3 && stats.inkRatio < 0.12 ? '中' : '低',
    notes,
    ink,          // 反推三维要用：二值墨迹图（1 = 有笔迹）
    canvas,
  };
}

/** Threshold each manually selected view independently to reduce paper/background variation. */
export function thresholdSelectedViews(canvas, roles) {
  const { width: w, height: h } = canvas;
  const rgba = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  const colorInk = new Uint8Array(w * h);
  for (let p = 0, i = 0; i < rgba.length; i += 4, p += 1) {
    gray[p] = (rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114) | 0;
    const [r, g, b] = rgba.subarray(i, i + 3);
    // Keep colored annotations and pencil marks that grayscale Otsu often loses.
    colorInk[p] = Math.max(r, g, b) - Math.min(r, g, b) > 32 && Math.min(r, g, b) < 210 ? 1 : 0;
  }

  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y += 1) {
    let row = 0;
    for (let x = 1; x <= w; x += 1) {
      row += gray[(y - 1) * w + x - 1];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }
  const localMean = (x, y, radius) => {
    const left = Math.max(0, x - radius), right = Math.min(w, x + radius + 1);
    const top = Math.max(0, y - radius), bottom = Math.min(h, y + radius + 1);
    const stride = w + 1;
    const sum = integral[bottom * stride + right] - integral[top * stride + right]
      - integral[bottom * stride + left] + integral[top * stride + left];
    return sum / ((right - left) * (bottom - top));
  };

  const ink = new Uint8Array(w * h);
  const thresholds = {};
  const thresholded = {};
  const lineMasks = {};
  for (const role of Object.keys(roles)) {
    const box = roles[role];
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(w, Math.ceil(box.x + box.w));
    const y1 = Math.min(h, Math.ceil(box.y + box.h));
    const radius = Math.max(7, Math.round(Math.min(box.w, box.h) / 36));
    const crop = typeof document==='undefined'?new OffscreenCanvas(1,1):document.createElement('canvas');
    crop.width = Math.max(1, x1 - x0);
    crop.height = Math.max(1, y1 - y0);
    const cropCtx = crop.getContext('2d');
    const pixels = cropCtx.createImageData(crop.width, crop.height);
    const cropInk = new Uint8Array(crop.width * crop.height);
    const cropColor = new Uint8Array(crop.width * crop.height);
    const cropDark = new Uint8Array(crop.width * crop.height);
    const cropBlack = new Uint8Array(crop.width * crop.height);
    // Opaque selection labels in re-uploaded screenshots are not drawing ink.
    // Identify broad, exactly flat coloured runs over multiple rows; pencil
    // strokes and circular contours have neither a filled rectangle nor this
    // constant pixel colour. Preserve an explicit record of occluded pixels.
    const overlay=new Uint8Array(cropInk.length),colors=new Map();
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*w+x)*4,c=[rgba[i],rgba[i+1],rgba[i+2]];
      if(Math.max(...c)-Math.min(...c)<35||Math.max(...c)>230)continue;
      const key=c.join(','),g=colors.get(key)||{n:0,x0:x,x1:x,y0:y,y1:y};g.n++;g.x0=Math.min(g.x0,x);g.x1=Math.max(g.x1,x);g.y0=Math.min(g.y0,y);g.y1=Math.max(g.y1,y);colors.set(key,g);
    }
    const labelScale=Math.max(1,Math.min(crop.width,crop.height)/230),labelPad=Math.ceil(2*labelScale);
    const visited=new Uint8Array(cropInk.length),regions=[];
    // Equal colours elsewhere in the drawing must not merge with a label.
    for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++){
      const at=(yy-y0)*crop.width+xx-x0;if(visited[at])continue;
      const i=(yy*w+xx)*4,rgb=[rgba[i],rgba[i+1],rgba[i+2]],count=colors.get(rgb.join(','));
      if(!count||count.n<=120*labelScale**2)continue;
      const queue=[at],g={n:0,x0:xx,x1:xx,y0:yy,y1:yy,rgb};visited[at]=1;
      for(let q=0;q<queue.length;q++){
        const p=queue[q],x=p%crop.width+x0,y=Math.floor(p/crop.width)+y0;g.n++;g.x0=Math.min(g.x0,x);g.x1=Math.max(g.x1,x);g.y0=Math.min(g.y0,y);g.y1=Math.max(g.y1,y);
        for(const [nx,ny]of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]){
          if(nx<x0||nx>=x1||ny<y0||ny>=y1)continue;const k=(ny-y0)*crop.width+nx-x0,j=(ny*w+nx)*4;
          if(!visited[k]&&rgb.every((v,c)=>rgba[j+c]===v)){visited[k]=1;queue.push(k);}
        }
      }
      if(g.n>120*labelScale**2)regions.push(g);
    }
    for(const g of regions)if(g.y1-g.y0>=12*labelScale&&g.y1-g.y0<35*labelScale&&g.x1-g.x0>25*labelScale&&g.x1-g.x0<140*labelScale&&g.n/((g.x1-g.x0+1)*(g.y1-g.y0+1))>.25){
      const rgb=g.rgb;let filled=0;
      // Resampling blends the label's white text into its flat background.
      // Count nearby background colours, while still requiring a broad fill.
      for(let yy=g.y0;yy<=g.y1;yy++)for(let xx=g.x0;xx<=g.x1;xx++){const i=(yy*w+xx)*4;if(rgb.every((v,k)=>Math.abs(rgba[i+k]-v)<12))filled++;}
      if(filled/((g.x1-g.x0+1)*(g.y1-g.y0+1))<=.5)continue;
      for(let yy=Math.max(y0,g.y0-labelPad);yy<Math.min(y1,g.y1+labelPad+1);yy++)for(let xx=Math.max(x0,g.x0-labelPad);xx<Math.min(x1,g.x1+labelPad+1);xx++)overlay[(yy-y0)*crop.width+xx-x0]=1;
    }
    let cutoffSum = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = y * w + x;
        const background = localMean(x, y, radius);
        const localContrast = background - gray[i];
        const adaptiveCutoff = background - Math.max(16, Math.min(34, background * 0.11));
        const isInk = !box.blank && !overlay[(y-y0)*crop.width+x-x0] && (localContrast > Math.max(9, background * 0.055)
          || (colorInk[i] === 1 && localContrast > 7));
        cutoffSum += adaptiveCutoff;
        cropInk[(y - y0) * crop.width + x - x0] = isInk ? 1 : 0;
        const pixel=i*4;
        cropColor[(y-y0)*crop.width+x-x0]=isInk&&rgba[pixel]>rgba[pixel+1]+70&&rgba[pixel]>rgba[pixel+2]+70?1:0;
        cropDark[(y-y0)*crop.width+x-x0]=isInk&&gray[i]<100?1:0;
        cropBlack[(y-y0)*crop.width+x-x0]=isInk&&gray[i]<45?1:0;
        if (isInk) ink[i] = 1;
      }
    }
    thresholds[role] = Math.round(cutoffSum / cropInk.length);
    lineMasks[role] = { mask: cropInk, colorMask:cropColor,darkMask:cropDark,blackMask:cropBlack, overlayMask:overlay, w: crop.width, h: crop.height };
    for (let i = 0; i < cropInk.length; i += 1) {
      const shade = cropInk[i] ? 20 : 255;
      const j = i * 4;
      pixels.data[j] = shade;
      pixels.data[j + 1] = shade;
      pixels.data[j + 2] = shade;
      pixels.data[j + 3] = 255;
    }
    cropCtx.putImageData(pixels, 0, 0);
    thresholded[role] = crop;
  }
  return { ink, thresholds, thresholded, lineMasks };
}

export function thinBinary(source, width, height,method='zhang') {
  const mask = source.slice();
  const remove = [];
  let changed = true;
  const at = (x, y) => mask[y * width + x];
  while (changed) {
    changed = false;
    for (let phase = 0; phase < 2; phase += 1) {
      remove.length = 0;
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const i = y * width + x;
          if (!mask[i]) continue;
          const n = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1),
            at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
          if(method==='guo') {
            const [a,b,c,d,e,f,g,h]=n;
            const transitions=(!a&&(b||c))+(!c&&(d||e))+(!e&&(f||g))+(!g&&(h||a));
            const neighbors=Math.min((a||b)+(c||d)+(e||f)+(g||h),(b||c)+(d||e)+(f||g)+(h||a));
            const protectedSide=phase===0?(e||f||!h)&&g:(a||b||!d)&&c;
            if(transitions===1&&neighbors>=2&&neighbors<=3&&!protectedSide)remove.push(i);
            continue;
          }
          const count = n.reduce((sum, value) => sum + value, 0);
          if (count < 2 || count > 6) continue;
          let transitions = 0;
          for (let k = 0; k < 8; k += 1) if (!n[k] && n[(k + 1) % 8]) transitions += 1;
          if (transitions !== 1) continue;
          const [p2, p3, p4, p5, p6, p7, p8, p9] = n;
          const keep = phase === 0
            ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0
            : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0;
          if (keep) remove.push(i);
        }
      }
      if (remove.length) {
        changed = true;
        for (const i of remove) mask[i] = 0;
      }
    }
  }
  return mask;
}

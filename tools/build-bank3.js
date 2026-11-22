// 题库构建（受控配方版）：tools/recipes.js → public/js/bank.generated.js
// 内置两道闸门：轮廓完整性（可见线必须触及包围盒四边）、连通性（大块不超过 2 个）
import { writeFileSync } from 'node:fs';
import { buildCsgMesh, projectView } from './hlr.js';
import { makeRecipe } from './recipes.js';
import { makeConic } from './conic2.js';

const OUT = 'public/js/bank.generated.js';
const TARGET = 240;
const r1 = (v) => Math.round(v * 10) / 10;

/** 端点吸附：把悬空端点吸附到最近线段的最近点上，闭合布尔碎片造成的小缺口
 *  只处理 0.02~tol 之间的空隙（真实缺口通常 < 2mm），不会把远处的线硬拉过来 */
function snapDangling(items, tol = 2.5) {
  const segs = [];
  for (const it of items) {
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') {
      for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    }
  }
  const nearest = (p, s) => {
    const [ax, ay] = s[0];
    const [bx, by] = s[1];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 < 1e-12 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return { d: Math.hypot(p[0] - qx, p[1] - qy), x: qx, y: qy };
  };
  for (let a = 0; a < segs.length; a += 1) {
    for (let e = 0; e < 2; e += 1) {
      const p = segs[a][e];
      let best = null;
      for (let b = 0; b < segs.length; b += 1) {
        if (b === a) continue;
        const r = nearest(p, segs[b]);
        if (!best || r.d < best.d) best = r;
      }
      if (best && best.d > 0.02 && best.d <= tol) {
        p[0] = Math.round(best.x * 10) / 10;
        p[1] = Math.round(best.y * 10) / 10;
      }
    }
  }
}

/** 断线延伸：悬空端点沿自身线段方向延长，遇到别的线段就停在交点处
 *  修的是"线画短了、没接到相邻线上"这类缺陷（布尔碎片丢边留下的缺口） */
function extendDangling(items, maxLen = 6) {
  const segs = [];
  for (const it of items) {
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') {
      for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    }
  }
  const nearestDist = (p, skip) => {
    let best = Infinity;
    for (let b = 0; b < segs.length; b += 1) {
      if (b === skip) continue;
      const [ax, ay] = segs[b][0];
      const [bx, by] = segs[b][1];
      const dx = bx - ax;
      const dy = by - ay;
      const L2 = dx * dx + dy * dy;
      let t = L2 < 1e-12 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
      if (d < best) best = d;
    }
    return best;
  };
  // 线段-线段相交（返回参数 s∈[0,1] 与距离）
  const hit = (p0, dir, s) => {
    const [x1, y1] = s[0];
    const [x2, y2] = s[1];
    const ex = x2 - x1;
    const ey = y2 - y1;
    const den = dir.x * ey - dir.y * ex;
    if (Math.abs(den) < 1e-9) return null;
    const dx = x1 - p0[0];
    const dy = y1 - p0[1];
    const t = (dx * ey - dy * ex) / den; // 沿射线的距离
    const u = (dx * dir.y - dy * dir.x) / den; // 在线段上的参数
    if (t <= 0.05 || t > maxLen) return null;
    if (u < -0.02 || u > 1.02) return null;
    return { t, x: p0[0] + dir.x * t, y: p0[1] + dir.y * t };
  };

  for (let a = 0; a < segs.length; a += 1) {
    const s = segs[a];
    for (let e = 0; e < 2; e += 1) {
      const p = s[e];
      const q = s[1 - e];
      if (nearestDist(p, a) <= 0.05) continue; // 已连上，不动
      const vx = p[0] - q[0];
      const vy = p[1] - q[1];
      const L = Math.hypot(vx, vy);
      if (L < 1e-6) continue;
      const dir = { x: vx / L, y: vy / L };
      let best = null;
      for (let b = 0; b < segs.length; b += 1) {
        if (b === a) continue;
        const r = hit(p, dir, segs[b]);
        if (r && (!best || r.t < best.t)) best = r;
      }
      if (best) {
        p[0] = Math.round(best.x * 10) / 10;
        p[1] = Math.round(best.y * 10) / 10;
      }
    }
  }
}

/** 统计悬空端点数（生成闸门用） */
function danglingCount(items, tol = 2.5) {
  const segs = [];
  for (const it of items) {
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') {
      for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    }
  }
  let n = 0;
  for (let a = 0; a < segs.length; a += 1) {
    for (let e = 0; e < 2; e += 1) {
      const p = segs[a][e];
      let best = Infinity;
      for (let b = 0; b < segs.length; b += 1) {
        if (b === a) continue;
        const [ax, ay] = segs[b][0];
        const [bx, by] = segs[b][1];
        const dx = bx - ax;
        const dy = by - ay;
        const L2 = dx * dx + dy * dy;
        let t = L2 < 1e-12 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
        if (d < best) best = d;
      }
      if (best > tol) n += 1;
    }
  }
  return n;
}


/** 分段链接：把首尾相接的短段串成折线。
 *  球面与回转面相交会在视图里产生几十个短段，不串起来就渲染成断续乱线。 */
function chainSegments(items, tol = 0.20) {
  const isV = (it) => it.lt === 'v';
  // 只链接可见线（虚线保持原样，避免把断开的虚线连成一整条）
  const segs = [];
  for (const it of items) {
    if (!isV(it) || it.t !== 'line') continue;
    segs.push([it.p[0], it.p[1]]);
  }
  if (segs.length < 3) return items;

  const key = (p) => `${Math.round(p[0] / tol)}_${Math.round(p[1] / tol)}`;
  const ends = new Map(); // key -> [{si, ei}]
  segs.forEach((sg, si) => {
    [0, 1].forEach((ei) => {
      const k = key(sg[ei]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ si, ei });
    });
  });
  const used = new Array(segs.length).fill(false);
  const chains = [];
  for (let si = 0; si < segs.length; si += 1) {
    if (used[si]) continue;
    // 从"度不等于 2"的端点起链，否则任意端点起
    let startEnd = 0;
    for (const ei of [0, 1]) {
      const deg = (ends.get(key(segs[si][ei])) || []).length;
      if (deg !== 2) { startEnd = ei; break; }
    }
    const pts = [segs[si][startEnd], segs[si][1 - startEnd]];
    used[si] = true;
    let curEnd = pts[pts.length - 1];
    for (;;) {
      const k = key(curEnd);
      const cand = (ends.get(k) || []).filter((c) => !used[c.si]);
      if (cand.length !== 1) break;  // 分叉或到头
      const c = cand[0];
      used[c.si] = true;
      const sb = segs[c.si][c.ei];
      const other = segs[c.si][1 - c.ei];
      if (Math.hypot(sb[0] - curEnd[0], sb[1] - curEnd[1]) > tol * 1.5) break;
      pts.push(other);
      curEnd = other;
    }
    if (pts.length >= 3) chains.push(pts);
    else {
      // 太短，还原成独立线段
      for (let i = 1; i < pts.length; i += 1) chains.push([pts[i - 1], pts[i]]);
    }
  }
  // 重建 items：保留非可见线 + 链接后的折线
  const out = items.filter((it) => it.lt !== 'v' || it.t !== 'line');
  for (const ch of chains) {
    if (ch.length === 2) out.push({ t: 'line', p: ch, lt: 'v' });
    else out.push({ t: 'poly', pts: ch, lt: 'v' });
  }
  return out;
}


/** 视图级去重：同一几何线常被 CSG 碎片边的多段重复描绘，
 *  在视图里表现为"线又粗又糊、结构看不清"。这里按（方向, 截距）比对，
 *  重叠度高的两条只保留较长的一条。 */
function dedupVisible(items, angTolDeg = 1.2, offTol = 0.35, coverFrac = 0.5) {
  const segs = [];
  for (const it of items) {
    if (it.lt !== 'v') continue;
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') {
      for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    }
  }
  const recs = [];
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang < 0) ang += Math.PI;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const nx = -dy;
    const ny = dx;
    const t0 = dx * a[0] + dy * a[1];
    const t1 = dx * b[0] + dy * b[1];
    recs.push({ a, b, L, ang, nx, ny, off: nx * a[0] + ny * a[1],
                lo: Math.min(t0, t1), hi: Math.max(t0, t1), keep: true });
  }
  const tolA = (angTolDeg * Math.PI) / 180;
  for (let i = 0; i < recs.length; i += 1) {
    if (!recs[i].keep) continue;
    for (let j = i + 1; j < recs.length; j += 1) {
      if (!recs[j].keep) continue;
      const p = recs[i];
      const q = recs[j];
      let dA = Math.abs(p.ang - q.ang);
      if (dA > Math.PI / 2) dA = Math.PI - dA;
      if (dA > tolA) continue;
      const dOff = Math.abs(p.nx * q.a[0] + p.ny * q.a[1] - p.off);
      if (dOff > offTol) continue;
      const ov = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo);
      if (ov <= 0.4) continue;
      if (ov / Math.min(p.L, q.L) < coverFrac) continue;
      if (p.L >= q.L) q.keep = false;
      else { p.keep = false; break; }
    }
  }
  // 保留下来的重新输出为线段，非可见线原样保留（虚线段不合并，避免连成整条）
  const out = items.filter((it) => it.lt !== 'v' || (it.t !== 'line' && it.t !== 'poly'));
  for (const r of recs) if (r.keep) out.push({ t: 'line', p: [r.a, r.b], lt: 'v' });
  return out;
}

function toView(res, expectW, expectH) {
  const all = [...res.visible, ...res.hidden];
  if (!all.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  for (const poly of all) for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const w = r1(expectW);
  const h = r1(expectH);
  const cx = (v) => Math.min(w, Math.max(0, r1(v)));
  const cy = (v) => Math.min(h, Math.max(0, r1(v)));
  const items = [];
  const push = (raw, lt) => {
    // 小幅越界（≤1.5mm，网格毛刺）→ 夹紧保留；大幅越界 → 整段丢弃（那是真正的飞出线段）
    // 早期版本一律丢弃，结果贴边轮廓被整条删掉，视图出现缺口
    let tooFar = false;
    for (const [x, y] of raw) {
      if (x < -1.5 || x > w + 1.5 || y < -1.5 || y > h + 1.5) tooFar = true;
    }
    if (tooFar) return;
    const pts = raw.map(([x, y]) => [cx(x), cy(y)]);
    if (pts.length === 2) {
      // 小于 1mm 的碎线在 2.5px/mm 下不足 2.5 像素，只会把图弄脏（孔口与回转面相交处的布尔碎片）
      if (Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) < 1.0) return;
      items.push({ t: 'line', p: pts, lt });
    } else items.push({ t: 'poly', pts, lt });
  };
  for (const poly of res.visible) push(poly.map(([x, y]) => [x - minX, y - minY]), 'v');
  for (const poly of res.hidden) push(poly.map(([x, y]) => [x - minX, y - minY]), 'h');
  if (!items.some((i) => i.lt === 'v')) return null;
  // 顺序：先补闭合，再去重（去重放最后，避免补闭合重新制造重叠线）
  // 闭合性另由 test/closed.py + tools/prune_closed.py 独立兜底
  snapDangling(items, 2.5);
  extendDangling(items, 6);
  snapDangling(items, 2.5);
  return { w, h, items: chainSegments(dedupVisible(items)) };
}

const visPts = (v) => {
  const pts = [];
  for (const it of v.items) {
    if (it.lt !== 'v') continue;
    if (it.t === 'line') pts.push(...it.p);
    else if (it.t === 'poly') pts.push(...it.pts);
    else if (it.t === 'circle') {
      pts.push([it.c[0] - it.r, it.c[1]], [it.c[0] + it.r, it.c[1]], [it.c[0], it.c[1] - it.r], [it.c[0], it.c[1] + it.r]);
    }
  }
  return pts;
};


/** 闭合轮廓检测：把可见线栅格化，从边框灌水；若闭合面积过小说明轮廓有缺口。
 *  这是专为"回转面转向轮廓线丢失"（叠合体曾出现）设计的闸门。 */
function closedContour(view, targetCells = 170) {
  const segs = [];
  for (const it of view.items) {
    if (it.lt !== 'v') continue;
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') {
      for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    } else if (it.t === 'circle') {
      const K = 24;
      for (let i = 0; i < K; i += 1) {
        const a0 = (i / K) * Math.PI * 2;
        const a1 = ((i + 1) / K) * Math.PI * 2;
        segs.push([[it.c[0] + it.r * Math.cos(a0), it.c[1] + it.r * Math.sin(a0)],
                   [it.c[0] + it.r * Math.cos(a1), it.c[1] + it.r * Math.sin(a1)]]);
      }
    }
  }
  if (segs.length < 3) return false;
  const w = view.w, h = view.h;
  const sc = targetCells / Math.max(w, h);
  // 四周各留 1 格边距，并夹紧索引：否则落在 y=0 / x=w 上的轮廓会被越界丢掉，
  // 导致外部灌水直接漏进内部、闭合判定全灭
  const W = Math.max(12, Math.round(w * sc) + 2);
  const H = Math.max(12, Math.round(h * sc) + 2);
  const g = new Uint8Array(W * H);
  const plot = (x, y) => {
    let ix = Math.round(x * sc) + 1;
    let iy = Math.round((h - y) * sc) + 1;
    ix = Math.min(W - 1, Math.max(0, ix));
    iy = Math.min(H - 1, Math.max(0, iy));
    g[iy * W + ix] = 1;
  };
  for (const [a, b] of segs) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L * sc * 1.6));
    for (let k = 0; k <= n; k += 1) {
      const t = k / n;
      plot(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }
  // 从边框灌水
  const out = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x += 1) { stack.push(x); stack.push((H - 1) * W + x); }
  for (let y = 0; y < H; y += 1) { stack.push(y * W); stack.push(y * W + W - 1); }
  while (stack.length) {
    const o = stack.pop();
    if (o < 0 || o >= W * H || out[o] || g[o]) continue;
    out[o] = 1;
    const x = o % W;
    if (x > 0) stack.push(o - 1);
    if (x < W - 1) stack.push(o + 1);
    if (o >= W) stack.push(o - W);
    if (o < W * (H - 1)) stack.push(o + W);
  }
  let enclosed = 0;
  let total = 0;
  for (let o = 0; o < W * H; o += 1) {
    if (g[o]) continue;
    total += 1;
    if (!out[o]) enclosed += 1;
  }
  return total > 0 && enclosed / total >= 0.06;  // 闭合区域至少占空白面积 6%
}

const spansOk = (v) => {
  const pts = visPts(v);
  if (!pts.length) return false;
  let x0 = 1e9; let x1 = -1e9; let y0 = 1e9; let y1 = -1e9;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x0 <= 0.9 && x1 >= v.w - 0.9 && y0 <= 0.9 && y1 >= v.h - 0.9;
};

const connectedOk = (v) => {
  const segs = [];
  for (const it of v.items) {
    if (it.lt !== 'v') continue;
    if (it.t === 'line') segs.push(it.p);
    else if (it.t === 'poly') for (let i = 1; i < it.pts.length; i += 1) segs.push([it.pts[i - 1], it.pts[i]]);
    else if (it.t === 'circle') segs.push([[it.c[0] - it.r, it.c[1]], [it.c[0] + it.r, it.c[1]]]);
  }
  if (segs.length < 3) return true;
  const len = (s) => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]);
  const key = (p) => `${Math.round(p[0] / 0.6)}_${Math.round(p[1] / 0.6)}`;
  const parent = segs.map((_, i) => i);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const uni = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const endMap = new Map();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      if (endMap.has(k)) uni(i, endMap.get(k));
      else endMap.set(k, i);
    }
  });
  const sums = new Map();
  segs.forEach((s, i) => { const r = find(i); sums.set(r, (sums.get(r) || 0) + len(s)); });
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (!total) return true;
  // 复杂组合体的视图本来就有多个大块（外轮廓 + 各孔口圆 + 横向圆柱），放宽到 4 块
  return [...sums.values()].filter((x) => x / total >= 0.15).length <= 4;
};

const problems = [];
let skipped = 0;
const why = { build: 0, dims: 0, spans: 0, conn: 0, closed: 0, view: 0 };
const seen = new Set();

// 两个来源：受控配方（组合体） + 回转体截交（圆锥/圆台/圆柱）
// 简单组合体减量（140），复杂回转体组合体扩量（240）
const SOURCES = [
  { make: makeRecipe, want: 140, seedMax: 900, label: 'k' },
  { make: makeConic, want: 240, seedMax: 1400, label: 'w' },
];
for (const src of SOURCES) {
  const startAt = problems.length;
  for (let seed = 0; seed < src.seedMax && problems.length < startAt + src.want; seed += 1) {
  let def;
  try { def = src.make(seed); } catch { skipped += 1; continue; }
  const fp = `${def.recipeId}|${def.variant}`;
  if (seen.has(fp)) continue;

  let mesh; let geometry;
  try { ({ mesh, geometry } = buildCsgMesh(def.prims)); } catch { skipped += 1; continue; }
  const bb = geometry.boundingBox;
  const dims = { w: r1(bb.max.x - bb.min.x), d: r1(bb.max.y - bb.min.y), h: r1(bb.max.z - bb.min.z) };
  if (dims.w < 20 || dims.d < 10 || dims.h < 8) { skipped += 1; why.dims += 1; continue; }

  let fv; let tv; let sv;
  try {
    fv = toView(projectView(mesh, 'front', { samples: 6 }), dims.w, dims.h);
    tv = toView(projectView(mesh, 'top', { samples: 6 }), dims.w, dims.d);
    sv = toView(projectView(mesh, 'side', { samples: 6 }), dims.d, dims.h);
  } catch { skipped += 1; continue; }
  if (!fv || !tv || !sv) { skipped += 1; continue; }
  if (!spansOk(fv) || !spansOk(tv) || !spansOk(sv)) { skipped += 1; why.spans += 1; continue; }
  if (!connectedOk(fv) || !connectedOk(tv) || !connectedOk(sv)) { skipped += 1; why.conn += 1; continue; }
  // 第四道闸门：轮廓必须闭合（防止转向轮廓线丢失）
  if (!closedContour(fv) || !closedContour(tv) || !closedContour(sv)) { skipped += 1; why.closed += 1; continue; }
  // 第三道闸门：不允许断头线（线画短了/没接上）
  if (danglingCount(fv.items) || danglingCount(tv.items) || danglingCount(sv.items)) {
    skipped += 1;
    continue;
  }
  seen.add(fp);

  const round = !['plate', 'L', 'T', 'hex'].includes(def.base);
  const cz = r1(dims.h / 2);
  const axes = round
    ? {
        front: [{ t: 'line', p: [[0, cz], [dims.w, cz]], lt: 'c' }],
        top: [
          { t: 'line', p: [[dims.w / 2, 0], [dims.w / 2, dims.d]], lt: 'c' },
          { t: 'line', p: [[0, dims.d / 2], [dims.w, dims.d / 2]], lt: 'c' },
        ],
        side: [{ t: 'line', p: [[0, cz], [dims.d, cz]], lt: 'c' }],
      }
    : { front: [], top: [], side: [] };

  const kinds = def.meta.kinds || { 截交: 0, 相贯: 0 };
  const bits = [kinds.截交 ? `截交 ${kinds.截交}` : '', kinds.相贯 ? `相贯 ${kinds.相贯}` : ''].filter(Boolean);

  problems.push({
    id: `${src.label}${seed + 1}`,
    family: def.recipeId,
    familyName: def.name,
    variant: def.variant,
    title: def.name,
    tag: `综合题（${bits.join(' + ')}）`,
    level: 3,
    methods: def.text.methods,
    features: def.features,
    dims: { ...dims, label: `长 ${dims.w} × 宽 ${dims.d} × 高 ${dims.h}` },
    prims: def.prims,
    views: {
      front: { ...fv, axes: axes.front },
      top: { ...tv, axes: axes.top },
      side: { ...sv, axes: axes.side },
    },
    given: round ? ['front', 'side'] : ['front', 'top'],
    answer: round ? 'top' : 'side',
    solution: {
      method: def.text.methods[0],
      methods: def.text.methods,
      idea: def.text.idea,
      steps: def.text.steps,
      points: [
        { name: 'A', where: '左前下角', front: [0, 0], side: [dims.d, 0], note: 'a 在主视图左下；a″ 在左视图右下' },
        { name: 'B', where: '右前下角', front: [dims.w, 0], side: [dims.d, 0], note: '控制右边界' },
        { name: 'C', where: '右后上角', front: [dims.w, dims.h], side: [0, dims.h], note: '控制高度上限' },
        { name: 'D', where: '左后上角', front: [0, dims.h], side: [0, dims.h], note: '与 C 同高，核对高平齐' },
      ],
      checks: [
        `长对正：主视图宽 ${dims.w} = 俯视图宽 ${dims.w}`,
        `高平齐：主视图高 ${dims.h} = 左视图高 ${dims.h}`,
        `宽相等：俯视图深 ${dims.d} = 左视图宽 ${dims.d}`,
      ],
      pitfalls: def.text.pitfalls,
    },
  });
}

}

const header = `// 自动生成，请勿手改。生成器：tools/build-bank3.js（受控配方）\n// 题目数：${problems.length}　跳过：${skipped}　${new Date().toISOString()}\n`;
const body = `export const BANK = ${JSON.stringify(problems)};\n`;
writeFileSync(OUT, header + body);

const byRec = {};
for (const p of problems) byRec[p.family] = (byRec[p.family] || 0) + 1;
console.log(`\n生成完成：${problems.length} 题（跳过 ${skipped}）`);
console.log('按配方：', byRec);
console.log(`输出 ${OUT}  约 ${((header + body).length / 1024).toFixed(0)} KB`);
console.log("跳过原因:", why);

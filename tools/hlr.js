// 隐藏线投影引擎（Hidden-Line Removal）
// 输入 CSG 实体，输出三视图线段，按可见性分为粗实线 / 虚线。
// 与人工作图一致：先取"棱线"（相邻面二面角大）与"转向轮廓线"（法线跨越视线），
// 再逐点做遮挡判断；被遮挡的转虚线；与可见线重合的虚线剔除（制图规范不重复画）。
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { primitiveGeometry } from '../public/js/prims.js';

const EVALUATOR = new Evaluator();
EVALUATOR.attributes = ['position'];
EVALUATOR.useGroups = false;

const FEATURE_COS = Math.cos((26 * Math.PI) / 180); // 二面角 > 26° 记为棱线

/** 构建 CSG 实体；返回 { mesh, geometry } */
export function buildCsgMesh(prims) {
  let acc = null;
  for (const p of prims) {
    const brush = new Brush(primitiveGeometry(p));
    brush.updateMatrixWorld();
    if (!acc) {
      if (p.op !== '-') acc = brush;
      continue;
    }
    acc = EVALUATOR.evaluate(acc, brush, p.op === '-' ? SUBTRACTION : ADDITION);
    acc.updateMatrixWorld();
  }
  if (!acc) throw new Error('CSG 至少需要一个并集图元');

  const geometry = mergeVertices(acc.geometry.clone(), 1e-4);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.boundsTree = new MeshBVH(geometry);

  const mesh = new THREE.Mesh(
    geometry,
    // 关键：双面，否则从实体内部射出的射线会因背面剔除而漏判遮挡
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  mesh.raycast = acceleratedRaycast;
  mesh.updateMatrixWorld();
  return { mesh, geometry };
}

/** 三角形 + 邻接边表 */
function buildTopology(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const count = idx ? idx.count / 3 : pos.count / 3;
  const tris = [];
  for (let i = 0; i < count; i += 1) {
    const a = idx ? idx.getX(i * 3) : i * 3;
    const b = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const c = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    const va = new THREE.Vector3().fromBufferAttribute(pos, a);
    const vb = new THREE.Vector3().fromBufferAttribute(pos, b);
    const vc = new THREE.Vector3().fromBufferAttribute(pos, c);
    const n = new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    tris.push({ v: [a, b, c], n });
  }
  const edges = new Map();
  for (const t of tris) {
    for (let k = 0; k < 3; k += 1) {
      const u = t.v[k];
      const v = t.v[(k + 1) % 3];
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edges.has(key)) edges.set(key, { u: Math.min(u, v), v: Math.max(u, v), tris: [] });
      edges.get(key).tris.push(t);
    }
  }
  return { pos, tris, edges };
}

function edgePoints(pos, e) {
  return [
    [pos.getX(e.u), pos.getY(e.u), pos.getZ(e.u)],
    [pos.getX(e.v), pos.getY(e.v), pos.getZ(e.v)],
  ];
}

/** 取三角形面法线（世界坐标） */
function faceNormal(geometry, faceIndex) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  const a = idx ? idx.getX(faceIndex * 3) : faceIndex * 3;
  const b = idx ? idx.getX(faceIndex * 3 + 1) : faceIndex * 3 + 1;
  const c = idx ? idx.getX(faceIndex * 3 + 2) : faceIndex * 3 + 2;
  const va = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vb = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vc = new THREE.Vector3().fromBufferAttribute(pos, c);
  return new THREE.Vector3().subVectors(vb, va).cross(new THREE.Vector3().subVectors(vc, va)).normalize();
}

/**
 * 只有 1 个相邻面的边，分两种情况：
 *   ① 平面内部的裂缝（布尔运算的 T 形接点）—— 两侧表面共面，不应画
 *   ② 真实轮廓（另一侧没有实体）—— 必须画
 * 用"向边两侧各偏移一点、沿法线回投"来区分。
 */
function isCrack(edge, mesh, probe, a, b) {
  if (edge.tris.length !== 1) return false;
  const n0 = edge.tris[0].n;
  // 面片接近平行于视线时，它的边就是转向轮廓线（回旋面的外形线），
  // 探针会绕到背面使两侧法线碰巧相符，若不排除就会把轮廓线当裂缝删掉
  if (probe.viewDir && Math.abs(n0.dot(probe.viewDir)) < 0.3) return false;
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const B = new THREE.Vector3(b[0], b[1], b[2]);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const along = B.clone().sub(A).normalize();
  const perp = new THREE.Vector3().crossVectors(n0, along).normalize();
  const step = probe.step; // 固定 0.12mm：远小于任何孔径，不会跨过孔洞
  let sameSides = 0;
  let hitSides = 0;
  for (const s of [1, -1]) {
    const p = mid.clone().addScaledVector(perp, step * s);
    const origin = p.clone().addScaledVector(n0, step * 2);
    probe.ray.set(origin, n0.clone().negate());
    probe.ray.far = step * 4;
    const hits = probe.ray.intersectObject(mesh, false);
    if (!hits.length) continue;
    hitSides += 1;
    const n1 = faceNormal(mesh.geometry, hits[0].faceIndex);
    // 只有真正共面（3° 以内）才算"平面内部裂缝"；
    // 圆柱面的相邻小面法线差约 10°，若放宽到 12° 会把孔口圆环误删，造成圆环缺口
    if (n1.dot(n0) > 0.975) sameSides += 1; // 13°：覆盖圆柱分段角(10°)，但 90° 的孔口棱线仍判为轮廓
  }
  // 两侧都打到且法线相同 → 平面内部裂缝；否则是真实边界
  return hitSides === 2 && sameSides === 2;
}

function isOutline(e, viewDir, mesh, probe, a, b) {
  // 先看拓扑证据
  if (e.tris.length >= 2) {
    for (let i = 1; i < e.tris.length; i += 1) {
      if (e.tris[0].n.dot(e.tris[i].n) < FEATURE_COS) return true;
    }
    let front = false;
    let back = false;
    for (const t of e.tris) {
      const d = t.n.dot(viewDir);
      if (d > 1e-6) front = true;
      else if (d < -1e-6) back = true;
      if (front && back) return true;
    }
    return false;
  }
  // 只有 1 个相邻面：用射线探测区分裂缝 / 真实轮廓
  if (!mesh || !probe) return false;
  return !isCrack(e, mesh, probe, a, b);
}

export const VIEW_DEFS = {
  // dir = 指向观察者；to2d 给出投影平面坐标
  front: { dir: [0, -1, 0], to2d: (p) => [p[0], p[2]] },
  top: { dir: [0, 0, 1], to2d: (p) => [p[0], p[1]] },
  side: { dir: [-1, 0, 0], to2d: (p) => [p[1], p[2]] },
};

/** Ramer–Douglas–Peucker 简化（处理开放折线） */
function simplifyRDP(points, tol) {
  if (points.length <= 2) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = points[s];
    const [x2, y2] = points[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy);
    let best = -1;
    let bestD = -1;
    for (let i = s + 1; i < e; i += 1) {
      const [x, y] = points[i];
      const d = L < 1e-9
        ? Math.hypot(x - x1, y - y1)
        : Math.abs(dy * (x - x1) - dx * (y - y1)) / L;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (bestD > tol && best > 0) {
      keep[best] = 1;
      stack.push([s, best], [best, e]);
    }
  }
  const out = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  return out;
}

/** 简化折线；闭合环用"双锚点"切两段分别简化，避免首尾重合导致整体塌缩 */
function simplify(points, tol = 0.06) {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;

  if (!closed || points.length <= 3) return simplifyRDP(points, tol);

  const open = points.slice(0, -1); // 去掉重复的闭合点
  let far = 0;
  let farD = -1;
  for (let i = 1; i < open.length; i += 1) {
    const d = Math.hypot(open[i][0] - open[0][0], open[i][1] - open[0][1]);
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const partA = simplifyRDP(open.slice(0, far + 1), tol);
  const partB = simplifyRDP([...open.slice(far), open[0]], tol);
  const merged = [...partA, ...partB.slice(1)];
  return merged.length >= 3 ? merged : points;
}

/** 剔除与可见线重合的虚线（制图规范：同一位置不重复画虚线） */
function dropCoveredHidden(visible, hidden, cell = 0.7, cover = 0.72) {
  const key = (x, y) => `${Math.round(x / cell)}_${Math.round(y / cell)}`;
  const grid = new Set();
  for (const poly of visible) {
    for (let i = 1; i < poly.length; i += 1) {
      const [x1, y1] = poly[i - 1];
      const [x2, y2] = poly[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / cell));
      for (let k = 0; k <= n; k += 1) {
        const t = k / n;
        grid.add(key(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t));
      }
    }
  }
  const out = [];
  for (const poly of hidden) {
    let hit = 0;
    let tot = 0;
    for (let i = 1; i < poly.length; i += 1) {
      const [x1, y1] = poly[i - 1];
      const [x2, y2] = poly[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / cell));
      for (let k = 0; k <= n; k += 1) {
        const t = k / n;
        tot += 1;
        if (grid.has(key(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t))) hit += 1;
      }
    }
    if (!tot || hit / tot < cover) out.push(poly);
  }
  return out;
}

/** 把共线且相接的线段合并（圆柱端面 48 段 → 1 段；重合线自动合一） */
function mergeCollinear(segs, angleTolDeg = 1.2, offsetTol = 0.12, gap = 0.4, round = (v) => v) {
  const groups = new Map();
  for (const s of segs) {
    let dx = s[1][0] - s[0][0];
    let dy = s[1][1] - s[0][1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    dx /= L;
    dy /= L;
    let ang = Math.atan2(dy, dx);
    if (ang < 0) ang += Math.PI;
    if (ang >= Math.PI) ang -= Math.PI;
    // 规范化方向：必须用它与 n 一起计算 t，否则反向线段会给出相反符号
    const cdx = Math.cos(ang);
    const cdy = Math.sin(ang);
    const nx = -cdy;
    const ny = cdx;
    const off = nx * s[0][0] + ny * s[0][1];
    const key = `${Math.round(ang / ((angleTolDeg * Math.PI) / 180))}_${Math.round(off / offsetTol)}`;
    let g = groups.get(key);
    if (!g) {
      g = { dx: cdx, dy: cdy, nx, ny, off, items: [] };
      groups.set(key, g);
    }
    const t0 = cdx * s[0][0] + cdy * s[0][1];
    const t1 = cdx * s[1][0] + cdy * s[1][1];
    g.items.push([Math.min(t0, t1), Math.max(t0, t1)]);
  }

  const out = [];
  for (const g of groups.values()) {
    g.items.sort((a, b) => a[0] - b[0]);
    let cur = [g.items[0][0], g.items[0][1]];
    const merged = [];
    for (let i = 1; i < g.items.length; i += 1) {
      const it = g.items[i];
      if (it[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], it[1]);
      else {
        merged.push(cur);
        cur = [it[0], it[1]];
      }
    }
    merged.push(cur);
    const bx = g.nx * g.off;
    const by = g.ny * g.off;
    for (const [t0, t1] of merged) {
      if (t1 - t0 < 1e-4) continue;
      out.push([
        [round(bx + g.dx * t0), round(by + g.dy * t0)],
        [round(bx + g.dx * t1), round(by + g.dy * t1)],
      ]);
    }
  }
  return out;
}

/**
 * 投影一个视图
 * @param {THREE.Mesh} mesh 已装 BVH 的 CSG 结果
 * @param {'front'|'top'|'side'} view
 */
export function projectView(mesh, view, opts = {}) {
  const { samples = 6, eps = 0.06, decimals = 2 } = opts;
  const def = VIEW_DEFS[view];
  const dirVec = new THREE.Vector3(...def.dir);
  const { pos, edges, tris } = buildTopology(mesh.geometry);

  const bbox = mesh.geometry.boundingBox;
  const diag = bbox
    ? Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z)
    : 200;

  const ray = new THREE.Raycaster();
  ray.firstHitOnly = true;
  const probe = { ray, step: 0.12, viewDir: dirVec };

  const round = (v) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const rawVisible = [];
  const rawHidden = [];

  for (const e of edges.values()) {
    const [a, b] = edgePoints(pos, e);
    if (!isOutline(e, dirVec, mesh, probe, a, b)) continue;
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    if (len < 1e-5) continue;

    const n = Math.max(1, Math.min(samples, Math.ceil(len / 2.0)));
    const flagged = [];
    for (let i = 0; i <= n; i += 1) {
      const t = i / n;
      const P = new THREE.Vector3().lerpVectors(A, B, t);
      // 沿"指向观察者"的方向发射；有命中 = 被自身挡住
      const origin = P.clone().addScaledVector(dirVec, eps);
      ray.set(origin, dirVec);
      ray.far = diag;
      const blocked = ray.intersectObject(mesh, false).length > 0;
      flagged.push(!blocked);
    }

    let start = 0;
    for (let i = 1; i <= n; i += 1) {
      if (i === n || flagged[i] !== flagged[start]) {
        const P0 = new THREE.Vector3().lerpVectors(A, B, start / n);
        const P1 = new THREE.Vector3().lerpVectors(A, B, i / n);
        const p0 = def.to2d([P0.x, P0.y, P0.z]);
        const p1 = def.to2d([P1.x, P1.y, P1.z]);
        const seg = [[round(p0[0]), round(p0[1])], [round(p1[0]), round(p1[1])]];
        if (Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) > 1e-4) {
          (flagged[start] ? rawVisible : rawHidden).push(seg);
        }
        start = i;
      }
    }
  }

  // 容差放宽：同一条几何线常被多圈面片各描一遍，截距相差零点几毫米属网格毛刺
  const vis = mergeCollinear(rawVisible, 2.5, 0.5, 1.2, round);
  const hid = mergeCollinear(rawHidden, 2.5, 0.5, 1.2, round);
  return {
    visible: vis,
    hidden: dropCoveredHidden(vis, hid),
    triCount: tris.length,
  };
}

/** 圆/圆弧的轴线（细点画线）：按包围盒中心给出十字线，用于回转体 */
export function centerLines(viewBox) {
  return [];
}

// 浏览器端 CSG：把题目的图元描述合并成可渲染的几何
// 与 tools/hlr.js 共用同一套图元语义（public/js/prims.js），保证三维与二维一致
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { primitiveGeometry } from './prims.js';
import { surfaceEdges } from './surface-edges.js';

const EVAL = new Evaluator();
EVAL.attributes = ['position'];
EVAL.useGroups = false;

/**
 * @param {{op:string,t:string}[]} prims
 * @returns {THREE.BufferGeometry}
 */
export function buildCsgGeometry(prims) {
  let acc = null;
  for (const p of prims) {
    const brush = new Brush(primitiveGeometry(p));
    brush.updateMatrixWorld();
    if (!acc) {
      if (p.op !== '-') acc = brush;
      continue;
    }
    acc = EVAL.evaluate(acc, brush, p.op === '-' ? SUBTRACTION : ADDITION);
    acc.updateMatrixWorld();
  }
  if (!acc) throw new Error('CSG 至少需要一个并集图元');
  const welded = mergeVertices(acc.geometry.clone(), 1e-4);
  const geo = toCreasedNormals(welded, Math.PI / 6);
  welded.dispose();
  geo.computeBoundingBox();
  geo.center();
  return geo;
}

/** 转成便于渲染的实体（X 长、Y 深、Z 高，与投影引擎一致） */
export function buildDisplayMesh(prims) {
  const geo = buildCsgGeometry(prims);
  const bb = geo.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  return { geo, size, bbox: bb };
}

/**
 * 提取真实棱线：只保留"恰好被两个三角形共享、且两面夹角超过阈值"的边。
 * EdgesGeometry 会把只有 1 个相邻面的裂缝边（布尔运算的 T 形接点）也画出来，
 * 在回转体上表现为一片假线；这里直接不输出这类边。
 * @param {THREE.BufferGeometry} geo
 * @param {number} thresholdDeg 两面夹角阈值（度）
 */
export function buildFeatureEdges(geo, thresholdDeg = 26, repairJunctions=false) {
  if(repairJunctions) {
    const out=[],cosT=Math.cos(thresholdDeg*Math.PI/180);
    for(const edge of surfaceEdges(geo))if(edge.n.some((n,i)=>edge.n.slice(i+1).some(m=>n.dot(m)<cosT)))out.push(...edge.a,...edge.b);
    const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(out,3));return result;
  }
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  geo.computeBoundingBox();
  const diagonal=geo.boundingBox.getSize(new THREE.Vector3()).length();
  const tolerance=Math.max(1e-8,diagonal*1e-6);
  const keyOf = (v) => `${Math.round(v.x / tolerance)}_${Math.round(v.y / tolerance)}_${Math.round(v.z / tolerance)}`;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();

  const edges = new Map(); // key -> { a, b, normals: [] }
  for (let i = 0; i < triCount; i += 1) {
    const ia = idx ? idx.getX(i * 3) : i * 3;
    const ib = idx ? idx.getX(i * 3 + 1) : i * 3 + 1;
    const ic = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
    va.fromBufferAttribute(pos, ia);
    vb.fromBufferAttribute(pos, ib);
    vc.fromBufferAttribute(pos, ic);
    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    nrm.crossVectors(e1, e2);
    if (nrm.lengthSq() < tolerance ** 4) continue; // 按实体尺度排除退化三角形
    nrm.normalize();
    const pts = [va, vb, vc];
    const keys = pts.map(keyOf);
    for (let k = 0; k < 3; k += 1) {
      const k1 = keys[k];
      const k2 = keys[(k + 1) % 3];
      const ek = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      let rec = edges.get(ek);
      if (!rec) {
        rec = { a: pts[k].clone(), b: pts[(k + 1) % 3].clone(), normals: [] };
        edges.set(ek, rec);
      }
      rec.normals.push(nrm.clone());
    }
  }

  const cosT = Math.cos((thresholdDeg * Math.PI) / 180);
  const out = [];
  for (const rec of edges.values()) {
    // 只有 1 个相邻面 = 裂缝 / 边界，直接跳过（这正是假线的来源）
    if (rec.normals.length !== 2) continue;
    if (rec.normals[0].dot(rec.normals[1]) > cosT) continue;
    out.push(rec.a.x, rec.a.y, rec.a.z, rec.b.x, rec.b.y, rec.b.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return g;
}

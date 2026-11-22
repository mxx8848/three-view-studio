// 图元几何（浏览器与 Node 共用）
// 坐标约定：X = 长（右为正）、Y = 深（0 为前）、Z = 高（0 为底）
// 每个图元都带 op：'+' 并入 / '-' 挖去
import * as THREE from 'three';

/** 由平面法向与平面上一点构造"半空间"盒子，用于任意斜切 */
function halfSpaceGeometry(n, p0, size) {
  const nv = new THREE.Vector3(n[0], n[1], n[2]).normalize();
  const g = new THREE.BoxGeometry(size, size, size);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nv);
  g.applyQuaternion(q);
  // 盒子中心 = 平面上的点 + 法向 * size/2 → 盒子恰好占住法向正侧
  g.translate(p0[0] + nv.x * size * 0.5, p0[1] + nv.y * size * 0.5, p0[2] + nv.z * size * 0.5);
  return g;
}

export function primitiveGeometry(p) {
  const seg = p.seg || 36;
  let g;
  switch (p.t) {
    case 'box':
      g = new THREE.BoxGeometry(p.w, p.d, p.h);
      g.translate(p.x + p.w / 2, p.y + p.d / 2, p.z + p.h / 2);
      break;

    case 'cyl': // 轴线沿 Z
      g = new THREE.CylinderGeometry(p.r, p.r, p.h, seg, 1);
      g.rotateX(Math.PI / 2);
      g.translate(p.x, p.y, p.z + p.h / 2);
      break;

    case 'cylX': // 轴线沿 X
      g = new THREE.CylinderGeometry(p.r, p.r, p.h, seg, 1);
      g.rotateZ(Math.PI / 2);
      g.translate(p.x + p.h / 2, p.y, p.z);
      break;

    case 'cylY': // 轴线沿 Y
      g = new THREE.CylinderGeometry(p.r, p.r, p.h, seg, 1);
      g.translate(p.x, p.y + p.h / 2, p.z);
      break;

    case 'cone': // 轴线沿 Z；r1 = 底半径，r2 = 顶半径
      g = new THREE.CylinderGeometry(p.r2, p.r1, p.h, seg, 1);
      g.rotateX(Math.PI / 2);
      g.translate(p.x, p.y, p.z + p.h / 2);
      break;

    case 'sphere':
      g = new THREE.SphereGeometry(p.r, seg, Math.max(16, Math.round(seg / 2)));
      g.translate(p.x, p.y, p.z);
      break;

    case 'prism': { // 正 n 棱柱，轴线沿 Y
      const shape = new THREE.Shape();
      for (let i = 0; i < p.n; i += 1) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / p.n;
        const px = Math.cos(a) * p.r;
        const py = Math.sin(a) * p.r;
        if (i === 0) shape.moveTo(px, py);
        else shape.lineTo(px, py);
      }
      shape.closePath();
      g = new THREE.ExtrudeGeometry(shape, { depth: p.depth, bevelEnabled: false, steps: 1 });
      g.rotateX(-Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      break;
    }

    case 'half': // 半空间：保留法向负侧（用于斜切 / 水平截）
      g = halfSpaceGeometry(p.n, p.p0, p.size || 400);
      break;

    default:
      throw new Error('未知图元 ' + p.t);
  }
  return g;
}

/** 图元体积近似（仅用于排序/校验，不求精确） */
export function primitiveInfo(p) {
  switch (p.t) {
    case 'box': return `长方体 ${p.w}×${p.d}×${p.h}`;
    case 'cyl': return `圆柱 Ø${(p.r * 2).toFixed(2)}×${p.h}`;
    case 'cylX': return `横向圆柱 Ø${(p.r * 2).toFixed(2)}×${p.h}`;
    case 'cylY': return `前后向圆柱 Ø${(p.r * 2).toFixed(2)}×${p.h}`;
    case 'cone': return `圆锥/圆台 R${p.r1}→${p.r2}×${p.h}`;
    case 'sphere': return `球 R${p.r}`;
    case 'prism': return `${p.n} 棱柱 R${p.r}×${p.depth}`;
    case 'half': return '斜切平面';
    default: return p.t;
  }
}

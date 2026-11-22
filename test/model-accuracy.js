import assert from 'node:assert/strict';
import { reconstructFromViews } from '../public/js/reconstruct.js';
import { buildCsgGeometry } from '../public/js/csg3d.js';

// Asymmetry in both height and depth detects mirroring hidden by box-only tests.
const n = 24, width = 70, height = 70;
const roles = { front: { x: 2, y: 2, w: 28, h: 28 }, top: { x: 2, y: 36, w: 28, h: 28 }, side: { x: 36, y: 2, w: 28, h: 28 } };
const masks = Object.fromEntries(Object.keys(roles).map(k => [k, new Uint8Array(n * n)]));
for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
  if (!(z < 8 || (x < 12 && y >= 12))) continue;
  masks.front[(n - 1 - z) * n + x] = 1;
  masks.top[(n - 1 - y) * n + x] = 1;
  masks.side[(n - 1 - z) * n + (n - 1 - y)] = 1;
}
const ink = new Uint8Array(width * height);
for (const [role, mask] of Object.entries(masks)) {
  const box = roles[role];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (mask[i] && (x === 0 || y === 0 || x === n - 1 || y === n - 1 || !mask[i-1] || !mask[i+1] || !mask[i-n] || !mask[i+n])) {
      ink[(box.y + 2 + y) * width + box.x + 2 + x] = 1;
    }
  }
}
const result = reconstructFromViews({ ink, w: width, h: height, roles, views: Object.values(roles) }, { res: n });
assert.ok(result.ok, result.reason);
const at = (x, y, z) => result.occupancy[(z * n + y) * n + x];
assert.equal(at(6, 18, 20), 1, 'rear upper tower must remain at the rear and top');
assert.equal(at(6, 6, 20), 0, 'front must not receive the rear tower');
assert.equal(at(18, 18, 20), 0, 'right must not receive the left tower');
assert.equal(at(18, 6, 4), 1, 'base must remain at the bottom');
assert.ok(Object.values(result.projectionFit).every(v => v > .95));
assert.equal(result.silhouetteBounds.front.x, 2, 'overlay must preserve crop margin');

// Inner closed lines also occur on bosses; they cannot be treated as through holes.
const drawRect = (x0, y0, x1, y1) => {
  for (let x = x0; x <= x1; x++) ink[y0 * width + x] = ink[y1 * width + x] = 1;
  for (let y = y0; y <= y1; y++) ink[y * width + x0] = ink[y * width + x1] = 1;
};
ink.fill(0);
for (const box of Object.values(roles)) {
  drawRect(box.x + 2, box.y + 2, box.x + 25, box.y + 25);
  drawRect(box.x + 8, box.y + 8, box.x + 13, box.y + 13);
}
const boss = reconstructFromViews({ ink, w: width, h: height, roles, views: Object.values(roles) }, { res: n });
assert.ok(boss.ok);
assert.equal(boss.cells, n ** 3, 'unclassified closed inner lines must not cut tunnels');
for (let i = 0; i < boss.indices.length; i += 3) {
  const points = Array.from({length: 3}, (_, j) => Array.from(boss.positions.slice(boss.indices[i+j]*3, boss.indices[i+j]*3+3)));
  const [a,b,c] = points, ab=b.map((v,k)=>v-a[k]), ac=c.map((v,k)=>v-a[k]);
  const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
  assert.ok(normal.reduce((sum,v,k)=>sum+v*a[k],0)>0,'surface triangles must face outward');
}

const geometry = buildCsgGeometry([{ t:'box', op:'+', x:0,y:0,z:0,w:30,d:20,h:10 }]);
const normal = geometry.getAttribute('normal');
for (let i=0;i<normal.count;i++) {
  const components=[normal.getX(i),normal.getY(i),normal.getZ(i)].map(Math.abs);
  assert.ok(components.some(v=>Math.abs(v-1)<1e-5), 'box normals must preserve sharp planar faces');
}
geometry.dispose();
console.log('Asymmetric reconstruction, crop alignment, hole ambiguity, outward surfaces and sharp CSG normals passed');

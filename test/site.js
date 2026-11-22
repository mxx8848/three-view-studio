// Site smoke checks, including all browser modules and local dependencies.
import assert from 'node:assert/strict';
import { PROBLEMS } from '../public/js/problems.js';
const base = process.env.SITE_BASE_URL || 'http://127.0.0.1:5178';
let passed = 0;
async function get(path) {
  const response = await fetch(base + path);
  assert.ok(response.ok, path + ': HTTP ' + response.status);
  passed += 1;
  return response;
}
const html = await (await get('/')).text();
for (const id of ['view-learn', 'view-methods', 'view-bank', 'btnPractice', 'methodsList']) assert.ok(html.includes(id), id);
assert.ok(html.includes('three-bvh-csg') && html.includes('three-mesh-bvh'));
for (const path of [
  '/styles.css', '/js/app.js', '/js/problems.js', '/js/methods.js', '/js/prims.js', '/js/csg3d.js',
  '/js/reconstruct.js', '/js/viewer3d.js', '/js/views2d.js', '/js/recognize.js',
  '/js/drawing-lesson.js', '/js/smooth-mesh.js', '/js/view-layout.js',
  '/js/upload-lines.js', '/js/upload-board.js', '/js/upload-workspace.js',
  '/js/upload-model.js', '/js/upload-analysis.js', '/js/upload-projection.js',
  '/js/upload-joint-solver.js', '/worker-modules/js/upload-joint-solver.js',
  '/js/upload-parallel-sections.js', '/worker-modules/js/upload-parallel-sections.js',
  '/js/upload-cross-drill.js', '/worker-modules/js/upload-cross-drill.js',
  '/js/upload-dash-support.js', '/worker-modules/js/upload-dash-support.js',
  '/js/upload-rectilinear.js', '/worker-modules/js/upload-rectilinear.js',
  '/js/upload-layered-structures.js', '/worker-modules/js/upload-layered-structures.js',
  '/js/upload-compound-constraints.js', '/worker-modules/js/upload-compound-constraints.js',
  '/js/surface-edges.js',
  '/js/upload-drawing.js', '/js/upload-curves.js', '/vendor/jsm/lines/LineSegments2.js',
  '/js/upload-contours.js', '/worker-modules/js/upload-contours.js',
  '/js/upload-task.js', '/worker-modules/js/upload-worker.js',
  '/js/upload-loading.js', '/js/upload-startup.js',
  '/worker-modules/js/upload-analysis.js', '/worker-modules/vendor/three.module.js',
  '/worker-modules/js/bank.generated.js',
  '/worker-modules/vendor/three.core.js', '/worker-modules/vendor/csg/index.module.js',
  '/worker-modules/vendor/meshbvh/index.module.js', '/worker-modules/vendor/jsm/utils/BufferGeometryUtils.js',
  '/vendor/jsm/lines/LineSegmentsGeometry.js', '/vendor/jsm/lines/LineMaterial.js',
  '/vendor/three.module.js', '/vendor/three.core.js', '/vendor/jsm/controls/OrbitControls.js',
  '/vendor/jsm/utils/BufferGeometryUtils.js', '/vendor/jsm/objects/MarchingCubes.js',
  '/vendor/csg/index.module.js', '/vendor/meshbvh/index.module.js',
]) await get(path);
const bankResponse = await get('/js/bank.generated.js');
assert.equal(bankResponse.headers.get('content-encoding'), 'gzip');
const bankText = await bankResponse.text();
const match = bankText.match(/export const BANK = (\[.*\]);/s);
assert.ok(match, 'bank export');
assert.equal(JSON.parse(match[1]).length, PROBLEMS.length);
assert.ok((await (await get('/api/health')).json()).uid);
assert.ok((await (await get('/api/data')).json()).uid);
console.log(passed + ' site resources and endpoints passed; bank count ' + PROBLEMS.length);

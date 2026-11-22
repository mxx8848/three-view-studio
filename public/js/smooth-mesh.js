import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

export function buildSmoothSurface(occupancy, resolution, size, THREE) {
  const padded = resolution + 2;
  const marcher = new MarchingCubes(padded, new THREE.MeshBasicMaterial(), false, false, 300000);
  marcher.isolation = 0.5;
  const weights = [1, 2, 1];
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let sum = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const sx = x + dx, sy = y + dy, sz = z + dz;
              if (sx < 0 || sy < 0 || sz < 0 || sx >= resolution || sy >= resolution || sz >= resolution) continue;
              sum += occupancy[(sz * resolution + sy) * resolution + sx] * weights[dx + 1] * weights[dy + 1] * weights[dz + 1];
            }
          }
        }
        marcher.setCell(x + 1, y + 1, z + 1, sum / 64);
      }
    }
  }
  marcher.update();
  const source = marcher.geometry;
  const count = marcher.count;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.attributes.position.array.slice(0, count * 3), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.attributes.normal.array.slice(0, count * 3), 3));
  geometry.scale(size.x * padded / (2 * resolution), size.y * padded / (2 * resolution), size.z * padded / (2 * resolution));
  geometry.translate(size.x / (2 * resolution), size.y / (2 * resolution), size.z / (2 * resolution));
  geometry.computeBoundingBox();
  marcher.material.dispose();
  marcher.geometry.dispose();
  return geometry;
}

import {
  BufferAttribute,
  type BufferGeometry,
  BufferGeometry as Geometry,
  type Material,
  Matrix3,
  Matrix4,
  Mesh,
  type Object3D,
  Vector3,
} from '@iwsdk/core';

/**
 * Merges every static mesh under `root` into one mesh per material, so a room
 * built from hundreds of boxes and props draws in a few dozen calls instead
 * of hundreds. Draw calls, not triangles, are what limit Quest frame rate.
 *
 * Only plain meshes are merged; skinned, instanced and morphing meshes are
 * left alone. Positions and normals are baked into `root`'s space. Returns
 * how many meshes were folded away.
 */
export function mergeStatic(root: Object3D): number {
  root.updateWorldMatrix(true, true);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: Material; meshes: Mesh[] }>();

  root.traverse((o) => {
    const mesh = o as Mesh & { isSkinnedMesh?: boolean; isInstancedMesh?: boolean };
    if (!mesh.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || !mesh.visible) return;
    if (Array.isArray(mesh.material)) return;
    const g = mesh.geometry;
    if (g.morphAttributes && Object.keys(g.morphAttributes).length > 0) return;
    // Boxes and cylinders carry per-face draw groups; with one material they
    // draw the same as a whole, so they merge fine.
    const attrs = Object.keys(g.attributes).sort().join(',');
    const key = `${mesh.material.uuid}|${attrs}|${g.index ? 'indexed' : 'plain'}`;
    const entry = groups.get(key) ?? { material: mesh.material, meshes: [] };
    entry.meshes.push(mesh);
    groups.set(key, entry);
  });

  let folded = 0;
  const matrix = new Matrix4();
  const normalMatrix = new Matrix3();
  const v = new Vector3();
  for (const { material, meshes } of groups.values()) {
    if (meshes.length < 2) continue;
    const merged = combine(meshes, toRoot, matrix, normalMatrix, v);
    if (!merged) continue;
    const mesh = new Mesh(merged, material);
    mesh.name = `merged:${material.name || material.type}`;
    root.add(mesh);
    for (const m of meshes) m.removeFromParent();
    folded += meshes.length - 1;
  }
  return folded;
}

/** Merges meshes already in a common space (identity transforms) into one geometry. */
export function mergeGeometries(meshes: Mesh[]): BufferGeometry | null {
  if (meshes.length === 0) return null;
  for (const m of meshes) m.updateMatrixWorld();
  return combine(meshes, new Matrix4(), new Matrix4(), new Matrix3(), new Vector3());
}

function combine(meshes: Mesh[], toRoot: Matrix4, matrix: Matrix4, normalMatrix: Matrix3, v: Vector3): BufferGeometry | null {
  const first = meshes[0].geometry;
  const names = Object.keys(first.attributes);
  let vertexCount = 0;
  let indexCount = 0;
  for (const m of meshes) {
    vertexCount += m.geometry.getAttribute('position').count;
    indexCount += m.geometry.index ? m.geometry.index.count : 0;
  }

  const out = new Geometry();
  for (const name of names) {
    const itemSize = first.getAttribute(name).itemSize;
    const data = new Float32Array(vertexCount * itemSize);
    let offset = 0;
    for (const m of meshes) {
      const attr = m.geometry.getAttribute(name);
      if (!attr || attr.itemSize !== itemSize) return null;
      matrix.multiplyMatrices(toRoot, m.matrixWorld);
      normalMatrix.getNormalMatrix(matrix);
      for (let i = 0; i < attr.count; i += 1) {
        if (name === 'position') {
          v.fromBufferAttribute(attr, i).applyMatrix4(matrix);
          data[offset++] = v.x;
          data[offset++] = v.y;
          data[offset++] = v.z;
        } else if (name === 'normal') {
          v.fromBufferAttribute(attr, i).applyMatrix3(normalMatrix).normalize();
          data[offset++] = v.x;
          data[offset++] = v.y;
          data[offset++] = v.z;
        } else {
          data[offset++] = attr.getX(i);
          if (itemSize > 1) data[offset++] = attr.getY(i);
          if (itemSize > 2) data[offset++] = attr.getZ(i);
          if (itemSize > 3) data[offset++] = attr.getW(i);
        }
      }
    }
    // getX() already de-normalizes packed data, so the output is plain floats.
    out.setAttribute(name, new BufferAttribute(data, itemSize, false));
  }

  if (first.index) {
    const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
    let at = 0;
    let base = 0;
    for (const m of meshes) {
      const src = m.geometry.index!;
      for (let i = 0; i < src.count; i += 1) index[at++] = src.getX(i) + base;
      base += m.geometry.getAttribute('position').count;
    }
    out.setIndex(new BufferAttribute(index, 1));
  }
  out.computeBoundingSphere();
  return out;
}

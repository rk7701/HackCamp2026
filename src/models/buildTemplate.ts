import * as THREE from 'three';
import type { DimensionsM } from '../domain/dimensions';
import type { BookshelfShape, TableShape, TemplateDef } from '../catalog/templates';

/** Bounding box must match the requested size within this tolerance (meters). */
export const BOUNDS_TOLERANCE_M = 0.001;

/**
 * Build the furniture as a Three.js group: centered on X/Z, lowest surface at Y = 0,
 * outer bounds exactly equal to the requested dimensions. Contains only furniture meshes.
 */
export function buildTemplate(def: TemplateDef, size: DimensionsM): THREE.Group {
  const material = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7, metalness: 0 });
  const root = new THREE.Group();
  root.name = def.id;

  const shape = def.shape;
  if (shape.kind === 'table') addTable(root, size, shape, material);
  else if (shape.kind === 'bookshelf') addBookshelf(root, size, shape, material);
  else addSeating(root, size, shape.kind, material);

  assertBounds(root, size);
  return root;
}

function addSeating(root: THREE.Group, s: DimensionsM, kind: 'chair' | 'sofa', mat: THREE.Material) {
  const seatBottom = s.height * 0.4;
  const seatThickness = s.height * 0.16;
  const backThickness = s.depth * 0.13;
  const leg = Math.min(s.width * 0.08, s.depth * 0.08);
  root.add(box(s.width, seatThickness, s.depth, 0, seatBottom + seatThickness / 2, 0, mat, 'seat'));
  const backHeight = s.height - seatBottom - seatThickness;
  root.add(box(s.width, backHeight, backThickness, 0, s.height - backHeight / 2,
    -s.depth / 2 + backThickness / 2, mat, 'backrest'));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      root.add(box(leg, seatBottom, leg, sx * (s.width / 2 - leg), seatBottom / 2,
        sz * (s.depth / 2 - leg), mat, 'leg'));
    }
  }
  if (kind === 'sofa') {
    const arm = s.width * 0.08;
    for (const sx of [-1, 1]) {
      root.add(box(arm, s.height * 0.24, s.depth, sx * (s.width - arm) / 2,
        seatBottom + seatThickness + s.height * 0.12, 0, mat, 'armrest'));
    }
  }
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.name = name;
  return mesh;
}

function addTable(root: THREE.Group, s: DimensionsM, shape: TableShape, mat: THREE.Material) {
  // Clamp shape parameters so small tables still produce valid geometry.
  const top = Math.min(shape.topThickness, s.height * 0.25);
  const leg = Math.min(shape.legThickness, s.width / 5, s.depth / 5);
  const inset = Math.min(shape.legInset, s.width / 10, s.depth / 10);
  const legHeight = s.height - top;

  root.add(box(s.width, top, s.depth, 0, s.height - top / 2, 0, mat, 'tabletop'));

  const lx = s.width / 2 - inset - leg / 2;
  const lz = s.depth / 2 - inset - leg / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    root.add(box(leg, legHeight, leg, sx * lx, legHeight / 2, sz * lz, mat, 'leg'));
  }
}

function addBookshelf(root: THREE.Group, s: DimensionsM, shape: BookshelfShape, mat: THREE.Material) {
  const t = Math.min(shape.panelThickness, s.width / 10, s.depth / 10);
  const innerW = s.width - 2 * t;

  // Sides span full height and depth.
  for (const sx of [-1, 1]) {
    root.add(box(t, s.height, s.depth, sx * (s.width / 2 - t / 2), s.height / 2, 0, mat, 'side'));
  }
  // Back panel sits inside the depth.
  root.add(box(innerW, s.height, t, 0, s.height / 2, -s.depth / 2 + t / 2, mat, 'back'));

  // Bottom, top and evenly spaced shelves between them.
  const count = Math.max(1, Math.round((s.height - t) / shape.shelfSpacing));
  const step = (s.height - t) / count;
  for (let i = 0; i <= count; i++) {
    root.add(box(innerW, t, s.depth - t, 0, t / 2 + i * step, t / 2, mat, i === 0 ? 'bottom' : i === count ? 'top' : 'shelf'));
  }
}

export function measure(root: THREE.Object3D): { size: THREE.Vector3; box: THREE.Box3 } {
  root.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(root);
  return { size: b.getSize(new THREE.Vector3()), box: b };
}

function assertBounds(root: THREE.Object3D, s: DimensionsM) {
  const { size, box: b } = measure(root);
  const off =
    Math.abs(size.x - s.width) > BOUNDS_TOLERANCE_M ||
    Math.abs(size.y - s.height) > BOUNDS_TOLERANCE_M ||
    Math.abs(size.z - s.depth) > BOUNDS_TOLERANCE_M ||
    Math.abs(b.min.y) > BOUNDS_TOLERANCE_M ||
    Math.abs(b.min.x + b.max.x) > BOUNDS_TOLERANCE_M ||
    Math.abs(b.min.z + b.max.z) > BOUNDS_TOLERANCE_M;
  if (off) {
    throw new Error(
      `Generated model is ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, expected ${s.width} x ${s.height} x ${s.depth} m`,
    );
  }
}

/** Free GPU-side resources of a generated group once it has been exported. */
export function disposeGroup(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => materials.add(m));
    }
  });
  materials.forEach((m) => m.dispose());
}

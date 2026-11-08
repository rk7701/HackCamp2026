import * as THREE from 'three';
import type { DimensionsM } from '../domain/dimensions';
import type { LegStyle, TemplateDef, TemplateShape } from '../catalog/templates';

/** Bounding box must match the requested size within this tolerance (meters). */
export const BOUNDS_TOLERANCE_M = 0.001;

type Mats = {
  main: THREE.Material;
  /** Darker shade of main, shown in gaps between drawer fronts and doors. */
  inner: THREE.Material;
  frame: THREE.Material;
  soft: THREE.Material;
  metal: THREE.Material;
};

function materials(def: TemplateDef): Mats {
  const main = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.7, metalness: 0 });
  const innerColor = new THREE.Color(def.color).multiplyScalar(0.7);
  return {
    main,
    inner: new THREE.MeshStandardMaterial({ color: innerColor, roughness: 0.8 }),
    frame: def.frameColor ? new THREE.MeshStandardMaterial({ color: def.frameColor, roughness: 0.55 }) : main,
    soft: new THREE.MeshStandardMaterial({ color: def.softColor ?? def.color, roughness: 0.95 }),
    metal: new THREE.MeshStandardMaterial({ color: '#b9b9b6', roughness: 0.35, metalness: 0.8 }),
  };
}

/**
 * Build the furniture as a Three.js group: centered on X/Z, lowest surface at Y = 0, front facing
 * +Z, outer bounds exactly equal to the requested dimensions. Contains only furniture meshes.
 */
export function buildTemplate(def: TemplateDef, size: DimensionsM): THREE.Group {
  const m = materials(def);
  const root = new THREE.Group();
  root.name = def.id;
  build(root, def.shape, size, m);
  assertBounds(root, size);
  return root;
}

function build(root: THREE.Group, shape: TemplateShape, s: DimensionsM, m: Mats) {
  switch (shape.kind) {
    case 'table':
      return addTable(root, s, m, shape.shelf, shape.legStyle);
    case 'roundTable':
      return addRoundTable(root, s, m);
    case 'desk':
      return addDesk(root, s, m);
    case 'chair':
      return addChair(root, s, m);
    case 'sofa':
      return addSofa(root, s, m, shape.maxSeats);
    case 'sectional':
      return addSectional(root, s, m);
    case 'bed':
      return addBed(root, s, m);
    case 'storage':
      return addStorage(root, s, m, shape);
    case 'bookshelf':
      return addBookshelf(root, s, m, shape.panelThickness, shape.shelfSpacing);
  }
}

// ---------------------------------------------------------------- primitives

/** Box of size (w, h, d) centered at (x, y, z). */
function box(w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.name = name;
  return mesh;
}

/** Box spanning the given min/max coordinates. */
function span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, name: string) {
  return box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, mat, name);
}

/** Vertical cylinder standing on y0. Segment counts are multiples of 4 so bounds stay exact. */
function cylinder(rTop: number, rBottom: number, h: number, x: number, y0: number, z: number, mat: THREE.Material, name: string, segments = 24) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mat);
  mesh.position.set(x, y0 + h / 2, z);
  mesh.name = name;
  return mesh;
}

/** Four legs from the floor to `height`, outer faces `inset` from the footprint edge. */
function addLegs(root: THREE.Group, w: number, d: number, height: number, size: number, inset: number, mat: THREE.Material, style: LegStyle = 'square') {
  const lx = w / 2 - inset - size / 2;
  const lz = d / 2 - inset - size / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    root.add(
      style === 'square'
        ? box(size, height, size, sx * lx, height / 2, sz * lz, mat, 'leg')
        : cylinder(size / 2, style === 'tapered' ? size * 0.3 : size / 2, height, sx * lx, 0, sz * lz, mat, 'leg', 16),
    );
  }
}

// ---------------------------------------------------------------- tables, desk, chair

function addTable(root: THREE.Group, s: DimensionsM, m: Mats, shelf: boolean, legStyle: LegStyle) {
  const top = Math.min(0.035, s.height * 0.15);
  const leg = Math.min(0.05, s.width / 6, s.depth / 6);
  const inset = Math.min(0.03, s.width / 10, s.depth / 10);
  const legHeight = s.height - top;
  root.add(box(s.width, top, s.depth, 0, s.height - top / 2, 0, m.main, 'tabletop'));
  addLegs(root, s.width, s.depth, legHeight, leg, inset, m.frame, legStyle);
  if (shelf) {
    const t = Math.min(0.02, legHeight * 0.08);
    const sw = s.width - 2 * inset - leg;
    const sd = s.depth - 2 * inset - leg;
    root.add(box(sw, t, sd, 0, Math.max(t / 2, legHeight * 0.22), 0, m.main, 'shelf'));
  }
}

function addRoundTable(root: THREE.Group, s: DimensionsM, m: Mats) {
  const top = Math.min(0.035, s.height * 0.1);
  const baseT = Math.min(0.03, s.height * 0.05);
  const topMesh = cylinder(0.5, 0.5, top, 0, s.height - top, 0, m.main, 'tabletop', 48);
  topMesh.scale.set(s.width, 1, s.depth);
  root.add(topMesh);
  const base = cylinder(0.5, 0.5, baseT, 0, 0, 0, m.frame, 'base', 48);
  base.scale.set(s.width * 0.5, 1, s.depth * 0.5);
  root.add(base);
  const r = Math.min(s.width, s.depth) * 0.05;
  root.add(cylinder(r, r * 1.4, s.height - top - baseT, 0, baseT, 0, m.frame, 'column'));
}

function addDesk(root: THREE.Group, s: DimensionsM, m: Mats) {
  const top = Math.min(0.03, s.height * 0.1);
  const leg = Math.min(0.045, s.width / 8, s.depth / 8);
  const inset = 0.02;
  const legHeight = s.height - top;
  root.add(box(s.width, top, s.depth, 0, s.height - top / 2, 0, m.main, 'desktop'));
  addLegs(root, s.width, s.depth, legHeight, leg, inset, m.frame);
  // Drawer pedestal hanging under the right side of the top.
  const pw = Math.min(0.42, s.width * 0.35);
  const x1 = s.width / 2 - inset - leg - 0.005;
  const x0 = x1 - pw;
  const z0 = -s.depth / 2 + inset + leg;
  const z1 = s.depth / 2 - inset - leg;
  const y0 = Math.max(legHeight * 0.35, legHeight - 0.45);
  root.add(span(x0, x1, y0, legHeight, z0, z1 - 0.02, m.main, 'pedestal'));
  const rows = 3;
  const rh = (legHeight - y0) / rows;
  for (let i = 0; i < rows; i++) {
    const fy0 = y0 + i * rh + 0.003;
    const fy1 = y0 + (i + 1) * rh - 0.003;
    root.add(span(x0 + 0.004, x1 - 0.004, fy0, fy1, z1 - 0.02, z1, m.main, 'drawer'));
    root.add(span((x0 + x1) / 2 - 0.05, (x0 + x1) / 2 + 0.05, (fy0 + fy1) / 2 - 0.006, (fy0 + fy1) / 2 + 0.006, z1, z1 + 0.012, m.metal, 'handle'));
  }
  // Modesty panel at the back.
  root.add(span(-s.width / 2 + inset + leg, x0, legHeight - Math.min(0.3, legHeight * 0.4), legHeight, z0, z0 + 0.015, m.main, 'panel'));
}

function addChair(root: THREE.Group, s: DimensionsM, m: Mats) {
  const seatH = Math.min(0.46, s.height * 0.55);
  const seatT = Math.min(0.04, seatH * 0.12);
  const leg = Math.min(0.04, s.width / 8, s.depth / 8);
  root.add(box(s.width, seatT, s.depth, 0, seatH - seatT / 2, 0, m.main, 'seat'));
  const lx = s.width / 2 - leg / 2;
  const lz = s.depth / 2 - leg / 2;
  for (const sx of [-1, 1]) {
    root.add(box(leg, seatH - seatT, leg, sx * lx, (seatH - seatT) / 2, lz, m.frame, 'leg'));
    root.add(box(leg, s.height, leg, sx * lx, s.height / 2, -lz, m.frame, 'post'));
  }
  const bh = Math.min(0.3, (s.height - seatH) * 0.6);
  root.add(box(s.width - 2 * leg, bh, 0.025, 0, s.height - bh / 2, -lz, m.main, 'backrest'));
}

// ---------------------------------------------------------------- seating

function sofaDims(s: DimensionsM, depth: number) {
  return {
    legH: Math.min(0.1, s.height * 0.12),
    armW: Math.min(0.18, s.width * 0.12),
    backD: Math.min(0.22, depth * 0.25),
    seatTop: Math.min(0.45, s.height * 0.55),
    armH: Math.min(0.65, s.height * 0.76),
  };
}

function addSofa(root: THREE.Group, s: DimensionsM, m: Mats, maxSeats: number) {
  const { legH, armW, backD, seatTop, armH } = sofaDims(s, s.depth);
  const zb = -s.depth / 2;
  const zf = s.depth / 2;
  const deck = seatTop - Math.min(0.12, (seatTop - legH) * 0.45);
  const inner = s.width - 2 * armW;
  for (const sx of [-1, 1]) {
    root.add(span(sx > 0 ? s.width / 2 - armW : -s.width / 2, sx > 0 ? s.width / 2 : -s.width / 2 + armW, legH, armH, zb, zf, m.main, 'arm'));
  }
  root.add(span(-inner / 2, inner / 2, legH, s.height, zb, zb + backD, m.main, 'back'));
  root.add(span(-inner / 2, inner / 2, legH, deck, zb + backD, zf, m.main, 'deck'));
  const seats = Math.max(1, Math.min(maxSeats, Math.round(inner / 0.6)));
  const cw = inner / seats;
  for (let i = 0; i < seats; i++) {
    const x0 = -inner / 2 + i * cw;
    root.add(span(x0 + 0.004, x0 + cw - 0.004, deck, seatTop, zb + backD, zf - 0.01, m.soft, 'seat cushion'));
    const bt = Math.min(0.14, (s.depth - backD) * 0.25);
    root.add(span(x0 + 0.004, x0 + cw - 0.004, seatTop, seatTop + (s.height - seatTop) * 0.85, zb + backD, zb + backD + bt, m.soft, 'back cushion'));
  }
  addLegs(root, s.width, s.depth, legH, Math.min(0.045, s.width / 12), 0.04, m.frame, 'tapered');
}

function addSectional(root: THREE.Group, s: DimensionsM, m: Mats) {
  const sofaD = Math.min(0.95, s.depth * 0.6);
  const { legH, backD, seatTop, armH } = sofaDims(s, sofaD);
  const armW = Math.min(0.16, s.width * 0.08);
  const chaiseW = Math.min(0.9, s.width * 0.38);
  const zb = -s.depth / 2;
  const zs = zb + sofaD; // front of the main seat
  const zf = s.depth / 2; // front of the chaise
  const deck = seatTop - 0.12;
  const xChaise = s.width / 2 - chaiseW;
  root.add(span(-s.width / 2, -s.width / 2 + armW, legH, armH, zb, zs, m.main, 'arm'));
  root.add(span(-s.width / 2 + armW, s.width / 2, legH, s.height, zb, zb + backD, m.main, 'back'));
  root.add(span(-s.width / 2 + armW, xChaise, legH, deck, zb + backD, zs, m.main, 'deck'));
  root.add(span(xChaise, s.width / 2, legH, deck, zb + backD, zf, m.main, 'chaise'));
  const mainW = xChaise - (-s.width / 2 + armW);
  const seats = Math.max(1, Math.round(mainW / 0.6));
  for (let i = 0; i < seats; i++) {
    const x0 = -s.width / 2 + armW + (i * mainW) / seats;
    root.add(span(x0 + 0.004, x0 + mainW / seats - 0.004, deck, seatTop, zb + backD, zs - 0.01, m.soft, 'seat cushion'));
  }
  root.add(span(xChaise + 0.004, s.width / 2 - 0.004, deck, seatTop, zb + backD, zf - 0.01, m.soft, 'chaise cushion'));
  const backs = seats + 1;
  const bw = (s.width - armW) / backs;
  for (let i = 0; i < backs; i++) {
    const x0 = -s.width / 2 + armW + i * bw;
    root.add(span(x0 + 0.004, x0 + bw - 0.004, seatTop, seatTop + (s.height - seatTop) * 0.85, zb + backD, zb + backD + 0.13, m.soft, 'back cushion'));
  }
  const leg = 0.045;
  for (const [x, z] of [
    [-s.width / 2 + 0.06, zb + 0.06],
    [s.width / 2 - 0.06, zb + 0.06],
    [-s.width / 2 + 0.06, zs - 0.06],
    [s.width / 2 - 0.06, zf - 0.06],
  ]) {
    root.add(box(leg, legH, leg, x, legH / 2, z, m.frame, 'leg'));
  }
}

function addBed(root: THREE.Group, s: DimensionsM, m: Mats) {
  const headT = Math.min(0.07, s.depth * 0.04);
  const railTop = Math.min(0.35, s.height * 0.32);
  const mattT = Math.min(0.22, s.height * 0.2);
  const inset = 0.03;
  const zb = -s.depth / 2;
  const zf = s.depth / 2;
  root.add(span(-s.width / 2, s.width / 2, 0, s.height, zb, zb + headT, m.main, 'headboard'));
  root.add(span(-s.width / 2, s.width / 2, 0.06, railTop, zb + headT, zf, m.main, 'frame'));
  addLegs(root, s.width, s.depth - headT, 0.06, 0.05, 0.04, m.frame);
  // addLegs centres legs on the footprint; shift them back under the frame.
  for (const leg of root.children.filter((c) => c.name === 'leg')) leg.position.z += headT / 2;
  root.add(span(-s.width / 2 + inset, s.width / 2 - inset, railTop - 0.04, railTop - 0.04 + mattT, zb + headT + 0.01, zf - inset, m.soft, 'mattress'));
  const pillows = s.width > 1.3 ? 2 : 1;
  const pw = (s.width - 2 * inset) / pillows;
  const py = railTop - 0.04 + mattT;
  for (let i = 0; i < pillows; i++) {
    const x0 = -s.width / 2 + inset + i * pw;
    root.add(span(x0 + 0.05, x0 + pw - 0.05, py, Math.min(py + 0.12, s.height - 0.01), zb + headT + 0.06, zb + headT + 0.46, m.soft, 'pillow'));
  }
}

// ---------------------------------------------------------------- storage

function addStorage(root: THREE.Group, s: DimensionsM, m: Mats, shape: Extract<TemplateShape, { kind: 'storage' }>) {
  const legH = shape.legs ? Math.min(0.1, s.height * 0.12) : 0;
  const frontT = 0.018;
  const handleD = 0.02;
  const bodyD = s.depth - frontT - handleD;
  const zb = -s.depth / 2;
  const zFront = zb + bodyD; // face the fronts sit on
  root.add(span(-s.width / 2, s.width / 2, legH, s.height, zb, zFront, m.inner, 'carcass'));
  if (shape.legs) addLegs(root, s.width, s.depth, legH, Math.min(0.04, s.width / 10), 0.03, m.frame, 'tapered');

  const edge = 0.01;
  const gap = 0.005;
  const doors = shape.front === 'doors';
  const cols = shape.cols ?? (doors ? (s.width > 1.3 ? 3 : 2) : s.width > 1.0 ? 2 : 1);
  const rows = shape.rows ?? Math.max(1, Math.round((s.height - legH) / 0.22));
  const fw = (s.width - 2 * edge) / cols;
  const fh = (s.height - legH - 2 * edge) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = -s.width / 2 + edge + c * fw + gap / 2;
      const x1 = x0 + fw - gap;
      const y0 = legH + edge + r * fh + gap / 2;
      const y1 = y0 + fh - gap;
      root.add(span(x0, x1, y0, y1, zFront, zFront + frontT, m.main, doors ? 'door' : 'drawer'));
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      if (doors) {
        const hx = c < cols / 2 ? x1 - 0.04 : x0 + 0.04;
        const hh = Math.min(0.18, fh * 0.3);
        root.add(span(hx - 0.007, hx + 0.007, cy - hh / 2, cy + hh / 2, zFront + frontT, s.depth / 2, m.metal, 'handle'));
      } else {
        const hw = Math.min(0.14, (x1 - x0) * 0.4);
        root.add(span(cx - hw / 2, cx + hw / 2, cy - 0.007, cy + 0.007, zFront + frontT, s.depth / 2, m.metal, 'handle'));
      }
    }
  }
}

function addBookshelf(root: THREE.Group, s: DimensionsM, m: Mats, panelThickness: number, shelfSpacing: number) {
  const t = Math.min(panelThickness, s.width / 10, s.depth / 10);
  const innerW = s.width - 2 * t;
  for (const sx of [-1, 1]) {
    root.add(box(t, s.height, s.depth, sx * (s.width / 2 - t / 2), s.height / 2, 0, m.main, 'side'));
  }
  root.add(box(innerW, s.height, t, 0, s.height / 2, -s.depth / 2 + t / 2, m.inner, 'back'));
  const count = Math.max(1, Math.round((s.height - t) / shelfSpacing));
  const step = (s.height - t) / count;
  for (let i = 0; i <= count; i++) {
    root.add(box(innerW, t, s.depth - t, 0, t / 2 + i * step, t / 2, m.main, i === 0 ? 'bottom' : i === count ? 'top' : 'shelf'));
  }
}

// ---------------------------------------------------------------- checks and cleanup

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
      `Generated ${root.name} is ${size.x.toFixed(3)} x ${size.y.toFixed(3)} x ${size.z.toFixed(3)} m, ` +
        `expected ${s.width} x ${s.height} x ${s.depth} m`,
    );
  }
}

/** Free GPU-side resources of a generated group once it has been exported. */
export function disposeGroup(root: THREE.Object3D) {
  const mats = new Set<THREE.Material>();
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((mt) => mats.add(mt));
    }
  });
  mats.forEach((mt) => mt.dispose());
}

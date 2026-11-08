/**
 * Turn a room plan into one GLB: every piece at its planned position and turn, in its chosen
 * colours, plus a thin outline of the room's walls on the floor. In AR the whole arrangement is
 * placed at real size, so the outline can be lined up with a corner of the real room.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TEMPLATES } from '../catalog/templates';
import { buildTemplate } from '../models/buildTemplate';
import { exportGlb } from '../models/exportGlb';
import { getProduct, resolveColors } from '../models/productCatalog';
import type { RoomItem, RoomPlan } from './roomPlan';

const loader = new GLTFLoader();
const scenes = new Map<string, Promise<THREE.Group>>();

function loadScene(url: string): Promise<THREE.Group> {
  let p = scenes.get(url);
  if (!p) {
    p = loader.loadAsync(url).then((g) => g.scene);
    p.catch(() => scenes.delete(url));
    scenes.set(url, p);
  }
  return p;
}

/** Recolour cloned materials by glTF material name, leaving the cached original untouched. */
function recolour(root: THREE.Object3D, colors: Record<string, { hex: string; roughness?: number }>) {
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material) => {
      const c = colors[m.name];
      if (!c || !(m instanceof THREE.MeshStandardMaterial)) return m;
      const copy = m.clone();
      copy.color.set(c.hex);
      if (c.roughness !== undefined) copy.roughness = c.roughness;
      return copy;
    };
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
  });
}

/** Scale (per axis) and move an object so it fills `size`, centred on X/Z with its base at Y = 0. */
function fitTo(obj: THREE.Object3D, size: { width: number; depth: number; height: number }) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const s = box.getSize(new THREE.Vector3());
  if (s.x > 0 && s.y > 0 && s.z > 0) obj.scale.multiply(new THREE.Vector3(size.width / s.x, size.height / s.y, size.depth / s.z));
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  obj.position.sub(new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2));
}

async function objectFor(item: RoomItem): Promise<THREE.Object3D | null> {
  const ref = item.ref;
  if (ref.kind === 'template') {
    const def = TEMPLATES[ref.templateId];
    return def ? buildTemplate(def, item.size) : null;
  }
  if (ref.kind === 'product') {
    const product = getProduct(ref.productId);
    if (!product) return null;
    const obj = (await loadScene(product.glbUrl)).clone(true);
    recolour(obj, resolveColors(product, ref.colors));
    return obj;
  }
  const obj = (await loadScene(ref.glbUrl)).clone(true);
  fitTo(obj, item.size);
  return obj;
}

function roomOutline(width: number, length: number): THREE.Group {
  const mat = new THREE.MeshStandardMaterial({ name: 'Room outline', color: '#009d56', roughness: 0.6 });
  const t = 0.03; // line width
  const h = 0.006; // just above the floor
  const g = new THREE.Group();
  g.name = 'room outline';
  const add = (w: number, d: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2, z);
    g.add(m);
  };
  add(width, t, 0, -length / 2 + t / 2);
  add(width, t, 0, length / 2 - t / 2);
  add(t, length, -width / 2 + t / 2, 0);
  add(t, length, width / 2 - t / 2, 0);
  return g;
}

export type RoomBuild = { blob: Blob; missing: string[] };

/** Build the arrangement. Pieces whose model is no longer available are listed in `missing`. */
export async function buildRoomGlb(plan: RoomPlan): Promise<RoomBuild> {
  const root = new THREE.Group();
  root.name = 'room';
  root.add(roomOutline(plan.room.width, plan.room.length));
  const missing: string[] = [];
  const objects = await Promise.all(plan.items.map((i) => objectFor(i).catch(() => null)));
  plan.items.forEach((item, idx) => {
    const obj = objects[idx];
    if (!obj) {
      missing.push(item.label);
      return;
    }
    const holder = new THREE.Group();
    holder.name = item.label;
    holder.add(obj);
    holder.position.set(item.x - plan.room.width / 2, 0, item.z - plan.room.length / 2);
    holder.rotation.y = (-item.rot * Math.PI) / 180;
    root.add(holder);
  });
  return { blob: await exportGlb(root), missing };
}

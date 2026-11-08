import * as THREE from 'three';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { TEMPLATES, type TemplateId } from '../catalog/templates';
import { buildTemplate, disposeGroup } from './buildTemplate';

/** Render the actual furniture geometry as a lightweight product image, without a GPU context. */
export function furnitureThumbnail(id: TemplateId): string {
  const def = TEMPLATES[id];
  const root = buildTemplate(def, def.defaults);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dadad8');
  const material = new THREE.MeshLambertMaterial({ color: def.color });
  const replaced = new Set<THREE.Material>();
  root.traverse(node => {
    if (node instanceof THREE.Mesh) {
      (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => replaced.add(m));
      node.material = material;
    }
  });
  replaced.forEach(m => m.dispose());
  scene.add(root, new THREE.AmbientLight(0xffffff, 0.7));
  const light = new THREE.DirectionalLight(0xffffff, 0.8);
  light.position.set(-3, 6, 5);
  scene.add(light);
  const s = def.defaults;
  const radius = Math.max(s.width, s.height, s.depth);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(radius * 1.65, s.height / 2 + radius * 1.05, radius * 2.1);
  camera.lookAt(0, s.height / 2, 0);
  const renderer = new SVGRenderer();
  renderer.setSize(320, 320);
  renderer.setPrecision(3);
  renderer.render(scene, camera);
  const svg = new XMLSerializer().serializeToString(renderer.domElement);
  disposeGroup(root);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

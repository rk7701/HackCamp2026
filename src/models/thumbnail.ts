import * as THREE from 'three';
import { SVGRenderer } from 'three/examples/jsm/renderers/SVGRenderer.js';
import { TEMPLATES, type TemplateId } from '../catalog/templates';
import { buildTemplate, disposeGroup } from './buildTemplate';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DimensionsM } from '../domain/dimensions';

let previewRenderer: THREE.WebGLRenderer | undefined;
let useSvgFallback = false;

/** Render the actual furniture geometry as a lightweight product image. */
export function furnitureThumbnail(id: TemplateId): string {
  const def = TEMPLATES[id];
  const root = buildTemplate(def, def.defaults);
  return renderThumbnail(root, def.defaults);
}

/** Use the catalog GLB itself, preserving its geometry and individual material colours. */
export async function productThumbnail(glbUrl: string): Promise<string> {
  const gltf = await new GLTFLoader().loadAsync(glbUrl);
  const bounds = new THREE.Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new THREE.Vector3());
  return renderThumbnail(gltf.scene, { width: size.x, height: size.y, depth: size.z });
}

function renderThumbnail(root: THREE.Group, s: DimensionsM): string {
  if (!previewRenderer && !useSvgFallback) {
    try {
      previewRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      previewRenderer.setSize(320, 320);
    } catch { useSvgFallback = true; }
  }
  const renderer = previewRenderer ?? new SVGRenderer();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#dadad8');
  const replaced = new Map<THREE.Material, THREE.Material>();
  function replaceMaterial(original: THREE.Material): THREE.Material {
    let material = replaced.get(original);
    if (!material) {
      material = new THREE.MeshLambertMaterial({
        color: (original as THREE.MeshStandardMaterial).color ?? new THREE.Color('#c5c0b7'),
        side: original.side,
      });
      replaced.set(original, material);
    }
    return material;
  }
  // SVG is a fallback for devices without a GPU context; WebGL preserves depth ordering
  // for detailed catalog models with drawers, handles, and overlapping surfaces.
  if (!previewRenderer) root.traverse(node => {
      if (node instanceof THREE.Mesh) {
        node.material = Array.isArray(node.material) ? node.material.map(replaceMaterial) : replaceMaterial(node.material);
      }
    });
  replaced.forEach((_, original) => original.dispose());
  scene.add(root, new THREE.AmbientLight(0xffffff, previewRenderer ? 2 : 0.7));
  const light = new THREE.DirectionalLight(0xffffff, previewRenderer ? 3 : 0.8);
  light.position.set(-3, 6, 5);
  scene.add(light);
  const radius = Math.max(s.width, s.height, s.depth);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(radius * 1.65, s.height / 2 + radius * 1.05, radius * 2.1);
  camera.lookAt(0, s.height / 2, 0);
  renderer.setSize(320, 320);
  if (renderer instanceof SVGRenderer) renderer.setPrecision(3);
  renderer.render(scene, camera);
  const image = renderer instanceof THREE.WebGLRenderer ? renderer.domElement.toDataURL('image/webp', 0.9)
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(renderer.domElement))}`;
  disposeGroup(root);
  return image;
}

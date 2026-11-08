import type * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const exporter = new GLTFExporter();

/** Export only the given furniture root (no lights, grids or helpers) as a binary GLB. */
export async function exportGlb(root: THREE.Object3D): Promise<Blob> {
  const result = await exporter.parseAsync(root, { binary: true, onlyVisible: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary output');
  return new Blob([result], { type: 'model/gltf-binary' });
}

/** Tracks object URLs created for generated models so replaced ones can be revoked. */
export class ObjectUrlPool {
  private live = new Set<string>();

  create(blob: Blob): string {
    const url = URL.createObjectURL(blob);
    this.live.add(url);
    return url;
  }

  revoke(url: string) {
    if (this.live.delete(url)) URL.revokeObjectURL(url);
  }

  /** Revoke every URL except the one currently shown. */
  revokeAllExcept(keep: string | null) {
    for (const url of [...this.live]) if (url !== keep) this.revoke(url);
  }
}

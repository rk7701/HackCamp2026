import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { PRODUCTS, getProduct, resolveColors } from '../src/models/productCatalog';

const DIR = resolve(process.cwd(), 'public/models/products');
const TOL = 0.0015; // meters

function load(file: string): Promise<GLTF> {
  const buf = readFileSync(resolve(DIR, file));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Promise((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail));
}

describe('popular product models', () => {
  for (const p of PRODUCTS) {
    const file = `${p.id}.glb`;
    it.skipIf(!existsSync(resolve(DIR, file)))(`${p.id} matches its catalog size and is centered on the floor`, async () => {
      const gltf = await load(file);
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      expect(Math.abs(size.x - p.size.width)).toBeLessThan(TOL);
      expect(Math.abs(size.y - p.size.height)).toBeLessThan(TOL);
      expect(Math.abs(size.z - p.size.depth)).toBeLessThan(TOL);
      expect(Math.abs(box.min.y)).toBeLessThan(TOL);
      expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(TOL);
      expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(TOL);
    });
  }

  it('every catalog entry has a model file', () => {
    const missing = PRODUCTS.filter((p) => !existsSync(resolve(DIR, `${p.id}.glb`))).map((p) => p.id);
    expect(missing).toEqual([]);
  });
});

/** Read material names and base colours straight from a GLB's JSON chunk. */
function glbMaterials(file: string): Map<string, number[]> {
  const b = readFileSync(resolve(DIR, file));
  const json = JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8'));
  return new Map(
    (json.materials ?? []).map((m: { name: string; pbrMetallicRoughness?: { baseColorFactor?: number[] } }) => [
      m.name,
      m.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
    ]),
  );
}

const toLinear = (hex: string) =>
  [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

describe('product colours', () => {
  for (const p of PRODUCTS) {
    const file = `${p.id}.glb`;
    it.skipIf(!existsSync(resolve(DIR, file)))(`${p.id}: colour parts target real materials; first option is the built-in colour`, () => {
      const mats = glbMaterials(file);
      expect(p.colorParts.length).toBeGreaterThan(0);
      for (const part of p.colorParts) {
        expect(part.options.length).toBeGreaterThan(1);
        for (const name of part.materials) {
          expect([...mats.keys()]).toContain(name);
          const builtIn = mats.get(name)!;
          toLinear(part.options[0].hex).forEach((c, i) => expect(Math.abs(c - builtIn[i])).toBeLessThan(0.01));
        }
      }
    });
  }

  it('resolves two-tone overrides per material', () => {
    const nightstand = getProduct('classic-nightstand')!;
    const twoTone = nightstand.colorParts[0].options.findIndex((o) => o.overrides);
    const colors = resolveColors(nightstand, { Finish: twoTone });
    expect(colors['White stain'].hex).not.toBe(colors['Top finish'].hex);
  });

  it('defaults to the first option and keeps parts independent', () => {
    const chair = getProduct('bentwood-armchair')!;
    const colors = resolveColors(chair, { Cushion: 3 });
    expect(colors['Birch veneer'].hex).toBe(chair.colorParts[0].options[0].hex);
    expect(colors['Cushion beige'].hex).toBe(chair.colorParts[1].options[3].hex);
  });
});

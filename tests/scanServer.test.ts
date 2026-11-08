import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { encodeGlb, encodeStl, mockBox } from '../server/hunyuan';
import { cleanTitle, parseScanRequest } from '../server/scanRequest';

const JPEG = `data:image/jpeg;base64,${Buffer.from('fake jpeg bytes').toString('base64')}`;
const PNG = `data:image/png;base64,${Buffer.from('fake png bytes').toString('base64')}`;
const valid = () => ({
  title: 'Reading chair',
  heightM: 0.9,
  photos: [
    { view: 'front', dataUrl: JPEG },
    { view: 'left', dataUrl: PNG },
  ],
});

describe('parseScanRequest', () => {
  it('accepts a title, a height and labelled photos', () => {
    const r = parseScanRequest(valid());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toBe('Reading chair');
    expect(r.value.heightM).toBe(0.9);
    expect(r.value.photos.map((p) => [p.view, p.ext])).toEqual([
      ['front', 'jpg'],
      ['left', 'png'],
    ]);
    expect(r.value.photos[0].bytes.toString()).toBe('fake jpeg bytes');
  });

  it('accepts a single front photo and all four views', () => {
    expect(parseScanRequest({ ...valid(), photos: [{ view: 'front', dataUrl: JPEG }] }).ok).toBe(true);
    const four = ['front', 'left', 'back', 'right'].map((view) => ({ view, dataUrl: JPEG }));
    expect(parseScanRequest({ ...valid(), photos: four }).ok).toBe(true);
  });

  it('rejects a missing or bad title', () => {
    expect(parseScanRequest({ ...valid(), title: '   ' })).toMatchObject({ ok: false, error: /name/ });
    expect(parseScanRequest({ ...valid(), title: 42 })).toMatchObject({ ok: false });
    expect(parseScanRequest({ ...valid(), title: 'x'.repeat(61) })).toMatchObject({ ok: false, error: /60/ });
  });

  it('rejects heights outside 10 cm to 3 m or that are not numbers', () => {
    for (const heightM of [0.05, 3.5, -1, Number.NaN, '0.9', null]) {
      expect(parseScanRequest({ ...valid(), heightM })).toMatchObject({ ok: false, error: /Height/ });
    }
    expect(parseScanRequest({ ...valid(), heightM: 0.1 }).ok).toBe(true);
    expect(parseScanRequest({ ...valid(), heightM: 3 }).ok).toBe(true);
  });

  it('requires 1-4 photos with distinct known views, including the front', () => {
    expect(parseScanRequest({ ...valid(), photos: [] })).toMatchObject({ ok: false });
    expect(parseScanRequest({ ...valid(), photos: undefined })).toMatchObject({ ok: false });
    const five = ['front', 'left', 'back', 'right', 'front'].map((view) => ({ view, dataUrl: JPEG }));
    expect(parseScanRequest({ ...valid(), photos: five })).toMatchObject({ ok: false });
    expect(
      parseScanRequest({ ...valid(), photos: [{ view: 'front', dataUrl: JPEG }, { view: 'front', dataUrl: JPEG }] }),
    ).toMatchObject({ ok: false, error: /different view/ });
    expect(parseScanRequest({ ...valid(), photos: [{ view: 'top', dataUrl: JPEG }] })).toMatchObject({ ok: false });
    expect(parseScanRequest({ ...valid(), photos: [{ view: 'left', dataUrl: JPEG }] })).toMatchObject({
      ok: false,
      error: /front photo/,
    });
  });

  it('only accepts the views the current model uses', () => {
    const frontOnly = ['front'] as const;
    expect(parseScanRequest({ ...valid(), photos: [{ view: 'front', dataUrl: JPEG }] }, frontOnly).ok).toBe(true);
    expect(parseScanRequest(valid(), frontOnly)).toMatchObject({ ok: false, error: /one front photo/ });
    expect(parseScanRequest({ ...valid(), photos: [{ view: 'left', dataUrl: JPEG }] }, frontOnly)).toMatchObject({ ok: false });
  });

  it('rejects photos that are not small JPEG/PNG/WebP data URLs', () => {
    const bad = (dataUrl: unknown) => parseScanRequest({ ...valid(), photos: [{ view: 'front', dataUrl }] });
    expect(bad('data:image/gif;base64,R0lGOD')).toMatchObject({ ok: false });
    expect(bad('https://example.com/a.jpg')).toMatchObject({ ok: false });
    expect(bad('data:image/jpeg;base64,')).toMatchObject({ ok: false });
    expect(bad(undefined)).toMatchObject({ ok: false });
    const huge = `data:image/jpeg;base64,${Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64')}`;
    expect(bad(huge)).toMatchObject({ ok: false, error: /6 MB/ });
  });
});

describe('cleanTitle', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(cleanTitle('  Sofa\u0000\n with\ttabs  ')).toBe('Sofa with tabs');
    expect(cleanTitle(undefined)).toBe('');
  });
});

describe('toProduct', () => {
  it('builds a recolourable My furniture product with GLB and STL links', async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'scan-test-'));
    const { toProduct } = await import('../server/store');
    const p = toProduct('my-test', 'Reading chair', { width: 0.7000001, depth: 0.8, height: 0.9 }, new Date(0));
    expect(p).toMatchObject({
      id: 'my-test',
      label: 'Reading chair',
      brand: 'My furniture',
      type: 'Other',
      size: { width: 0.7, depth: 0.8, height: 0.9 },
      glbUrl: 'custom-models/my-test.glb',
      custom: { createdAt: '1970-01-01T00:00:00.000Z', notes: '', stlUrl: 'custom-models/my-test.stl' },
    });
    expect(p.colorParts).toHaveLength(1);
    expect(p.colorParts[0].materials).toEqual(['Main finish']);
    // Option 0 is the GLB's built-in grey (184, 181, 175 in hunyuan/worker.py).
    expect(p.colorParts[0].options[0].hex).toBe('#b8b5af');
  });
});

describe('mock model', () => {
  const box = mockBox(0.75);

  it('is a closed box with outward-facing triangles', () => {
    const { positions: P, normals: N, indices: I } = box;
    expect(I).toHaveLength(36);
    for (let t = 0; t < I.length; t += 3) {
      const v = (k: number) => new THREE.Vector3().fromArray(P, I[t + k] * 3);
      const face = new THREE.Vector3().crossVectors(v(1).sub(v(0)), v(2).sub(v(0)));
      expect(face.dot(new THREE.Vector3().fromArray(N, I[t] * 3))).toBeGreaterThan(0);
    }
  });

  it('encodes a GLB three.js loads at the requested height, on the floor, with the recolourable material', async () => {
    const glb = encodeGlb(box.positions, box.normals, box.indices);
    const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((ok, fail) => new GLTFLoader().parse(ab, '', ok, fail));
    const b = new THREE.Box3().setFromObject(gltf.scene);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0.75, 6);
    expect(b.max.x + b.min.x).toBeCloseTo(0, 6);
    expect(b.max.z + b.min.z).toBeCloseTo(0, 6);
    const size = b.getSize(new THREE.Vector3());
    expect([size.x, size.y, size.z].map((n) => +n.toFixed(6))).toEqual([box.size.width, box.size.height, box.size.depth].map((n) => +n.toFixed(6)));
    const mesh = gltf.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh;
    expect((mesh.material as THREE.Material).name).toBe('Main finish');
  });

  it('encodes a Z-up STL in millimetres', () => {
    const stl = encodeStl(box.positions, box.normals, box.indices);
    const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((m) => m.slice(1).map(Number));
    expect(verts).toHaveLength(36);
    const zs = verts.map((v) => v[2]);
    expect(Math.min(...zs)).toBeCloseTo(0, 6);
    expect(Math.max(...zs)).toBeCloseTo(750, 6);
    expect(stl.startsWith('solid ')).toBe(true);
    expect(stl.trimEnd().endsWith('endsolid furniture')).toBe(true);
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FURNITURE_TYPES } from '../src/catalog/furnitureTypes';
import { SPEC_JSON_SCHEMA, checkSize, normalizeSpec } from '../server/spec';
import { describeMock } from '../server/vision';

const SIZE = { width: 1.4, depth: 0.45, height: 0.9 };

describe('furniture spec schema', () => {
  it('requires every property at every level (strict structured output)', () => {
    const walk = (node: any) => {
      if (node?.type !== 'object') return;
      expect(node.additionalProperties).toBe(false);
      expect([...node.required].sort()).toEqual(Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    };
    walk(SPEC_JSON_SCHEMA);
  });

  it('offers exactly the app furniture types', () => {
    expect((SPEC_JSON_SCHEMA.properties as any).furniture_type.enum).toEqual([...FURNITURE_TYPES]);
  });
});

describe('normalizeSpec', () => {
  it('fills defaults for an empty or hostile answer', () => {
    const spec = normalizeSpec({ archetype: 'rm -rf /', colors: { main_hex: 'red' }, sofa: { seats: 999 } }, SIZE);
    expect(spec.archetype).toBe('storage');
    expect(spec.colors.main_hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(spec.sofa.seats).toBe(4);
    expect(spec.furniture_type).toBe('Other');
    expect(normalizeSpec(null, SIZE).name).toBe('My furniture');
  });

  it('keeps valid values and the measured size', () => {
    const spec = normalizeSpec(describeMock(SIZE), SIZE);
    expect(spec.size_m).toEqual(SIZE);
    expect(spec.archetype).toBe('storage');
    expect(spec.storage.drawer_columns).toBe(2);
  });

  it('strips control characters and caps text length', () => {
    const spec = normalizeSpec({ name: 'Sofa\u0000\nwith\ttabs' + 'x'.repeat(200) }, SIZE);
    expect(spec.name).not.toMatch(/[\u0000-\u001f]/);
    expect(spec.name.length).toBeLessThanOrEqual(60);
  });

  it('clamps sizes into the buildable range', () => {
    expect(normalizeSpec({}, { width: 99, depth: -1, height: Number.NaN }).size_m).toEqual({ width: 4, depth: 0.2, height: 0.8 });
  });
});

describe('checkSize', () => {
  it('accepts sensible tape measurements and rejects the rest', () => {
    expect(checkSize(SIZE)).toBeNull();
    expect(checkSize({ width: 0.1, depth: 0.5, height: 0.5 })).toMatch(/width/);
    expect(checkSize({ width: 1, depth: 1 })).toMatch(/height/);
    expect(checkSize('1x1x1')).not.toBeNull();
  });
});

describe('toProduct', () => {
  it('builds a My furniture product whose first colour is the photographed one', async () => {
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'scan-test-'));
    const { toProduct } = await import('../server/store');
    const spec = normalizeSpec(describeMock(SIZE), SIZE);
    const p = toProduct('my-test', spec, { width: 1.4000001, depth: 0.45, height: 0.9, materials: ['Main finish', 'Frame finish'] });
    expect(p.brand).toBe('My furniture');
    expect(p.size.width).toBe(1.4);
    expect(p.glbUrl).toBe('custom-models/my-test.glb');
    expect(p.colorParts.map((c) => c.label)).toEqual(['Main', 'Frame']);
    expect(p.colorParts[0].options[0].hex).toBe(spec.colors.main_hex);
    expect(p.colorParts[0].options[0].name).toMatch(/from your photos/);
    const noFrame = toProduct('my-2', spec, { width: 1, depth: 1, height: 1, materials: ['Main finish'] });
    expect(noFrame.colorParts).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { TEMPLATES, TEMPLATE_IDS } from '../src/catalog/templates';
import { BOUNDS_TOLERANCE_M, buildTemplate, measure } from '../src/models/buildTemplate';

describe('buildTemplate', () => {
  for (const id of TEMPLATE_IDS) {
    const def = TEMPLATES[id];
    const sizes = [
      def.defaults,
      { width: def.ranges.width.min, depth: def.ranges.depth.min, height: def.ranges.height.min },
      { width: def.ranges.width.max, depth: def.ranges.depth.max, height: def.ranges.height.max },
    ];
    for (const size of sizes) {
      it(`${id} at ${size.width} x ${size.depth} x ${size.height} m matches bounds, centered, on the floor`, () => {
        const { size: s, box } = measure(buildTemplate(def, size));
        expect(Math.abs(s.x - size.width)).toBeLessThan(BOUNDS_TOLERANCE_M);
        expect(Math.abs(s.y - size.height)).toBeLessThan(BOUNDS_TOLERANCE_M);
        expect(Math.abs(s.z - size.depth)).toBeLessThan(BOUNDS_TOLERANCE_M);
        expect(Math.abs(box.min.y)).toBeLessThan(BOUNDS_TOLERANCE_M);
        expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(BOUNDS_TOLERANCE_M);
        expect(Math.abs(box.min.z + box.max.z)).toBeLessThan(BOUNDS_TOLERANCE_M);
      });
    }
  }

  it('builds a 60 cm and a 90 cm table at the requested width', () => {
    for (const width of [0.6, 0.9]) {
      const { size } = measure(buildTemplate(TEMPLATES.table, { width, depth: 0.6, height: 0.75 }));
      expect(size.x).toBeCloseTo(width, 3);
    }
  });

  it('table has a top and four legs', () => {
    const g = buildTemplate(TEMPLATES.table, TEMPLATES.table.defaults);
    expect(g.children.filter((c) => c.name === 'leg')).toHaveLength(4);
    expect(g.children.filter((c) => c.name === 'tabletop')).toHaveLength(1);
  });
});

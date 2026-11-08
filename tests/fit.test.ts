import { describe, expect, it } from 'vitest';
import { checkFit } from '../src/domain/fit';

describe('checkFit', () => {
  it('reports how much too wide, as in the spec example', () => {
    const r = checkFit({ width: 0.6, depth: 0.4 }, { width: 0.56, depth: 0.5 }, false, 'cm');
    expect(r.status).toBe('too-big');
    expect(r.message).toBe('4 cm too wide for this gap.');
  });

  it('a 90 degree turn swaps width and depth', () => {
    const table = { width: 1.2, depth: 0.6 };
    const gap = { width: 0.7, depth: 1.5 };
    const straight = checkFit(table, gap, false, 'cm');
    expect(straight.status).toBe('too-big');
    expect(straight.rotationHelps).toBe(true);
    expect(straight.message).toContain('Turning it 90° would fit');
    expect(checkFit(table, gap, true, 'cm').status).toBe('fits');
  });

  it('flags small margins as tight and asks to remeasure', () => {
    const r = checkFit({ width: 0.6, depth: 0.4 }, { width: 0.61, depth: 1 }, false, 'cm');
    expect(r.status).toBe('tight');
    expect(r.message).toContain('Remeasure');
  });

  it('reports spare room when it fits comfortably', () => {
    const r = checkFit({ width: 0.6, depth: 0.4 }, { width: 0.8, depth: 0.5 }, false, 'cm');
    expect(r.status).toBe('fits');
    expect(r.widthMargin).toBeCloseTo(0.2);
  });
});

import { describe, expect, it } from 'vitest';
import { formatLength, fromMeters, parseLength, toMeters } from '../src/domain/dimensions';

const range = { min: 0.3, max: 3 };

describe('unit conversion', () => {
  it('converts cm and inches to meters and back', () => {
    expect(toMeters(60, 'cm')).toBeCloseTo(0.6);
    expect(toMeters(1, 'in')).toBeCloseTo(0.0254);
    expect(fromMeters(0.9, 'cm')).toBeCloseTo(90);
    expect(fromMeters(toMeters(47.25, 'in'), 'in')).toBeCloseTo(47.25);
  });

  it('formats lengths', () => {
    expect(formatLength(0.6, 'cm')).toBe('60 cm');
    expect(formatLength(0.04, 'cm')).toBe('4 cm');
    expect(formatLength(1.2, 'in')).toBe('47.2 in');
  });
});

describe('parseLength', () => {
  it('accepts valid values in either unit', () => {
    expect(parseLength('60', 'cm', range, 'Width')).toEqual({ ok: true, meters: 0.6 });
    const r = parseLength('36', 'in', range, 'Width');
    expect(r.ok && r.meters).toBeCloseTo(0.9144);
    expect(parseLength(' 60,5 ', 'cm', range, 'Width')).toEqual({ ok: true, meters: 0.605 });
  });

  it('rejects empty, non-numeric, zero, negative and infinite input', () => {
    for (const raw of ['', 'abc', '0', '-5', 'Infinity', 'NaN']) {
      expect(parseLength(raw, 'cm', range, 'Width').ok).toBe(false);
    }
  });

  it('rejects out-of-range values with a message in the active unit', () => {
    const r = parseLength('20', 'cm', range, 'Width');
    expect(r).toEqual({ ok: false, error: 'Width must be between 30 cm and 300 cm.' });
    expect(parseLength('301', 'cm', range, 'Width').ok).toBe(false);
  });

  it('accepts the exact boundaries', () => {
    expect(parseLength('30', 'cm', range, 'Width').ok).toBe(true);
    expect(parseLength('300', 'cm', range, 'Width').ok).toBe(true);
  });
});

/** Internal unit is always meters. X = width, Y = height, Z = depth. */
export type DimensionsM = { width: number; depth: number; height: number };
export type DimensionKey = keyof DimensionsM;
export type Unit = 'cm' | 'in';
export type RangeM = { min: number; max: number };

export const DIMENSION_KEYS: readonly DimensionKey[] = ['width', 'depth', 'height'];

const METERS_PER_UNIT: Record<Unit, number> = { cm: 0.01, in: 0.0254 };

export function toMeters(value: number, unit: Unit): number {
  return value * METERS_PER_UNIT[unit];
}

export function fromMeters(meters: number, unit: Unit): number {
  return meters / METERS_PER_UNIT[unit];
}

/** Round for display to a tenth of the unit. */
export function formatLength(meters: number, unit: Unit): string {
  return `${Math.round(fromMeters(meters, unit) * 10) / 10} ${unit}`;
}

export type ParseResult = { ok: true; meters: number } | { ok: false; error: string };

/** Parse a user-typed length and check it is positive, finite and inside the allowed range. */
export function parseLength(raw: string, unit: Unit, range: RangeM, label: string): ParseResult {
  const text = raw.trim().replace(',', '.');
  if (text === '') return { ok: false, error: `Enter a ${label.toLowerCase()}.` };
  const value = Number(text);
  if (!Number.isFinite(value)) return { ok: false, error: `${label} must be a number.` };
  if (value <= 0) return { ok: false, error: `${label} must be greater than 0.` };
  const meters = toMeters(value, unit);
  // Small epsilon so a value displayed at the boundary is accepted after unit round-trips.
  const eps = 1e-6;
  if (meters < range.min - eps || meters > range.max + eps) {
    return {
      ok: false,
      error: `${label} must be between ${formatLength(range.min, unit)} and ${formatLength(range.max, unit)}.`,
    };
  }
  return { ok: true, meters };
}

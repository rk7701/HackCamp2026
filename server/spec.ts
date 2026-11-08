/**
 * The "furniture spec": a structured description of a piece of furniture that Claude fills in from
 * photos and blender/build_custom.py turns into a model. Only numbers, enums and colours are
 * allowed, and normalizeSpec() clamps everything again before Blender sees it.
 */
import { FURNITURE_TYPES, type FurnitureType } from '../src/catalog/furnitureTypes.ts';

export const ARCHETYPES = ['sofa', 'armchair', 'bed', 'storage', 'shelving', 'table', 'desk', 'chair'] as const;
export const ARM_STYLES = ['track', 'rolled', 'angled', 'none'] as const;
export const CHAISE = ['none', 'left', 'right'] as const;
export const SEAT_STYLES = ['separate', 'bench'] as const;
export const HANDLES = ['knob', 'bar', 'tab', 'grip', 'none'] as const;
export const LEG_STYLES = ['tapered', 'square', 'round', 'hidden', 'wood_base', 'sled'] as const;

export type SizeM = { width: number; depth: number; height: number };

export type FurnitureSpec = {
  name: string;
  furniture_type: FurnitureType;
  archetype: (typeof ARCHETYPES)[number];
  sofa: {
    seats: number;
    back_cushions: number;
    arm_style: (typeof ARM_STYLES)[number];
    tufted: boolean;
    chaise: (typeof CHAISE)[number];
    seat_cushion_style: (typeof SEAT_STYLES)[number];
  };
  storage: {
    drawer_columns: number;
    drawer_rows: number;
    doors: number;
    handle_style: (typeof HANDLES)[number];
    top_overhang: boolean;
  };
  shelving: { columns: number; rows: number; back_panel: boolean; open_cubbies: boolean };
  table: { round_top: boolean; lower_shelf: boolean; top_thickness_cm: number };
  bed: { headboard_height_ratio: number; footboard: boolean };
  legs: { style: (typeof LEG_STYLES)[number]; height_cm: number };
  colors: { main_hex: string; main_name: string; frame_hex: string; frame_name: string; hardware_hex: string };
  notes: string;
};

/** What Blender receives: the spec plus the user's tape-measured size in meters. */
export type BuildSpec = FurnitureSpec & { size_m: SizeM };

const obj = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const int = (description: string) => ({ type: 'integer', description });
const num = (description: string) => ({ type: 'number', description });
const bool = (description: string) => ({ type: 'boolean', description });
const str = (description: string) => ({ type: 'string', description });
const oneOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });

/** JSON Schema passed to Claude Code (--json-schema) so the answer is validated structured output. */
export const SPEC_JSON_SCHEMA = obj({
  name: str('Short descriptive name, e.g. "Olive 3-seat sofa". No brand names.'),
  furniture_type: oneOf(FURNITURE_TYPES, 'Catalogue category.'),
  archetype: oneOf(
    ARCHETYPES,
    'Which builder fits best. Use storage for dressers, nightstands, sideboards, wardrobes and TV stands.',
  ),
  sofa: obj({
    seats: int('Seat cushions / seating places, 1-4.'),
    back_cushions: int('Loose back cushions visible, 0-4.'),
    arm_style: oneOf(ARM_STYLES, 'Shape of the arms.'),
    tufted: bool('Button tufting on the back.'),
    chaise: oneOf(CHAISE, 'Chaise extension, as seen when facing the sofa.'),
    seat_cushion_style: oneOf(SEAT_STYLES, 'One long bench cushion or separate cushions.'),
  }),
  storage: obj({
    drawer_columns: int('Drawer columns, 0-3.'),
    drawer_rows: int('Drawer rows, 0-8.'),
    doors: int('Hinged doors across the front, 0-4.'),
    handle_style: oneOf(HANDLES, 'Handle type.'),
    top_overhang: bool('Top board overhangs the body.'),
  }),
  shelving: obj({
    columns: int('Shelf columns, 1-6.'),
    rows: int('Shelf rows / compartments vertically, 1-10.'),
    back_panel: bool('Closed back panel.'),
    open_cubbies: bool('Thick-framed cube grid (cubbies) rather than a bookcase.'),
  }),
  table: obj({
    round_top: bool('Round or oval top.'),
    lower_shelf: bool('Shelf under the top.'),
    top_thickness_cm: num('Top thickness in cm, 1.5-8.'),
  }),
  bed: obj({
    headboard_height_ratio: num('Headboard height as a fraction of the overall height, 0.4-1.'),
    footboard: bool('Has a footboard.'),
  }),
  legs: obj({
    style: oneOf(LEG_STYLES, 'hidden = no visible legs (skirt or plinth); wood_base = exposed wooden base rail.'),
    height_cm: num('Visible leg height in cm, 0-75.'),
  }),
  colors: obj({
    main_hex: str('Main surface colour as #rrggbb, as it would look in neutral daylight.'),
    main_name: str('Plain colour name for the main surface, e.g. "olive green velvet".'),
    frame_hex: str('Legs / frame / wood colour as #rrggbb.'),
    frame_name: str('Plain colour name for legs or frame.'),
    hardware_hex: str('Handle / hardware colour as #rrggbb (use #b9b9b6 if none).'),
  }),
  notes: str('One sentence on anything the model cannot show, e.g. "curved back simplified".'),
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const iclamp = (v: unknown, lo: number, hi: number, d: number) => Math.round(clamp(v, lo, hi, d));
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T =>
  allowed.includes(v as T) ? (v as T) : d;
const hex = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : d);
const text = (v: unknown, d: string, max: number) =>
  (typeof v === 'string' && v.trim() ? v.trim() : d).replace(/[\u0000-\u001f]/g, ' ').slice(0, max);

/** Clamp and default every field of an untrusted spec, and attach the measured size. */
export function normalizeSpec(raw: unknown, size: SizeM): BuildSpec {
  const r = (raw ?? {}) as Record<string, any>;
  const sofa = r.sofa ?? {};
  const st = r.storage ?? {};
  const sh = r.shelving ?? {};
  const tb = r.table ?? {};
  const bd = r.bed ?? {};
  const lg = r.legs ?? {};
  const c = r.colors ?? {};
  return {
    name: text(r.name, 'My furniture', 60),
    furniture_type: pick(r.furniture_type, FURNITURE_TYPES, 'Other'),
    archetype: pick(r.archetype, ARCHETYPES, 'storage'),
    sofa: {
      seats: iclamp(sofa.seats, 1, 4, 3),
      back_cushions: iclamp(sofa.back_cushions, 0, 4, 3),
      arm_style: pick(sofa.arm_style, ARM_STYLES, 'track'),
      tufted: sofa.tufted === true,
      chaise: pick(sofa.chaise, CHAISE, 'none'),
      seat_cushion_style: pick(sofa.seat_cushion_style, SEAT_STYLES, 'separate'),
    },
    storage: {
      drawer_columns: iclamp(st.drawer_columns, 0, 3, 1),
      drawer_rows: iclamp(st.drawer_rows, 0, 8, 3),
      doors: iclamp(st.doors, 0, 4, 0),
      handle_style: pick(st.handle_style, HANDLES, 'knob'),
      top_overhang: st.top_overhang === true,
    },
    shelving: {
      columns: iclamp(sh.columns, 1, 6, 1),
      rows: iclamp(sh.rows, 1, 10, 5),
      back_panel: sh.back_panel !== false,
      open_cubbies: sh.open_cubbies === true,
    },
    table: {
      round_top: tb.round_top === true,
      lower_shelf: tb.lower_shelf === true,
      top_thickness_cm: clamp(tb.top_thickness_cm, 1.5, 8, 3),
    },
    bed: { headboard_height_ratio: clamp(bd.headboard_height_ratio, 0.4, 1, 1), footboard: bd.footboard !== false },
    legs: { style: pick(lg.style, LEG_STYLES, 'tapered'), height_cm: clamp(lg.height_cm, 0, 75, 12) },
    colors: {
      main_hex: hex(c.main_hex, '#9a9893'),
      main_name: text(c.main_name, 'Main colour', 40),
      frame_hex: hex(c.frame_hex, '#5b3b25'),
      frame_name: text(c.frame_name, 'Frame', 40),
      hardware_hex: hex(c.hardware_hex, '#b9b9b6'),
    },
    notes: text(r.notes, '', 200),
    size_m: {
      width: clamp(size.width, 0.2, 4, 1),
      depth: clamp(size.depth, 0.2, 4, 0.8),
      height: clamp(size.height, 0.2, 3, 0.8),
    },
  };
}

/** Validate the user's tape measurements (meters). Returns an error message or null. */
export function checkSize(size: unknown): string | null {
  const s = size as Partial<SizeM> | undefined;
  const limits: [keyof SizeM, number, number][] = [
    ['width', 0.2, 4],
    ['depth', 0.2, 4],
    ['height', 0.2, 3],
  ];
  for (const [k, lo, hi] of limits) {
    const v = s?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) {
      return `${k} must be between ${lo * 100} and ${hi * 100} cm.`;
    }
  }
  return null;
}

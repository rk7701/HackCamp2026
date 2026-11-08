/** "My furniture": products built from the user's photos, kept in server/data on this computer. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MY_FURNITURE } from '../src/catalog/furnitureTypes.ts';
import type { BuildResult } from './blender.ts';
import type { BuildSpec } from './spec.ts';

export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(import.meta.dirname, 'data'));
export const MODELS_DIR = join(DATA_DIR, 'models');
export const JOBS_DIR = join(DATA_DIR, 'jobs');
const CATALOG = join(DATA_DIR, 'catalog.json');

mkdirSync(MODELS_DIR, { recursive: true });
mkdirSync(JOBS_DIR, { recursive: true });

type ColorOption = { name: string; hex: string };
type ColorPart = { label: string; materials: string[]; options: ColorOption[] };

/** Same shape as the app's Product type (src/models/productCatalog.ts). */
export type CustomProduct = {
  id: string;
  label: string;
  brand: typeof MY_FURNITURE;
  type: string;
  sizedLike: string;
  sourceUrl: string;
  size: { width: number; depth: number; height: number };
  colorParts: ColorPart[];
  glbUrl: string;
  custom: { createdAt: string; notes: string };
};

const MAIN_PALETTE: ColorOption[] = [
  { name: 'White', hex: '#f1f0ec' },
  { name: 'Light grey', hex: '#b8b5af' },
  { name: 'Charcoal', hex: '#4b4b4e' },
  { name: 'Black', hex: '#232323' },
  { name: 'Beige', hex: '#d9c9ac' },
  { name: 'Navy', hex: '#2f3d5a' },
  { name: 'Olive green', hex: '#6f7a52' },
  { name: 'Rust', hex: '#a8643a' },
  { name: 'Light oak', hex: '#c8a26b' },
  { name: 'Walnut', hex: '#6e4a2f' },
];

const FRAME_PALETTE: ColorOption[] = [
  { name: 'Light oak', hex: '#c8a26b' },
  { name: 'Walnut', hex: '#5b3b25' },
  { name: 'Black', hex: '#1f1e1d' },
  { name: 'White', hex: '#efede8' },
  { name: 'Brass', hex: '#b08d57' },
];

const mm = (m: number) => Math.round(m * 1000) / 1000;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The photographed colour comes first so the model file's built-in colour is option 0. */
function withPhotoColour(name: string, hex: string, palette: ColorOption[]): ColorOption[] {
  return [{ name: `${capitalize(name)} (from your photos)`, hex }, ...palette.filter((o) => o.hex !== hex)];
}

export function toProduct(id: string, spec: BuildSpec, result: BuildResult): CustomProduct {
  const parts: ColorPart[] = [
    { label: 'Main', materials: ['Main finish'], options: withPhotoColour(spec.colors.main_name, spec.colors.main_hex, MAIN_PALETTE) },
  ];
  if (result.materials.includes('Frame finish')) {
    parts.push({
      label: 'Frame',
      materials: ['Frame finish'],
      options: withPhotoColour(spec.colors.frame_name, spec.colors.frame_hex, FRAME_PALETTE),
    });
  }
  return {
    id,
    label: spec.name,
    brand: MY_FURNITURE,
    type: spec.furniture_type,
    sizedLike: 'your photos and measurements',
    sourceUrl: '',
    size: { width: mm(result.width), depth: mm(result.depth), height: mm(result.height) },
    colorParts: parts,
    glbUrl: `custom-models/${id}.glb`,
    custom: { createdAt: new Date().toISOString(), notes: spec.notes },
  };
}

export function listProducts(): CustomProduct[] {
  if (!existsSync(CATALOG)) return [];
  try {
    return JSON.parse(readFileSync(CATALOG, 'utf8'));
  } catch {
    return [];
  }
}

function save(list: CustomProduct[]) {
  const tmp = `${CATALOG}.tmp`;
  writeFileSync(tmp, JSON.stringify(list, null, 2));
  renameSync(tmp, CATALOG);
}

export function addProduct(p: CustomProduct) {
  save([p, ...listProducts().filter((x) => x.id !== p.id)]);
}

export function removeProduct(id: string): boolean {
  const list = listProducts();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) return false;
  save(next);
  rmSync(join(MODELS_DIR, `${id}.glb`), { force: true });
  return true;
}

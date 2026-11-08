/** "My furniture": models Hunyuan3D built from the user's photos, kept in server/data on this computer. */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MY_FURNITURE } from '../src/catalog/furnitureTypes.ts';
import type { MeshSize } from './hunyuan.ts';

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
  custom: { createdAt: string; notes: string; stlUrl?: string };
};

/** The generated model has no texture; its single material starts neutral grey and can be recoloured. */
const MAIN_PALETTE: ColorOption[] = [
  { name: 'Light grey', hex: '#b8b5af' },
  { name: 'White', hex: '#f1f0ec' },
  { name: 'Charcoal', hex: '#4b4b4e' },
  { name: 'Black', hex: '#232323' },
  { name: 'Beige', hex: '#d9c9ac' },
  { name: 'Navy', hex: '#2f3d5a' },
  { name: 'Olive green', hex: '#6f7a52' },
  { name: 'Rust', hex: '#a8643a' },
  { name: 'Light oak', hex: '#c8a26b' },
  { name: 'Walnut', hex: '#6e4a2f' },
];

const mm = (m: number) => Math.round(m * 1000) / 1000;

export function toProduct(id: string, title: string, size: MeshSize, createdAt = new Date()): CustomProduct {
  return {
    id,
    label: title,
    brand: MY_FURNITURE,
    type: 'Other',
    sizedLike: 'your photos',
    sourceUrl: '',
    size: { width: mm(size.width), depth: mm(size.depth), height: mm(size.height) },
    colorParts: [{ label: 'Main', materials: ['Main finish'], options: MAIN_PALETTE }],
    glbUrl: `custom-models/${id}.glb`,
    custom: { createdAt: createdAt.toISOString(), notes: '', stlUrl: `custom-models/${id}.stl` },
  };
}

export function listProducts(): CustomProduct[] {
  if (!existsSync(CATALOG)) return [];
  const products: unknown = JSON.parse(readFileSync(CATALOG, 'utf8'));
  if (!Array.isArray(products)) throw new Error('The saved furniture catalogue could not be read.');
  // Never silently replace an unreadable catalogue with just the newest scan.
  return products as CustomProduct[];
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
  rmSync(join(MODELS_DIR, `${id}.stl`), { force: true });
  return true;
}

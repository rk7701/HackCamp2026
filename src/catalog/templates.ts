import type { DimensionKey, DimensionsM, RangeM } from '../domain/dimensions';
import type { FurnitureType } from './furnitureTypes';

export type LegStyle = 'square' | 'round' | 'tapered';

/** Shape parameters per builder. Every builder fills exactly the requested bounding box. */
export type TemplateShape =
  | { kind: 'table'; shelf: boolean; legStyle: LegStyle }
  | { kind: 'roundTable' }
  | { kind: 'desk' }
  | { kind: 'chair' }
  | { kind: 'sofa'; maxSeats: number }
  | { kind: 'sectional' }
  | { kind: 'bed' }
  | { kind: 'storage'; front: 'drawers' | 'doors'; rows?: number; cols?: number; legs: boolean }
  | { kind: 'bookshelf'; panelThickness: number; shelfSpacing: number };

export type TemplateDef = {
  id: string;
  label: string;
  type: FurnitureType;
  /** Extra words for search, e.g. "couch" for a sofa. */
  keywords: string;
  defaults: DimensionsM;
  ranges: Record<DimensionKey, RangeM>;
  shape: TemplateShape;
  /** Main surfaces. */
  color: string;
  /** Legs and frames. */
  frameColor?: string;
  /** Cushions, mattresses and pillows. */
  softColor?: string;
  /** Field label overrides, e.g. a bed's depth is its length. */
  labels?: Partial<Record<DimensionKey, string>>;
};

const cm = (width: number, depth: number, height: number): DimensionsM => ({
  width: width / 100,
  depth: depth / 100,
  height: height / 100,
});
const range = (min: number, max: number): RangeM => ({ min: min / 100, max: max / 100 });

const DEFS: TemplateDef[] = [
  {
    id: 'sofa',
    label: 'Sofa',
    type: 'Sofas',
    keywords: 'couch settee 3-seat loveseat seating',
    defaults: cm(213, 91, 84),
    ranges: { width: range(120, 340), depth: range(70, 120), height: range(60, 110) },
    shape: { kind: 'sofa', maxSeats: 3 },
    color: '#b8b2a7',
    frameColor: '#5b3b25',
  },
  {
    id: 'sectional',
    label: 'Sectional with chaise',
    type: 'Sofas',
    keywords: 'couch l-shaped corner chaise lounge sectional',
    defaults: cm(250, 160, 85),
    ranges: { width: range(180, 360), depth: range(130, 220), height: range(65, 110) },
    shape: { kind: 'sectional' },
    color: '#7f8a85',
    frameColor: '#2b2b2b',
  },
  {
    id: 'armchair',
    label: 'Armchair',
    type: 'Armchairs',
    keywords: 'accent chair lounge seat',
    defaults: cm(82, 86, 86),
    ranges: { width: range(55, 130), depth: range(55, 120), height: range(60, 120) },
    shape: { kind: 'sofa', maxSeats: 1 },
    color: '#c9b79a',
    frameColor: '#5b3b25',
  },
  {
    id: 'coffeeTable',
    label: 'Coffee table',
    type: 'Coffee & side tables',
    keywords: 'living room table low',
    defaults: cm(120, 60, 45),
    ranges: { width: range(50, 180), depth: range(40, 120), height: range(25, 60) },
    shape: { kind: 'table', shelf: true, legStyle: 'square' },
    color: '#c8a26b',
  },
  {
    id: 'sideTable',
    label: 'Side table',
    type: 'Coffee & side tables',
    keywords: 'end table accent lamp table',
    defaults: cm(50, 50, 55),
    ranges: { width: range(30, 80), depth: range(30, 80), height: range(35, 80) },
    shape: { kind: 'table', shelf: true, legStyle: 'tapered' },
    color: '#6e4a2f',
  },
  {
    id: 'table',
    label: 'Dining table',
    type: 'Dining tables & chairs',
    keywords: 'kitchen table dining wood rectangular oak',
    defaults: cm(160, 90, 75),
    ranges: { width: range(40, 300), depth: range(30, 150), height: range(40, 120) },
    shape: { kind: 'table', shelf: false, legStyle: 'square' },
    color: '#b07a4a',
  },
  {
    id: 'roundTable',
    label: 'Round dining table',
    type: 'Dining tables & chairs',
    keywords: 'pedestal kitchen table circular oval',
    defaults: cm(110, 110, 75),
    ranges: { width: range(60, 180), depth: range(60, 180), height: range(50, 110) },
    shape: { kind: 'roundTable' },
    color: '#6e4a2f',
  },
  {
    id: 'chair',
    label: 'Dining chair',
    type: 'Dining tables & chairs',
    keywords: 'chair seat kitchen side chair',
    defaults: cm(45, 52, 85),
    ranges: { width: range(35, 70), depth: range(40, 70), height: range(70, 120) },
    shape: { kind: 'chair' },
    color: '#9baf9b',
    frameColor: '#5b3b25',
  },
  {
    id: 'desk',
    label: 'Desk',
    type: 'Desks',
    keywords: 'office writing study computer workstation',
    defaults: cm(120, 60, 75),
    ranges: { width: range(70, 200), depth: range(40, 90), height: range(60, 125) },
    shape: { kind: 'desk' },
    color: '#efede8',
    frameColor: '#2b2b2b',
  },
  {
    id: 'bed',
    label: 'Bed frame',
    type: 'Beds',
    keywords: 'queen king double twin single headboard mattress',
    defaults: cm(163, 213, 110),
    ranges: { width: range(90, 220), depth: range(190, 230), height: range(60, 140) },
    shape: { kind: 'bed' },
    color: '#8d9196',
    softColor: '#f4f2ee',
    labels: { depth: 'Length' },
  },
  {
    id: 'nightstand',
    label: 'Nightstand',
    type: 'Nightstands',
    keywords: 'bedside table night table drawer',
    defaults: cm(50, 40, 55),
    ranges: { width: range(30, 80), depth: range(30, 60), height: range(35, 80) },
    shape: { kind: 'storage', front: 'drawers', rows: 2, cols: 1, legs: true },
    color: '#d9c6a5',
  },
  {
    id: 'dresser',
    label: 'Dresser',
    type: 'Dressers & chests',
    keywords: 'chest of drawers bureau bedroom storage',
    defaults: cm(150, 50, 80),
    ranges: { width: range(60, 200), depth: range(35, 65), height: range(60, 140) },
    shape: { kind: 'storage', front: 'drawers', legs: true },
    color: '#efede8',
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    type: 'Dressers & chests',
    keywords: 'armoire closet cupboard clothes',
    defaults: cm(100, 58, 200),
    ranges: { width: range(60, 250), depth: range(40, 70), height: range(140, 240) },
    shape: { kind: 'storage', front: 'doors', rows: 1, legs: false },
    color: '#efede8',
  },
  {
    id: 'tvStand',
    label: 'TV stand',
    type: 'Shelving & bookcases',
    keywords: 'media console sideboard television credenza',
    defaults: cm(160, 40, 50),
    ranges: { width: range(80, 240), depth: range(30, 60), height: range(35, 80) },
    shape: { kind: 'storage', front: 'doors', rows: 1, legs: true },
    color: '#2e2c2a',
    frameColor: '#c8a26b',
  },
  {
    id: 'bookshelf',
    label: 'Bookshelf',
    type: 'Shelving & bookcases',
    keywords: 'bookcase shelves storage shelving wood open',
    defaults: cm(80, 30, 180),
    ranges: { width: range(30, 200), depth: range(20, 60), height: range(40, 240) },
    shape: { kind: 'bookshelf', panelThickness: 0.018, shelfSpacing: 0.35 },
    color: '#d9c6a5',
  },
];

export const TEMPLATES: Record<string, TemplateDef> = Object.fromEntries(DEFS.map((d) => [d.id, d]));
export const TEMPLATE_IDS: string[] = DEFS.map((d) => d.id);
export type TemplateId = string;

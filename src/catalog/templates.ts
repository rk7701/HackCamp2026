import type { DimensionKey, DimensionsM, RangeM } from '../domain/dimensions';

export type TemplateId = 'table' | 'bookshelf' | 'chair' | 'sofa';

export type TableShape = {
  kind: 'table';
  topThickness: number;
  legThickness: number;
  /** Distance from the footprint edge to the outer face of each leg. */
  legInset: number;
};

export type BookshelfShape = {
  kind: 'bookshelf';
  panelThickness: number;
  /** Target vertical spacing between shelves; the count is derived from height. */
  shelfSpacing: number;
};

export type SeatingShape = { kind: 'chair' | 'sofa' };
export type TemplateShape = TableShape | BookshelfShape | SeatingShape;

export type TemplateDef = {
  id: TemplateId;
  label: string;
  defaults: DimensionsM;
  ranges: Record<DimensionKey, RangeM>;
  shape: TemplateShape;
  color: string;
};

export const TEMPLATES: Record<TemplateId, TemplateDef> = {
  chair: {
    id: 'chair', label: 'Chair',
    defaults: { width: 0.55, depth: 0.55, height: 0.85 },
    ranges: { width: { min: 0.3, max: 1 }, depth: { min: 0.3, max: 1 }, height: { min: 0.5, max: 1.3 } },
    shape: { kind: 'chair' }, color: '#9baf9b',
  },
  sofa: {
    id: 'sofa', label: 'Sofa',
    defaults: { width: 2, depth: 0.9, height: 0.85 },
    ranges: { width: { min: 1, max: 3.5 }, depth: { min: 0.6, max: 1.5 }, height: { min: 0.5, max: 1.3 } },
    shape: { kind: 'sofa' }, color: '#c7b7a0',
  },
  table: {
    id: 'table',
    label: 'Table',
    defaults: { width: 1.2, depth: 0.75, height: 0.75 },
    ranges: {
      width: { min: 0.3, max: 3.0 },
      depth: { min: 0.3, max: 1.5 },
      height: { min: 0.3, max: 1.2 },
    },
    shape: { kind: 'table', topThickness: 0.03, legThickness: 0.05, legInset: 0.03 },
    color: '#b07a4a',
  },
  bookshelf: {
    id: 'bookshelf',
    label: 'Bookshelf',
    defaults: { width: 0.8, depth: 0.3, height: 1.8 },
    ranges: {
      width: { min: 0.3, max: 2.0 },
      depth: { min: 0.2, max: 0.6 },
      height: { min: 0.4, max: 2.4 },
    },
    shape: { kind: 'bookshelf', panelThickness: 0.018, shelfSpacing: 0.35 },
    color: '#d9c6a5',
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

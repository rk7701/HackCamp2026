import { describe, expect, it } from 'vitest';
import { GALLERY, filterFurniture } from '../src/catalog/gallery';
import { TEMPLATE_IDS } from '../src/catalog/templates';

describe('furniture search and type filters', () => {
  const all = new Set(TEMPLATE_IDS);
  it('starts with all four furniture types', () => {
    expect(filterFurniture(GALLERY, '', all)).toHaveLength(4);
  });
  it('matches names and synonyms without case sensitivity', () => {
    expect(filterFurniture(GALLERY, '  COUCH  ', all).map(item => item.id)).toEqual(['sofa']);
    expect(filterFurniture(GALLERY, 'oak dining', all).map(item => item.id)).toEqual(['table']);
  });
  it('combines search with the checked types', () => {
    expect(filterFurniture(GALLERY, 'wood', new Set(['bookshelf'])).map(item => item.id)).toEqual(['bookshelf']);
    expect(filterFurniture(GALLERY, 'couch', new Set(['chair']))).toEqual([]);
  });
  it('shows no items when all types are unchecked or the query has no matches', () => {
    expect(filterFurniture(GALLERY, '', new Set())).toEqual([]);
    expect(filterFurniture(GALLERY, 'wardrobe', all)).toEqual([]);
  });
});

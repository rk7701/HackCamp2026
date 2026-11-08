import { describe, expect, it } from 'vitest';
import { GALLERY, ALL_FURNITURE, CATEGORIES, GALLERY_BRANDS, filterFurniture } from '../src/catalog/gallery';
import { PRODUCTS } from '../src/models/productCatalog';

describe('furniture search and type filters', () => {
  const all = new Set(CATEGORIES);
  it('starts with all four furniture types', () => {
    expect(filterFurniture(GALLERY, '', all)).toHaveLength(4);
  });
  it('matches names and synonyms without case sensitivity', () => {
    expect(filterFurniture(GALLERY, '  COUCH  ', all).map(item => item.id)).toEqual(['sofa']);
    expect(filterFurniture(GALLERY, 'oak dining', all).map(item => item.id)).toEqual(['table']);
  });
  it('combines search with the checked types', () => {
    expect(filterFurniture(GALLERY, 'wood', new Set(['Shelving & bookcases'])).map(item => item.id)).toEqual(['bookshelf']);
    expect(filterFurniture(GALLERY, 'couch', new Set(['Chairs']))).toEqual([]);
  });
  it('shows no items when all types are unchecked or the query has no matches', () => {
    expect(filterFurniture(GALLERY, '', new Set())).toEqual([]);
    expect(filterFurniture(GALLERY, 'wardrobe', all)).toEqual([]);
  });

  it('includes every catalog product exactly once alongside the original templates', () => {
    expect(ALL_FURNITURE).toHaveLength(GALLERY.length + PRODUCTS.length);
    expect(new Set(ALL_FURNITURE.map(item => item.id)).size).toBe(ALL_FURNITURE.length);
    for (const product of PRODUCTS) {
      expect(ALL_FURNITURE.find(item => item.id === product.id)).toMatchObject({
        brand: product.brand, category: product.type, source: { kind: 'product', productId: product.id },
      });
    }
  });

  it('filters the master list by brand and category together', () => {
    expect(filterFurniture(ALL_FURNITURE, '', new Set(['Sofas']), 'Article')).toHaveLength(3);
    expect(filterFurniture(ALL_FURNITURE, '', new Set(['Beds']), 'IKEA').map(item => item.id)).toEqual(['high-platform-bed-queen']);
    expect(filterFurniture(ALL_FURNITURE, '', new Set(['Beds']), 'Article')).toEqual([]);
    expect(filterFurniture(ALL_FURNITURE, '', all, 'Templates')).toEqual(GALLERY);
  });

  it('searches retail names, accents, brands, and available finishes', () => {
    expect(filterFurniture(ALL_FURNITURE, 'poang', all).map(item => item.id)).toEqual(['bentwood-armchair']);
    expect(filterFurniture(ALL_FURNITURE, 'kallax', all)).toHaveLength(2);
    expect(filterFurniture(ALL_FURNITURE, 'walnut', all, 'IKEA').map(item => item.id)).toContain('tall-bookcase');
    expect(filterFurniture(ALL_FURNITURE, 'structube falcon', all).map(item => item.id)).toEqual(['angled-arm-3-seat-sofa']);
  });

  it('every shop brand and category has at least one item', () => {
    for (const brand of GALLERY_BRANDS) expect(filterFurniture(ALL_FURNITURE, '', all, brand).length).toBeGreaterThan(0);
    for (const category of CATEGORIES) expect(filterFurniture(ALL_FURNITURE, '', new Set([category])).length).toBeGreaterThan(0);
  });
});

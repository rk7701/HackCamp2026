import { describe, expect, it } from 'vitest';
import { BRANDS, FURNITURE_TYPES, PRODUCTS, filterProducts } from '../src/models/productCatalog';

const ids = (filter: Parameters<typeof filterProducts>[1]) => filterProducts(PRODUCTS, filter).map((p) => p.id);

describe('filterProducts', () => {
  it('returns everything with no filters', () => {
    expect(ids({})).toHaveLength(PRODUCTS.length);
    expect(ids({ brand: '', type: '', query: '   ' })).toHaveLength(PRODUCTS.length);
  });

  it('every brand has products and every product has a known type', () => {
    for (const brand of BRANDS) expect(ids({ brand }).length).toBeGreaterThan(0);
    for (const p of PRODUCTS) expect(FURNITURE_TYPES).toContain(p.type);
  });

  it('filters by brand', () => {
    expect(ids({ brand: 'Article' }).sort()).toEqual(['low-profile-sofa', 'tufted-mid-century-sofa', 'wood-frame-3-seat-sofa']);
    expect(ids({ brand: 'IKEA' })).not.toContain('tufted-mid-century-sofa');
    expect(ids({ brand: 'West Elm' })).toEqual(['mid-century-6-drawer-dresser']);
    expect(ids({ brand: 'Structube' }).sort()).toEqual(['angled-arm-3-seat-sofa', 'mid-century-3-seat-sofa']);
  });

  it('filters by type and combines with brand', () => {
    expect(ids({ type: 'Sofas' })).toHaveLength(7);
    expect(ids({ type: 'Sofas', brand: 'IKEA' }).sort()).toEqual(['corner-sofa-bed', 'rolled-arm-3-seat-sofa']);
    expect(ids({ type: 'Beds' })).toEqual(['high-platform-bed-queen']);
  });

  it('searches product names it is sized like, ignoring case and accents', () => {
    expect(ids({ query: 'kallax' }).sort()).toEqual(['cube-shelf-2x4', 'cube-shelf-4x4']);
    expect(ids({ query: 'poang' })).toEqual(['bentwood-armchair']);
    expect(ids({ query: 'POÄNG' })).toEqual(['bentwood-armchair']);
  });

  it('searches our labels, types and colour names, requiring every word', () => {
    expect(ids({ query: 'desk' })).toEqual(['compact-desk']);
    expect(ids({ query: 'walnut' })).toContain('tall-bookcase');
    expect(ids({ query: 'malm 3-drawer' })).toEqual(['modern-3-drawer-chest']);
    expect(ids({ query: 'kallax sofa' })).toEqual([]);
    expect(ids({ query: 'timber' })).toEqual(['wood-frame-3-seat-sofa']);
    expect(ids({ query: 'malm bed' })).toEqual(['high-platform-bed-queen']);
    expect(ids({ query: 'structube falcon' })).toEqual(['angled-arm-3-seat-sofa']);
  });

  it('applies search within the chosen filters', () => {
    expect(ids({ query: 'velvet', type: 'Sofas' })).toEqual(['tufted-mid-century-sofa']);
    expect(ids({ query: 'velvet', brand: 'IKEA' })).toEqual([]);
  });
});

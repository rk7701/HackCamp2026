import { afterEach, describe, expect, it } from 'vitest';
import { GALLERY, TEMPLATE_BRAND, filterFurniture, galleryBrands, galleryCategories, galleryItems } from '../src/catalog/gallery';
import { TEMPLATE_IDS } from '../src/catalog/templates';
import { PRODUCTS, setCustomProducts, type Product } from '../src/models/productCatalog';

const ids = (items: { id: string }[]) => items.map((i) => i.id);

describe('furniture search and type filters', () => {
  const all = new Set(galleryCategories());

  it('lists every editable template', () => {
    expect(filterFurniture(GALLERY, '', all)).toHaveLength(TEMPLATE_IDS.length);
    expect(GALLERY.length).toBeGreaterThanOrEqual(15);
  });

  it('matches names and synonyms without case sensitivity', () => {
    expect(ids(filterFurniture(GALLERY, '  COUCH  ', all)).sort()).toEqual(['template-sectional', 'template-sofa']);
    expect(ids(filterFurniture(GALLERY, 'oak dining', all))).toEqual(['template-table']);
    expect(ids(filterFurniture(GALLERY, 'wardrobe', all))).toEqual(['template-wardrobe']);
  });

  it('combines search with the checked types', () => {
    expect(ids(filterFurniture(GALLERY, 'wood', new Set(['Shelving & bookcases'])))).toEqual(['template-bookshelf']);
    expect(filterFurniture(GALLERY, 'couch', new Set(['Beds']))).toEqual([]);
  });

  it('shows no items when all types are unchecked or the query has no matches', () => {
    expect(filterFurniture(GALLERY, '', new Set())).toEqual([]);
    expect(filterFurniture(GALLERY, 'trampoline', all)).toEqual([]);
  });

  it('includes every catalog product exactly once alongside the templates', () => {
    const items = galleryItems();
    expect(items).toHaveLength(GALLERY.length + PRODUCTS.length);
    expect(new Set(ids(items)).size).toBe(items.length);
    for (const product of PRODUCTS) {
      expect(items.find((item) => item.id === product.id)).toMatchObject({
        brand: product.brand,
        category: product.type,
        source: { kind: 'product', productId: product.id },
      });
    }
  });

  it('filters the master list by brand and category together', () => {
    const items = galleryItems();
    expect(filterFurniture(items, '', new Set(['Sofas']), 'Article')).toHaveLength(3);
    expect(ids(filterFurniture(items, '', new Set(['Beds']), 'IKEA'))).toEqual(['high-platform-bed-queen']);
    expect(filterFurniture(items, '', new Set(['Beds']), 'Article')).toEqual([]);
    expect(filterFurniture(items, '', all, TEMPLATE_BRAND)).toEqual(GALLERY);
  });

  it('searches retail names, accents, brands, and available finishes', () => {
    const items = galleryItems();
    expect(ids(filterFurniture(items, 'poang', all))).toEqual(['bentwood-armchair']);
    expect(filterFurniture(items, 'kallax', all)).toHaveLength(2);
    expect(ids(filterFurniture(items, 'walnut', all, 'IKEA'))).toContain('tall-bookcase');
    expect(ids(filterFurniture(items, 'structube falcon', all))).toEqual(['angled-arm-3-seat-sofa']);
  });

  it('every shop brand and category has at least one item', () => {
    const items = galleryItems();
    for (const brand of galleryBrands(items)) expect(filterFurniture(items, '', all, brand).length).toBeGreaterThan(0);
    for (const category of galleryCategories(items)) expect(filterFurniture(items, '', new Set([category])).length).toBeGreaterThan(0);
  });
});

describe('My furniture in the gallery', () => {
  afterEach(() => setCustomProducts([]));

  it('appears first, under its own brand, once the scan server reports it', () => {
    const mine: Product = {
      ...PRODUCTS[0],
      id: 'my-test',
      label: 'Olive sofa',
      brand: 'My furniture',
      type: 'Other',
      custom: { createdAt: '2026-11-08', notes: '' },
    };
    expect(galleryBrands()).not.toContain('My furniture');
    setCustomProducts([mine]);
    const items = galleryItems();
    expect(items[0].id).toBe('my-test');
    expect(galleryBrands(items)[0]).toBe('My furniture');
    expect(galleryCategories(items)).toContain('Other');
    expect(ids(filterFurniture(items, 'olive', new Set(galleryCategories(items))))).toEqual(['my-test']);
  });
});

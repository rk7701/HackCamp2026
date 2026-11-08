import { TEMPLATES, TEMPLATE_IDS, type TemplateId } from './templates';
import { FURNITURE_TYPES, MY_FURNITURE, type FurnitureType } from './furnitureTypes';
import { BRANDS, allProducts, type Product } from '../models/productCatalog';

export type FurnitureCategory = FurnitureType;
export const TEMPLATE_BRAND = 'Templates';

export type GalleryItem = {
  id: string;
  name: string;
  keywords: string;
  category: FurnitureCategory;
  brand: string;
  source: { kind: 'template'; templateId: TemplateId } | { kind: 'product'; productId: string; glbUrl: string };
};

/** Editable templates (any size). */
export const GALLERY: GalleryItem[] = TEMPLATE_IDS.map((id) => {
  const t = TEMPLATES[id];
  return { id: `template-${id}`, name: t.label, keywords: t.keywords, category: t.type, brand: TEMPLATE_BRAND, source: { kind: 'template', templateId: id } };
});

function productItem(product: Product): GalleryItem {
  return {
    id: product.id,
    name: product.label,
    category: product.type,
    brand: product.brand,
    keywords: [
      product.sizedLike,
      product.custom ? 'my own photos scan' : '',
      ...product.colorParts.flatMap((part) => part.options.map((option) => option.name)),
    ].join(' '),
    source: { kind: 'product', productId: product.id, glbUrl: product.glbUrl },
  };
}

/** Everything in the gallery right now: My furniture, retail look-alikes, then templates. */
export function galleryItems(): GalleryItem[] {
  return [...allProducts().map(productItem), ...GALLERY];
}

/** Furniture types that currently have at least one item, in catalogue order. */
export function galleryCategories(items: GalleryItem[] = galleryItems()): FurnitureCategory[] {
  return FURNITURE_TYPES.filter((t) => items.some((i) => i.category === t));
}

/** Brands for the brand row: My furniture (if any), retailers, then Templates. */
export function galleryBrands(items: GalleryItem[] = galleryItems()): string[] {
  return [MY_FURNITURE, ...BRANDS, TEMPLATE_BRAND].filter((b) => items.some((i) => i.brand === b));
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function filterFurniture(items: GalleryItem[], query: string, types: ReadonlySet<FurnitureCategory>, brand = ''): GalleryItem[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  return items.filter(
    (item) =>
      types.has(item.category) &&
      (!brand || item.brand === brand) &&
      words.every((word) => fold(`${item.name} ${item.brand} ${item.category} ${item.keywords}`).includes(word)),
  );
}

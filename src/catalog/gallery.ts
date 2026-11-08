import type { TemplateId } from './templates';
import { PRODUCTS, FURNITURE_TYPES as PRODUCT_TYPES, BRANDS, type Brand, type FurnitureType } from '../models/productCatalog';

export type FurnitureCategory = FurnitureType | 'Chairs' | 'Tables';
export type GalleryBrand = Brand | 'Templates';
export const FURNITURE_TYPES: Record<TemplateId, FurnitureCategory> = {
  chair: 'Chairs', table: 'Tables', sofa: 'Sofas', bookshelf: 'Shelving & bookcases',
};
export const CATEGORIES: FurnitureCategory[] = ['Chairs', 'Tables', ...PRODUCT_TYPES];
export const GALLERY_BRANDS: GalleryBrand[] = [...BRANDS, 'Templates'];

export type GalleryItem = {
  id: string;
  name: string;
  keywords: string;
  category: FurnitureCategory;
  brand: GalleryBrand;
  source: { kind: 'template'; templateId: TemplateId } | { kind: 'product'; productId: string; glbUrl: string };
};
export const GALLERY: GalleryItem[] = [
  { id: 'chair', name: 'Everyday chair', keywords: 'seat dining green', category: 'Chairs', brand: 'Templates', source: { kind: 'template', templateId: 'chair' } },
  { id: 'table', name: 'Oak table', keywords: 'dining wood desk', category: 'Tables', brand: 'Templates', source: { kind: 'template', templateId: 'table' } },
  { id: 'sofa', name: 'Two-seat sofa', keywords: 'couch seating beige', category: 'Sofas', brand: 'Templates', source: { kind: 'template', templateId: 'sofa' } },
  { id: 'bookshelf', name: 'Open bookshelf', keywords: 'shelves storage bookcase wood', category: 'Shelving & bookcases', brand: 'Templates', source: { kind: 'template', templateId: 'bookshelf' } },
];

export const ALL_FURNITURE: GalleryItem[] = [...GALLERY, ...PRODUCTS.map((product): GalleryItem => ({
  id: product.id, name: product.label, category: product.type, brand: product.brand,
  keywords: [product.sizedLike, ...product.colorParts.flatMap(part => part.options.map(option => option.name))].join(' '),
  source: { kind: 'product', productId: product.id, glbUrl: product.glbUrl },
}))];

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function filterFurniture(items: GalleryItem[], query: string, types: ReadonlySet<FurnitureCategory>, brand: GalleryBrand | '' = ''): GalleryItem[] {
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  return items.filter(item => types.has(item.category) && (!brand || item.brand === brand) && words.every(word =>
    fold(`${item.name} ${item.brand} ${item.category} ${item.keywords}`).includes(word)));
}

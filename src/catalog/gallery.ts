import type { TemplateId } from './templates';

export const FURNITURE_TYPES: Record<TemplateId, string> = {
  chair: 'Chairs', table: 'Tables', sofa: 'Sofas', bookshelf: 'Bookshelves',
};

export type GalleryItem = { id: TemplateId; name: string; keywords: string };
export const GALLERY: GalleryItem[] = [
  { id: 'chair', name: 'Everyday chair', keywords: 'seat dining green' },
  { id: 'table', name: 'Oak table', keywords: 'dining wood desk' },
  { id: 'sofa', name: 'Two-seat sofa', keywords: 'couch seating beige' },
  { id: 'bookshelf', name: 'Open bookshelf', keywords: 'shelves storage bookcase wood' },
];

export function filterFurniture(items: GalleryItem[], query: string, types: ReadonlySet<TemplateId>): GalleryItem[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter(item => types.has(item.id) && words.every(word =>
    `${item.name} ${FURNITURE_TYPES[item.id]} ${item.keywords}`.toLowerCase().includes(word)));
}

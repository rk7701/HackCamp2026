/** Furniture types shared by the app and the scan server (no browser- or Vite-only code here). */
export const FURNITURE_TYPES = [
  'Sofas',
  'Armchairs',
  'Coffee & side tables',
  'Dining tables & chairs',
  'Shelving & bookcases',
  'Dressers & chests',
  'Nightstands',
  'Beds',
  'Desks',
  'Other',
] as const;
export type FurnitureType = (typeof FURNITURE_TYPES)[number];

/** Brand shown for furniture the user added from their own photos. */
export const MY_FURNITURE = 'My furniture';

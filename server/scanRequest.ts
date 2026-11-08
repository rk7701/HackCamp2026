/** Validation for POST /api/scans: a title, a height and 1-4 labelled photos (front required). */

export const VIEWS = ['front', 'left', 'back', 'right'] as const;
export type View = (typeof VIEWS)[number];

export const HEIGHT_RANGE_M = { min: 0.1, max: 3 } as const;
export const TITLE_MAX = 60;
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

export type ScanPhoto = { view: View; ext: 'jpg' | 'png' | 'webp'; bytes: Buffer };
export type ScanRequest = { title: string; heightM: number; photos: ScanPhoto[] };

/** Strip control characters, collapse whitespace and trim. */
export function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `views` are the views the current model uses; photos of other views are rejected. */
export function parseScanRequest(
  body: unknown,
  views: readonly View[] = VIEWS,
): { ok: true; value: ScanRequest } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  const title = cleanTitle(b.title);
  if (!title) return { ok: false, error: 'Give your furniture a name.' };
  if (title.length > TITLE_MAX) return { ok: false, error: `Keep the name under ${TITLE_MAX} characters.` };

  const heightM = b.heightM;
  if (typeof heightM !== 'number' || !Number.isFinite(heightM) || heightM < HEIGHT_RANGE_M.min || heightM > HEIGHT_RANGE_M.max) {
    return { ok: false, error: `Height must be between ${HEIGHT_RANGE_M.min * 100} and ${HEIGHT_RANGE_M.max * 100} cm.` };
  }

  const raw = Array.isArray(b.photos) ? b.photos : [];
  if (raw.length < 1 || raw.length > views.length) {
    return { ok: false, error: views.length === 1 ? 'Send one front photo.' : `Send between 1 and ${views.length} photos.` };
  }

  const photos: ScanPhoto[] = [];
  for (const p of raw as { view?: unknown; dataUrl?: unknown }[]) {
    const view = views.find((v) => v === p?.view);
    if (!view || photos.some((x) => x.view === view)) {
      return { ok: false, error: `Each photo needs a different view: ${views.join(', ')}.` };
    }
    const match = typeof p.dataUrl === 'string' ? DATA_URL.exec(p.dataUrl) : null;
    const bytes = match ? Buffer.from(match[2], 'base64') : null;
    if (!match || !bytes || bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
      return { ok: false, error: 'Each photo must be a JPEG, PNG or WebP under 6 MB.' };
    }
    photos.push({ view, ext: match[1] === 'jpeg' ? 'jpg' : (match[1] as 'png' | 'webp'), bytes });
  }
  if (!photos.some((p) => p.view === 'front')) return { ok: false, error: 'A front photo is required.' };

  return { ok: true, value: { title, heightM, photos } };
}

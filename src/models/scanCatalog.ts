import type { DimensionsM } from '../domain/dimensions';

export type ScanAsset = {
  id: string;
  label: string;
  glbUrl: string;
  /** Matching USDZ with the same scale and floor origin. If omitted, model-viewer converts the GLB on iOS. */
  usdzUrl?: string;
  /** Width, depth and height checked against a tape measure. */
  measuredSize: DimensionsM;
};

const base = import.meta.env.BASE_URL;

/**
 * Bundled scans. Drop the files into public/models/ and update measuredSize
 * after verifying the real piece with a tape measure (see public/models/README.md).
 */
export const SCANS: ScanAsset[] = [
  {
    id: 'sample-scan',
    label: 'Sample scan',
    glbUrl: `${base}models/sample-scan.glb`,
    usdzUrl: `${base}models/sample-scan.usdz`,
    measuredSize: { width: 0.4, depth: 0.4, height: 0.45 },
  },
];

/**
 * Check that a bundled file really exists. Static dev servers can answer a missing
 * path with index.html, so an HTML response counts as missing.
 */
async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/** Resolve which scan files are present. Returns null when the GLB is missing. */
export async function resolveScan(scan: ScanAsset): Promise<ScanAsset | null> {
  const [glb, usdz] = await Promise.all([exists(scan.glbUrl), scan.usdzUrl ? exists(scan.usdzUrl) : false]);
  if (!glb) return null;
  return { ...scan, usdzUrl: usdz ? scan.usdzUrl : undefined };
}

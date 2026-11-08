import { formatLength, type Unit } from './dimensions';

export type Footprint = { width: number; depth: number };
export type FitStatus = 'fits' | 'tight' | 'too-big';

export type FitResult = {
  status: FitStatus;
  /** Positive = spare room, negative = overhang, in meters. */
  widthMargin: number;
  depthMargin: number;
  /** True when the other orientation would fit and this one does not. */
  rotationHelps: boolean;
  message: string;
};

/** Margins below this (per side total) are reported as "tight" and the user is asked to remeasure. */
export const TIGHT_MARGIN_M = 0.02;

function margins(f: Footprint, gap: Footprint, rotated: boolean) {
  const w = rotated ? f.depth : f.width;
  const d = rotated ? f.width : f.depth;
  return { widthMargin: gap.width - w, depthMargin: gap.depth - d };
}

/**
 * Compare a measured floor gap with the furniture footprint.
 * Only covers the opening the user measured: not door swings, baseboards or the path into the room.
 */
export function checkFit(furniture: Footprint, gap: Footprint, rotated: boolean, unit: Unit): FitResult {
  const { widthMargin, depthMargin } = margins(furniture, gap, rotated);
  const other = margins(furniture, gap, !rotated);
  const otherFits = other.widthMargin >= 0 && other.depthMargin >= 0;

  if (widthMargin < 0 || depthMargin < 0) {
    const parts: string[] = [];
    if (widthMargin < 0) parts.push(`${formatLength(-widthMargin, unit)} too wide`);
    if (depthMargin < 0) parts.push(`${formatLength(-depthMargin, unit)} too deep`);
    let message = `${capitalize(parts.join(' and '))} for this gap.`;
    if (otherFits) message += ' Turning it 90° would fit.';
    return { status: 'too-big', widthMargin, depthMargin, rotationHelps: otherFits, message };
  }

  const minMargin = Math.min(widthMargin, depthMargin);
  if (minMargin < TIGHT_MARGIN_M) {
    return {
      status: 'tight',
      widthMargin,
      depthMargin,
      rotationHelps: false,
      message: `Fits with only ${formatLength(minMargin, unit)} to spare. Remeasure the gap before you commit.`,
    };
  }
  return {
    status: 'fits',
    widthMargin,
    depthMargin,
    rotationHelps: false,
    message: `Fits with ${formatLength(widthMargin, unit)} spare in width and ${formatLength(depthMargin, unit)} in depth.`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

import type { ScanProgress } from '../src/scan/progress.ts';

/** Read real tqdm counts, including carriage-return updates, without estimating elapsed work. */
export function parseTerminalProgress(line: string): ScanProgress | undefined {
  const label = line.includes('Diffusion Sampling') ? 'Building the shape' :
    line.includes('FlashVDM Volume Decoding') ? 'Adding shape detail' : undefined;
  const counts = line.match(/\|\s*(\d+)\/(\d+)\s*\[/);
  if (!label || !counts) return;
  const completed = Number(counts[1]), total = Number(counts[2]);
  if (!Number.isSafeInteger(total) || total <= 0 || completed > total) return;
  return { label, completed, total };
}

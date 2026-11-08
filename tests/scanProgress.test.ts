import { describe, expect, it } from 'vitest';
import { parseTerminalProgress } from '../server/scanProgress';
import { scanErrorMessage } from '../src/scan/progress';

describe('terminal progress forwarding', () => {
  it('reads actual sampling and decoding counts', () => {
    expect(parseTerminalProgress('Diffusion Sampling:: 60%|██████ | 3/5 [00:01<00:00]')).toEqual({ label: 'Building the shape', completed: 3, total: 5 });
    expect(parseTerminalProgress('FlashVDM Volume Decoding: 100%|████| 64/64 [00:00<00:00]')).toEqual({ label: 'Adding shape detail', completed: 64, total: 64 });
  });
  it('ignores logs, malformed updates and impossible counts', () => {
    for (const line of ['model ready', 'Diffusion Sampling: loading', 'Diffusion Sampling: | 1/0 [', 'Diffusion Sampling: | 6/5 [']) {
      expect(parseTerminalProgress(line)).toBeUndefined();
    }
  });
  it('keeps engine diagnostics out of UI errors', () => {
    for (const message of ['Hunyuan3D failed to load', 'tencent/Hunyuan3D-2mini', 'hy3dgen failed', 'Run: npm run hunyuan:setup']) {
      expect(scanErrorMessage(message)).not.toMatch(/hunyuan|tencent|hy3dgen/i);
    }
    expect(scanErrorMessage('Each photo must be under 6 MB.')).toBe('Each photo must be under 6 MB.');
  });
});

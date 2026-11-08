import { describe, expect, it, vi } from 'vitest';
import { withScanRetries } from '../server/scanRetry';

describe('scan resource recovery', () => {
  it('recovers a transient failure without asking for another upload', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('The Hunyuan3D worker stopped unexpectedly')).mockResolvedValue('mesh');
    const onRetry = vi.fn();
    const wait = vi.fn().mockResolvedValue(undefined);
    expect(await withScanRetries(run, onRetry, wait)).toBe('mesh');
    expect(run).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(2, 10_000);
    expect(wait).toHaveBeenCalledWith(10_000);
  });

  it('bounds retries when GPU allocations keep failing', async () => {
    const run = vi.fn().mockRejectedValue(new Error('The GPU ran out of memory.'));
    const wait = vi.fn().mockResolvedValue(undefined);
    await expect(withScanRetries(run, vi.fn(), wait)).rejects.toThrow('The GPU ran out of memory.');
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10_000], [20_000]]);
  });

  it('does not retry unreadable photos or missing installations', async () => {
    for (const message of ['cannot identify image file', 'Python environment not found', 'weights do not match the model']) {
      const run = vi.fn().mockRejectedValue(new Error(message));
      const wait = vi.fn();
      await expect(withScanRetries(run, vi.fn(), wait)).rejects.toThrow(message);
      expect(run).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  });
});

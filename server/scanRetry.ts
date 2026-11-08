import { setTimeout as delay } from 'node:timers/promises';

/** Retry only temporary resource/worker failures; bad photos and setup errors need user action. */
export function isTransientScanError(error: unknown): boolean {
  return error instanceof Error && /out of memory|stopped unexpectedly|took too long/i.test(error.message);
}

export async function withScanRetries<T>(
  run: () => Promise<T>,
  onRetry: (attempt: number, delayMs: number) => void,
  wait: (ms: number) => Promise<unknown> = delay,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= 2 || !isTransientScanError(error)) throw error;
      const delayMs = (attempt + 1) * 10_000;
      onRetry(attempt + 2, delayMs);
      await wait(delayMs);
    }
  }
}

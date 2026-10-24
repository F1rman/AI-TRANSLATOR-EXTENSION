import { ExtensionError } from './protocol';
import type { Job, Segment } from './protocol';

const TRANSIENT = new Set(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'HTTP_502', 'HTTP_503', 'HTTP_504']);
export function pollingDelay(segments: Segment[], attempt: number, elapsed: number): number {
  const short = segments.length === 1 && Array.from(segments[0].text).length <= 500;
  return short && elapsed < 10_000 ? [250, 500, 750, 1000][Math.min(attempt, 3)] : short ? 1500 : 1400;
}
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
/** Poll short durable requests; no upstream call is held open in a Chrome worker. */
export async function pollTranslationJob(
  initial: Job,
  get: (id: string) => Promise<Job>,
  options: { segments: Segment[]; signal?: AbortSignal; deadline: number; now?: () => number; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> },
): Promise<Job> {
  const now = options.now || Date.now;
  const sleep = options.sleep || pause;
  const started = now();
  let job = initial, attempt = 0, failures = 0;
  while (job.status === 'queued' || job.status === 'running') {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (now() >= options.deadline) throw new ExtensionError({ code: 'UPSTREAM_TIMEOUT', message: 'Translation took too long. Please retry.' });
    await sleep(Math.min(pollingDelay(options.segments, attempt++, now() - started), options.deadline - now()), options.signal);
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (now() >= options.deadline) throw new ExtensionError({ code: 'UPSTREAM_TIMEOUT', message: 'Translation took too long. Please retry.' });
    try { job = await get(job.id); failures = 0; }
    catch (error) {
      const code = error instanceof Error && 'code' in error ? String(error.code) : 'NETWORK_ERROR';
      if (!TRANSIENT.has(code) || failures++ >= 4) throw error;
      await sleep(Math.min(1000 * 2 ** failures, 10_000), options.signal);
    }
  }
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  return job;
}

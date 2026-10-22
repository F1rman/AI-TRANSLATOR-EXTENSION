import type { ApiError, CreateJob, Job, Result, RuntimeRequest, Segment } from '../shared/protocol';

export class ContentError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ContentError'; }
}

export async function request<T>(message: RuntimeRequest): Promise<T> {
  let response: Result<T>;
  try {
    response = await chrome.runtime.sendMessage(message) as Result<T>;
  } catch {
    throw new ContentError('NETWORK_ERROR', 'The extension connection was interrupted.');
  }
  if (!response?.ok) throw new ContentError(response?.error?.code ?? 'NETWORK_ERROR', response?.error?.message ?? 'The extension did not respond.');
  return response.data;
}

export function abortError(): DOMException { return new DOMException('Cancelled', 'AbortError'); }
export function isAborted(error: unknown): boolean { return error instanceof DOMException && error.name === 'AbortError'; }
export function errorDetails(error: unknown): ApiError {
  return { code: error instanceof ContentError ? error.code : 'NETWORK_ERROR', message: error instanceof Error ? error.message : 'Translation failed.' };
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const TRANSIENT = new Set(['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_TIMEOUT', 'HTTP_502', 'HTTP_503', 'HTTP_504']);

/** A job lives on the backend. Each extension message is short, including after a worker restart. */
export async function translateJob(
  input: Omit<CreateJob, 'idempotencyKey'>,
  signal: AbortSignal,
): Promise<Segment[]> {
  const payload: CreateJob = { ...input, idempotencyKey: crypto.randomUUID() };
  let id: string | undefined;
  const cancel = () => { if (id) void request({ type: 'translation:cancel', payload: { id } }).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    let job: Job | undefined;
    let failures = 0;
    const deadline = Date.now() + 20 * 60_000;
    while (!job) {
      if (signal.aborted) throw abortError();
      if (Date.now() > deadline) throw new ContentError('UPSTREAM_TIMEOUT', 'Translation took too long. Please retry.');
      try {
        job = await request<Job>({ type: 'translation:submit', payload });
        id = job.id;
        if (signal.aborted) { cancel(); throw abortError(); }
      } catch (error) {
        if (isAborted(error)) throw error;
        const { code } = errorDetails(error);
        if (code === 'CONCURRENCY_LIMIT') await wait(2_000 + Math.random() * 600, signal);
        else if (TRANSIENT.has(code) && failures++ < 4) await wait(Math.min(1_000 * 2 ** failures, 10_000), signal);
        else throw error;
      }
    }
    failures = 0;
    while (job.status === 'queued' || job.status === 'running') {
      await wait(1_400, signal);
      if (Date.now() > deadline) throw new ContentError('UPSTREAM_TIMEOUT', 'Translation took too long. Please retry.');
      try {
        job = await request<Job>({ type: 'translation:get', payload: { id: job.id } });
        failures = 0;
      } catch (error) {
        const { code } = errorDetails(error);
        if (TRANSIENT.has(code) && failures++ < 4) await wait(Math.min(1_000 * 2 ** failures, 10_000), signal);
        else throw error;
      }
    }
    if (signal.aborted) throw abortError();
    if (job.status !== 'completed') throw new ContentError(job.error?.code ?? 'TRANSLATION_FAILED', job.error?.message ?? 'Translation could not be completed.');
    const translations = job.translations;
    const requested = new Set(input.segments.map(({ id: segmentId }) => segmentId));
    if (!translations || translations.length !== requested.size || new Set(translations.map(({ id: segmentId }) => segmentId)).size !== requested.size || translations.some((segment) => !requested.has(segment.id) || typeof segment.text !== 'string' || !segment.text.trim())) {
      throw new ContentError('INVALID_TRANSLATION', 'The server returned an incomplete translation.');
    }
    return translations;
  } catch (error) {
    // Release reservations when polling is abandoned, including an expired browser session.
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

import { config } from './config';
import { getIdToken } from './auth';
import { ExtensionError } from './shared/protocol';
import type { Account, ImageIntent, ImageJob, RuntimeRequest, Settings } from './shared/protocol';

const MAX_BYTES = 10 * 1024 * 1024;
const DAY = 86_400_000;
type Intents = Record<string, ImageIntent>;
type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
const fail = (code: string, message: string): never => { throw new ExtensionError({ code, message }); };
let transaction: Promise<unknown> = Promise.resolve();
function updateIntents<T>(fn: (intents: Intents) => T): Promise<T> {
  const next = transaction.then(async () => {
    const intents = (await chrome.storage.session.get('imageIntents')).imageIntents as Intents || {};
    for (const [id, value] of Object.entries(intents)) if (Date.now() - value.createdAt > DAY) delete intents[id];
    const result = fn(intents);
    await chrome.storage.session.set({ imageIntents: intents });
    return result;
  });
  transaction = next.catch(() => undefined);
  return next;
}
async function intent(id: string): Promise<ImageIntent> {
  return updateIntents(values => values[id] || fail('IMAGE_EXPIRED', 'This image request has expired. Right-click the image again.'));
}
async function limitedBlob(response: Response, maximum: number): Promise<Blob> {
  if (!response.ok) fail('IMAGE_UNAVAILABLE', 'The image could not be downloaded. Try a public image on another page.');
  if (Number(response.headers.get('Content-Length')) > maximum) fail('IMAGE_TOO_LARGE', 'The image is too large.');
  const reader = response.body?.getReader();
  if (!reader) throw new ExtensionError({ code: 'IMAGE_UNAVAILABLE', message: 'The image is unavailable.' });
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) { await reader.cancel(); fail('IMAGE_TOO_LARGE', 'The image is too large.'); }
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
  return new Blob(chunks, { type: response.headers.get('Content-Type')?.split(';')[0] || 'application/octet-stream' });
}
async function dataUrl(blob: Blob): Promise<{ dataUrl: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return { dataUrl: `data:${blob.type};base64,${btoa(binary)}` };
}
export function createImageController(api: Api, settings: () => Promise<Settings>) {
  const originals = new Map<string, Promise<Blob>>();
  const submitting = new Map<string, Promise<ImageJob>>();
  let generation = 0;
  let signingOut = false;
  async function requireImageAccess() {
    const account = await api<Account>('/me');
    if (!account.features?.imageTranslation) fail('FEATURE_DISABLED', 'Image translation is not available for this account.');
  }
  async function original(id: string): Promise<Blob> {
    await requireImageAccess();
    const current = await intent(id);
    if (!originals.has(id)) {
      if (originals.size >= 2) originals.delete(originals.keys().next().value!);
      const pending = (async () => {
        const url = new URL(current.srcUrl);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('UNSUPPORTED_IMAGE', 'Use a static PNG, JPEG or WebP image on an HTTP(S) page.');
        let response: Response;
        try { response = await fetch(url.href, { credentials: 'omit', signal: AbortSignal.timeout(20_000) }); }
        catch { return fail('IMAGE_UNAVAILABLE', 'The image could not be downloaded. Try a public image on another page.'); }
        if (!/^https?:/.test(response.url || url.href)) fail('UNSUPPORTED_IMAGE', 'This image URL is not supported.');
        const blob = await limitedBlob(response, MAX_BYTES);
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) fail('UNSUPPORTED_IMAGE', 'Only static PNG, JPEG and WebP images are supported.');
        try {
          const bitmap = await createImageBitmap(blob);
          const pixels = bitmap.width * bitmap.height;
          bitmap.close();
          if (pixels > 20_000_000) fail('IMAGE_TOO_LARGE', 'Use an image with at most 20 megapixels.');
        } catch (error) {
          if (error instanceof ExtensionError) throw error;
          fail('INVALID_IMAGE', 'The image file is invalid.');
        }
        return blob;
      })();
      originals.set(id, pending);
      pending.catch(() => { if (originals.get(id) === pending) originals.delete(id); });
    }
    return originals.get(id)!;
  }
  async function authorized(path: string, init: RequestInit = {}, refresh = false): Promise<Response> {
    const token = await getIdToken(refresh);
    let response: Response;
    try {
      response = await fetch(`${config.apiBase}/v1${path}`, { ...init, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(22_000) });
    } catch { return fail('NETWORK_ERROR', 'Unable to reach the server. Check your connection and retry.'); }
    if (response.status === 401 && !refresh) return authorized(path, init, true);
    if (!response.ok) {
      const value = await response.json().catch(() => null);
      throw new ExtensionError(value?.error || { code: `HTTP_${response.status}`, message: 'The image request could not be completed.' });
    }
    return response;
  }
  async function submit(request: Extract<RuntimeRequest, { type: 'image:submit' }>): Promise<ImageJob> {
    const startedGeneration = generation;
    const requireCurrentSession = () => { if (signingOut || startedGeneration !== generation) fail('IMAGE_CANCELLED', 'Image translation was cancelled by sign-out.'); };
    requireCurrentSession();
    const { intentId, sourceLanguage, targetLanguage, restart } = request.payload;
    for (const language of [sourceLanguage, targetLanguage]) if (typeof language !== 'string' || !language.trim() || language.length > 80) fail('INVALID_REQUEST', 'Choose a valid language.');
    if (targetLanguage === 'auto') fail('INVALID_REQUEST', 'Choose a target language.');
    await requireImageAccess();
    let current = await intent(intentId);
    const changed = current.sourceLanguage !== sourceLanguage || current.targetLanguage !== targetLanguage;
    if (current.jobId) {
      const prior = await api<ImageJob>(`/image-translation-jobs/${encodeURIComponent(current.jobId)}`);
      if (!restart && !changed) return prior;
      if (prior.status === 'queued' || prior.status === 'running') fail('CONCURRENCY_LIMIT', 'Wait for the current image or cancel it first.');
    }
    // A lost POST response leaves a pending key but no jobId. Reuse that key on
    // retry, even when the UI still displays the previous terminal job.
    if ((restart && current.jobId) || changed) {
      current = { ...current, sourceLanguage, targetLanguage, idempotencyKey: crypto.randomUUID(), jobId: undefined };
      await updateIntents(values => { values[intentId] = current; });
    }
    const blob = await original(intentId);
    requireCurrentSession();
    const form = new FormData();
    form.set('file', blob, `image.${blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png'}`);
    form.set('sourceLanguage', sourceLanguage); form.set('targetLanguage', targetLanguage);
    form.set('idempotencyKey', current.idempotencyKey);
    const response = await authorized('/image-translation-jobs', { method: 'POST', body: form });
    const job = await response.json() as ImageJob;
    if (signingOut || startedGeneration !== generation) {
      await api<ImageJob>(`/image-translation-jobs/${encodeURIComponent(job.id)}`, 'DELETE').catch(() => undefined);
      return fail('IMAGE_CANCELLED', 'Image translation was cancelled by sign-out.');
    }
    await updateIntents(values => { if (values[intentId]) values[intentId].jobId = job.id; });
    return job;
  }
  return {
    login() { signingOut = false; },
    async open(srcUrl: string) {
      const prefs = await settings();
      const id = crypto.randomUUID();
      // Never persist inline image bytes, file URLs or embedded credentials,
      // including for an unsupported image selected through Chrome's menu.
      let safeUrl = 'unsupported:';
      try { const parsed = new URL(srcUrl); if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) safeUrl = parsed.href; } catch { /* The image tab shows an unsupported-source error. */ }
      await updateIntents(values => {
        // Bound session metadata without storing images or credentials in Chrome storage.
        const entries = Object.values(values).sort((a, b) => a.createdAt - b.createdAt);
        for (const value of entries.slice(0, Math.max(0, entries.length - 49))) delete values[value.id];
        values[id] = { id, srcUrl: safeUrl, sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage, idempotencyKey: crypto.randomUUID(), createdAt: Date.now() };
      });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`image.html?intent=${id}`) });
    },
    async logout() {
      signingOut = true; generation++;
      // An upload may not have its backend ID yet. Drain it while the old
      // Firebase identity is still available, then cancel all known jobs.
      await Promise.allSettled([...submitting.values()]);
      const ids = await updateIntents(values => [...new Set(Object.values(values).map(value => value.jobId).filter((id): id is string => Boolean(id)))]);
      await Promise.allSettled(ids.map(id => api<ImageJob>(`/image-translation-jobs/${encodeURIComponent(id)}`, 'DELETE')));
      await updateIntents(values => { for (const id of Object.keys(values)) delete values[id]; });
      originals.clear();
    },
    async handle(request: RuntimeRequest): Promise<unknown> {
      if (signingOut) fail('AUTH_REQUIRED', 'Sign in with Google to translate.');
      switch (request.type) {
        case 'image:intent': return intent(request.payload.intentId);
        case 'image:prepare': return dataUrl(await original(request.payload.intentId));
        case 'image:submit': {
          const id = request.payload.intentId;
          if (submitting.has(id)) return submitting.get(id);
          const promise = submit(request);
          submitting.set(id, promise);
          try { return await promise; } finally { if (submitting.get(id) === promise) submitting.delete(id); }
        }
        case 'image:get': return api<ImageJob>(`/image-translation-jobs/${encodeURIComponent(request.payload.id)}`);
        case 'image:cancel': return api<ImageJob>(`/image-translation-jobs/${encodeURIComponent(request.payload.id)}`, 'DELETE');
        case 'image:asset': {
          if (!['original', 'translated'].includes(request.payload.variant)) fail('INVALID_REQUEST', 'Invalid image variant.');
          const response = await authorized(`/image-translation-jobs/${encodeURIComponent(request.payload.id)}/image?variant=${request.payload.variant}`);
          return dataUrl(await limitedBlob(response, 40 * 1024 * 1024));
        }
        default: return fail('INVALID_REQUEST', 'Unknown image request.');
      }
    },
  };
}

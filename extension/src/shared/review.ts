import type { Job } from './protocol';

export const REVIEW_THRESHOLD = 5;
export const REVIEW_DELAY_MS = 14 * 24 * 60 * 60 * 1000;
interface ReviewState {
  successes: number;
  completedJobIds: string[];
  state: 'counting' | 'later' | 'done';
  dismissals: number;
  laterUntil?: number;
}
interface Storage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Device-local, environment-scoped counters. Never retain translation text. */
export function createReviewStore(storage: Storage, environment: string, now = Date.now) {
  const key = `translationReviewV1:${environment}`;
  let transaction: Promise<unknown> = Promise.resolve();
  async function read(): Promise<ReviewState> {
    const saved = (await storage.get(key))[key] as Partial<ReviewState> | undefined;
    const completedJobIds = Array.isArray(saved?.completedJobIds)
      ? [...new Set(saved.completedJobIds.filter(id => typeof id === 'string'))].slice(0, REVIEW_THRESHOLD) : [];
    return {
      successes: completedJobIds.length, completedJobIds,
      state: saved?.state === 'done' || saved?.state === 'later' ? saved.state : 'counting',
      dismissals: Math.min(2, Math.max(0, Number.isSafeInteger(saved?.dismissals) ? saved!.dismissals! : 0)),
      ...(typeof saved?.laterUntil === 'number' && Number.isFinite(saved.laterUntil) ? { laterUntil: saved.laterUntil } : {}),
    };
  }
  function update<T>(mutate: (review: ReviewState) => T | Promise<T>): Promise<T> {
    const result = transaction.then(async () => {
      const review = await read(); const value = await mutate(review);
      await storage.set({ [key]: review }); return value;
    });
    transaction = result.catch(() => undefined);
    return result;
  }
  const eligible = (review: ReviewState) => review.successes >= REVIEW_THRESHOLD && review.state !== 'done'
    && review.dismissals < 2 && (review.state !== 'later' || now() >= (review.laterUntil || 0));
  return {
    async status(): Promise<{ eligible: boolean }> {
      await transaction; return { eligible: eligible(await read()) };
    },
    async recordSuccess(job: Job): Promise<void> {
      if (job.status !== 'completed' || !job.id || !job.translations?.length
        || job.translations.some(part => typeof part.text !== 'string' || !part.text.trim())) return;
      await update(review => {
        if (review.state === 'done' || review.successes >= REVIEW_THRESHOLD || review.completedJobIds.includes(job.id)) return;
        review.completedJobIds.push(job.id); review.successes = review.completedJobIds.length;
      });
    },
    dismiss(): Promise<void> {
      return update(review => {
        if (review.state === 'done') return;
        review.dismissals++;
        if (review.dismissals >= 2) review.state = 'done';
        else { review.state = 'later'; review.laterUntil = now() + REVIEW_DELAY_MS; }
      });
    },
    done(): Promise<void> { return update(review => { review.state = 'done'; }); },
  };
}

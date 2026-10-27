export type Theme = 'system' | 'light' | 'dark';
export type UiLanguage = 'uk' | 'en';
export type Tone = 'neutral' | 'formal' | 'friendly' | 'technical';
export type TranslationMode = 'text' | 'selection' | 'page';
export interface Settings {
  sourceLanguage: string;
  targetLanguage: string;
  selectionMode: 'icon' | 'instant' | 'disabled';
  uiLanguage: UiLanguage;
  theme: Theme;
  tone: Tone;
  usePageContext: boolean;
}
export const DEFAULT_SETTINGS: Settings = {
  sourceLanguage: 'auto', targetLanguage: 'Ukrainian', selectionMode: 'icon',
  uiLanguage: 'uk', theme: 'system', tone: 'neutral', usePageContext: false,
};
export interface ApiError { code: string; message: string }
export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };
export interface User { uid: string; name: string | null; email: string | null; picture: string | null }
export interface AuthState { user: User | null; configured: boolean }
export interface Quota {
  monthlyWords: number; usedWords: number; reservedWords: number;
  remainingWords: number; resetsAt: string;
}
export interface ImageQuota {
  monthlyImages: number; usedImages: number; reservedImages: number;
  remainingImages: number; resetsAt: string;
}
export interface PrepaidBalance {
  words: number; images: number; reservedWords: number; reservedImages: number;
}
export type BillingEnvironment = 'live' | 'test';
export interface BillingAvailability {
  environment: BillingEnvironment;
  canPurchase: boolean;
  canViewPurchases: boolean;
  reason: 'ready' | 'disabled' | 'unavailable' | 'environment-mismatch';
}
export interface CharacterQuota {
  monthlyCharacters: number; usedCharacters: number; reservedCharacters: number;
  remainingCharacters: number; periodStart: string; resetsAt: string;
}
export interface Account {
  user: User; characterQuota: CharacterQuota; plan: 'free' | 'pro';
  features: { pageTranslation: boolean; pageContext: boolean; tones: Tone[]; historyLimit: number; priority: boolean; imageTranslation: false };
  billing?: { environment: BillingEnvironment; purchasesEnabled: boolean };
  billingAvailability?: BillingAvailability;
  subscription?: { status: string; paidThrough?: number | null; cancelAtPeriodEnd?: boolean };
  limits: { maxSegments: number; maxCharactersPerJob: number; maxConcurrentJobs: number };
}
export interface HistoryEntry {
  id: string; createdAt: number; sourceLanguage: string; targetLanguage: string;
  source: string; translation: string; tone: Tone; mode: TranslationMode;
}
export interface HistoryPage { entries: HistoryEntry[]; total: number; recording: boolean; limit: number }
export interface Segment { id: string; text: string }
export interface CreateJob {
  sourceLanguage: string; targetLanguage: string; segments: Segment[]; idempotencyKey: string;
  mode?: TranslationMode; tone?: Tone; context?: string;
}
export interface Job {
  id: string; status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  translations?: Segment[]; error?: ApiError; quota?: Quota; characterQuota?: CharacterQuota;
  prepaid?: PrepaidBalance;
}
export interface ImageJob {
  id: string; kind: 'image'; status: Job['status']; error?: ApiError; imageQuota?: ImageQuota;
  output?: { mimeType: string; width: number; height: number; bytes: number };
  prepaid?: PrepaidBalance;
}
export interface ImageIntent {
  id: string; srcUrl: string; sourceLanguage: string; targetLanguage: string;
  idempotencyKey: string; jobId?: string; createdAt: number;
}
export type PageStatus = 'idle' | 'translating' | 'translated' | 'paused' | 'error';
export interface PageFrameState {
  sessionId: string; status: PageStatus; total: number; completed: number; failed: number; message?: string;
}
export interface PageState extends PageFrameState { tabId?: number; sourceLanguage?: string; targetLanguage?: string }
export interface PageCommand {
  type: 'page:command';
  payload: { action: 'start' | 'stop' | 'restore' | 'status'; sessionId: string; sourceLanguage: string; targetLanguage: string; maxCharactersPerJob?: number; maxSegments?: number; tone?: Tone; usePageContext?: boolean };
}
export type RuntimeRequest =
  | { type: 'settings:get' }
  | { type: 'settings:set'; payload: Partial<Settings> }
  | { type: 'auth:get' | 'auth:login' | 'auth:logout' | 'account:get' }
  | { type: 'history:list' | 'history:clear' }
  | { type: 'history:delete'; payload: { id: string } }
  | { type: 'history:recording'; payload: { enabled: boolean } }
  | { type: 'context:get' }
  | { type: 'billing:open'; payload: { page: 'pay' | 'account' } }
  | { type: 'translation:submit'; payload: CreateJob; ownerUid?: string }
  | { type: 'translation:get' | 'translation:cancel'; payload: { id: string } }
  | { type: 'translation:displayed'; payload: { id: string; elapsedMs: number } }
  | { type: 'image:intent' | 'image:prepare'; payload: { intentId: string } }
  | { type: 'image:submit'; payload: { intentId: string; sourceLanguage: string; targetLanguage: string; restart?: boolean } }
  | { type: 'image:get' | 'image:cancel'; payload: { id: string } }
  | { type: 'image:asset'; payload: { id: string; variant: 'original' | 'translated' } }
  | { type: 'page:start'; payload?: { tabId?: number; sourceLanguage?: string; targetLanguage?: string } }
  | { type: 'page:stop' | 'page:restore' | 'page:status'; payload?: { tabId?: number } }
  | { type: 'page:report'; payload: PageFrameState }
  | { type: 'selection:translate'; payload: { text: string } };
export class ExtensionError extends Error {
  code: string;
  constructor(error: ApiError) { super(error.message); this.name = 'ExtensionError'; this.code = error.code; }
}
export async function send<T>(request: RuntimeRequest): Promise<T> {
  const result = await chrome.runtime.sendMessage(request) as Result<T>;
  if (!result?.ok) throw new ExtensionError(result?.error || { code: 'NO_RESPONSE', message: 'The extension did not respond.' });
  return result.data;
}

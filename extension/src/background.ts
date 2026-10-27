import { config } from './config';
import { getAuthState, getIdToken, login, logout } from './auth';
import { deleteHistory, listHistory, saveHistory, setHistoryRecording } from './shared/history';
import { DEFAULT_SETTINGS, ExtensionError } from './shared/protocol';
import { billingAvailability, billingBuild, billingPage, fetchCentralBillingConfig } from './shared/billing';
import type { Account, ApiError, CreateJob, Job, PageCommand, PageFrameState, PageState, Result, RuntimeRequest, Settings, Tone } from './shared/protocol';

interface StoredPage {
  sessionId: string; topDocumentId: string; sourceLanguage: string; targetLanguage: string;
  maxCharactersPerJob: number; maxSegments: number; tone: Tone; usePageContext: boolean;
  status: PageFrameState['status']; frames: Record<string, PageFrameState>; frameDocuments: Record<string, string>;
}
interface JobOwner { tabId?: number; documentId?: string; createdAt: number; completedSeenAt?: number; historySaved?: boolean; uid?: string; request?: CreateJob }
interface Session { pages: Record<string, StoredPage>; jobs: Record<string, JobOwner> }
const emptySession = (): Session => ({ pages: {}, jobs: {} });
let transaction: Promise<unknown> = Promise.resolve();
function withSession<T>(fn: (session: Session) => T | Promise<T>): Promise<T> {
  const next = transaction.then(async () => {
    const state = (await chrome.storage.session.get('runtime')).runtime as Session | undefined;
    const session = state || emptySession();
    const result = await fn(session);
    await chrome.storage.session.set({ runtime: session });
    return result;
  });
  transaction = next.catch(() => undefined);
  return next;
}
async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await chrome.storage.local.get('settings')).settings as Partial<Settings> | undefined) };
}
function errorInfo(error: unknown): ApiError {
  if (error instanceof ExtensionError) return { code: error.code, message: error.message };
  const message = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return { code: 'EXTENSION_ERROR', message };
}
async function api<T>(path: string, method = 'GET', body?: unknown, refresh = false): Promise<T> {
  if (!config.apiBase) throw new ExtensionError({ code: 'NOT_CONFIGURED', message: 'The API address is missing from this build.' });
  const token = await getIdToken(refresh);
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/v2${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(22_000),
    });
  } catch (error) {
    throw new ExtensionError({ code: 'NETWORK_ERROR', message: error instanceof DOMException && error.name === 'TimeoutError' ? 'The server took too long. Please retry.' : 'Unable to reach the server. Check your connection.' });
  }
  if (response.status === 401 && !refresh) return api<T>(path, method, body, true);
  const value = await response.json().catch(() => null);
  if (response.status === 404 || response.status === 410 || response.status === 426) throw new ExtensionError({ code: 'UPDATE_REQUIRED', message: 'Update AI Translator and try again. The subscription service is not available in this server version.' });
  if (!response.ok) throw new ExtensionError(value?.error || { code: `HTTP_${response.status}`, message: 'The request could not be completed.' });
  return value as T;
}
async function accountWithBilling(): Promise<Account> {
  // This public request deliberately has no Firebase token or cookies.
  const [account, publicConfig] = await Promise.all([
    translationAccount(), fetchCentralBillingConfig(billingBuild.billingBase),
  ]);
  return { ...account, billingAvailability: billingAvailability(account, publicConfig) };
}
async function openBilling(page: 'pay' | 'account', sender: chrome.runtime.MessageSender) {
  const source = sender.url && new URL(sender.url);
  if (!source || source.protocol !== 'chrome-extension:' || source.host !== chrome.runtime.id
      || !['/popup.html', '/options.html', '/image.html'].includes(source.pathname)
      || !['pay', 'account'].includes(page)) throw new ExtensionError({ code: 'INVALID_REQUEST', message: 'Open billing from AI Translator.' });
  // Always recheck at click time: the page's earlier account state can be stale.
  const account = await accountWithBilling();
  const availability = account.billingAvailability!;
  if (!(page === 'pay' ? availability.canPurchase : availability.canViewPurchases)) {
    throw new ExtensionError({ code: availability.reason === 'environment-mismatch' ? 'BILLING_ENVIRONMENT_MISMATCH' : 'BILLING_UNAVAILABLE',
      message: 'Purchases are temporarily unavailable. Refresh your account and try again.' });
  }
  await chrome.tabs.create({ url: billingPage(page) });
  return { opened: true };
}
async function translationAccount(): Promise<Account> {
  const account = await api<Account>('/me');
  if (!account.characterQuota || !account.features || !Number.isSafeInteger(account.limits?.maxCharactersPerJob)) {
    throw new ExtensionError({ code: 'UPDATE_REQUIRED', message: 'Update AI Translator and refresh your account to use subscriptions.' });
  }
  return account;
}
function requireUi(sender: chrome.runtime.MessageSender): void {
  const source = sender.url && new URL(sender.url);
  if (!source || source.protocol !== 'chrome-extension:' || source.host !== chrome.runtime.id || !['/popup.html', '/options.html'].includes(source.pathname)) {
    throw new ExtensionError({ code: 'INVALID_REQUEST', message: 'Open this action from AI Translator.' });
  }
}
async function historyScope(): Promise<string> {
  const state = await getAuthState();
  if (!state.user) throw new ExtensionError({ code: 'AUTH_REQUIRED', message: 'Sign in to view your local history.' });
  return JSON.stringify([billingBuild.environment, state.user.uid]);
}
async function rememberJob(job: Job): Promise<void> {
  if (job.status !== 'completed' || !job.translations) return;
  const owner = await withSession(session => session.jobs[job.id]);
  const state = await getAuthState();
  if (!owner?.request || owner.historySaved || !owner.uid || state.user?.uid !== owner.uid) return;
  const payload = owner.request;
  // Local storage failure never changes a successful translation into an error.
  try {
    await saveHistory(JSON.stringify([billingBuild.environment, owner.uid]), {
      id: job.id, createdAt: owner.createdAt, sourceLanguage: payload.sourceLanguage, targetLanguage: payload.targetLanguage,
      source: payload.segments.map(segment => segment.text).join('\n'),
      translation: payload.segments.map(segment => job.translations!.find(result => result.id === segment.id)?.text || '').join('\n'),
      tone: payload.tone || 'neutral', mode: payload.mode || 'text',
    });
    await withSession(session => { if (session.jobs[job.id]) { session.jobs[job.id].historySaved = true; delete session.jobs[job.id].request; } });
  } catch { /* Translation remains usable when browser storage is full or unavailable. */ }
}
async function surroundingContext(tabId: number): Promise<string> {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'context:get' }, { frameId: 0 }) as Result<string>;
    return result?.ok && typeof result.data === 'string' ? Array.from(result.data).slice(0, 2000).join('') : '';
  } catch { return ''; }
}
function cleanLanguage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new ExtensionError({ code: 'INVALID_REQUEST', message: 'Choose a valid language.' });
  return value.trim();
}
async function saveSettings(partial: Partial<Settings>): Promise<Settings> {
  const value = await settings();
  if (partial.sourceLanguage !== undefined) value.sourceLanguage = cleanLanguage(partial.sourceLanguage);
  if (partial.targetLanguage !== undefined) value.targetLanguage = cleanLanguage(partial.targetLanguage);
  if (partial.selectionMode && ['icon', 'instant', 'disabled'].includes(partial.selectionMode)) value.selectionMode = partial.selectionMode;
  if (partial.uiLanguage && ['uk', 'en'].includes(partial.uiLanguage)) value.uiLanguage = partial.uiLanguage;
  if (partial.theme && ['system', 'light', 'dark'].includes(partial.theme)) value.theme = partial.theme;
  if (partial.tone && ['neutral', 'formal', 'friendly', 'technical'].includes(partial.tone)) value.tone = partial.tone;
  if (typeof partial.usePageContext === 'boolean') value.usePageContext = partial.usePageContext;
  await chrome.storage.local.set({ settings: value });
  await createMenus();
  return value;
}
async function activeTabId(requested?: number): Promise<number> {
  if (requested !== undefined) return requested;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new ExtensionError({ code: 'NO_TAB', message: 'Open a webpage to translate.' });
  return tab.id;
}
function aggregate(tabId: number, page?: StoredPage): PageState {
  if (!page) return { tabId, sessionId: '', status: 'idle', total: 0, completed: 0, failed: 0 };
  const frames = Object.values(page.frames);
  const sum = (key: 'total' | 'completed' | 'failed') => frames.reduce((value, frame) => value + frame[key], 0);
  const status = page.status === 'paused' ? 'paused' : frames.some((frame) => frame.status === 'translating') ? 'translating' : frames.some((frame) => frame.status === 'error') ? 'error' : frames.length && frames.every((frame) => frame.status === 'translated' || frame.status === 'idle') ? 'translated' : page.status;
  return { tabId, sessionId: page.sessionId, sourceLanguage: page.sourceLanguage, targetLanguage: page.targetLanguage, status, total: sum('total'), completed: sum('completed'), failed: sum('failed'), message: frames.find((frame) => frame.message)?.message };
}
async function pageStatus(tabId: number) {
  return withSession((session) => aggregate(tabId, session.pages[tabId]));
}
async function command(tabId: number, documentId: string, page: StoredPage, action: PageCommand['payload']['action']) {
  const message: PageCommand = { type: 'page:command', payload: { action, sessionId: page.sessionId, sourceLanguage: page.sourceLanguage, targetLanguage: page.targetLanguage, maxCharactersPerJob: page.maxCharactersPerJob, maxSegments: page.maxSegments, tone: page.tone, usePageContext: page.usePageContext } };
  return chrome.tabs.sendMessage(tabId, message, { documentId });
}
async function cancelTabJobs(tabId: number, documentId?: string) {
  const ids = await withSession((session) => Object.entries(session.jobs).filter(([, owner]) => owner.tabId === tabId && (!documentId || owner.documentId === documentId)).map(([id]) => id));
  await Promise.allSettled(ids.map((id) => api<Job>(`/translation-jobs/${encodeURIComponent(id)}`, 'DELETE')));
  await withSession((session) => { for (const id of ids) delete session.jobs[id]; });
}
async function startPage(tabId: number, sourceLanguage?: string, targetLanguage?: string): Promise<PageState> {
  const account = await translationAccount();
  if (!account.features.pageTranslation) throw new ExtensionError({ code: 'PRO_REQUIRED', message: 'Page translation is available with Pro.' });
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !/^https?:/.test(tab.url)) throw new ExtensionError({ code: 'UNSUPPORTED_PAGE', message: 'Open a regular website. Chrome pages and the Web Store cannot be translated.' });
  const prefs = await settings();
  const source = cleanLanguage(sourceLanguage || prefs.sourceLanguage);
  const target = cleanLanguage(targetLanguage || prefs.targetLanguage);
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  const top = frames?.find((frame) => frame.frameId === 0);
  if (!top?.documentId) throw new ExtensionError({ code: 'NO_DOCUMENT', message: 'This page is still loading. Please try again.' });
  const prior = await withSession((session) => session.pages[tabId]);
  if (prior) {
    const action = prior.sourceLanguage === source && prior.targetLanguage === target ? 'stop' : 'restore';
    await Promise.allSettled((frames || []).map((frame) => command(tabId, frame.documentId, prior, action)));
    await cancelTabJobs(tabId);
  }
  const page: StoredPage = { sessionId: crypto.randomUUID(), topDocumentId: top.documentId, sourceLanguage: source, targetLanguage: target, maxCharactersPerJob: account.limits.maxCharactersPerJob, maxSegments: account.limits.maxSegments, tone: account.features.tones.includes(prefs.tone) ? prefs.tone : 'neutral', usePageContext: account.features.pageContext && prefs.usePageContext, status: 'translating', frames: {}, frameDocuments: Object.fromEntries((frames || []).map((frame) => [String(frame.frameId), frame.documentId])) };
  await withSession((session) => { session.pages[tabId] = page; });
  let results = await Promise.allSettled((frames || []).filter((frame) => /^https?:/.test(frame.url)).map((frame) => command(tabId, frame.documentId, page, 'start')));
  if (!results.length || results.every((result) => result.status === 'rejected')) {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
    results = await Promise.allSettled((frames || []).filter((frame) => /^https?:/.test(frame.url)).map((frame) => command(tabId, frame.documentId, page, 'start')));
  }
  if (results.every((result) => result.status === 'rejected')) {
    await withSession((session) => { delete session.pages[tabId]; });
    throw new ExtensionError({ code: 'UNSUPPORTED_PAGE', message: 'This page does not allow translation.' });
  }
  return pageStatus(tabId);
}
async function changePage(tabId: number, action: 'stop' | 'restore'): Promise<PageState> {
  const page = await withSession((session) => {
    const current = session.pages[tabId];
    if (current) current.status = 'paused';
    return current;
  });
  if (!page) return pageStatus(tabId);
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  await Promise.allSettled((frames || []).map((frame) => command(tabId, frame.documentId, page, action)));
  await cancelTabJobs(tabId);
  if (action === 'restore') await withSession((session) => { delete session.pages[tabId]; });
  return pageStatus(tabId);
}
async function report(sender: chrome.runtime.MessageSender, data: PageFrameState) {
  const tabId = sender.tab?.id, documentId = sender.documentId;
  if (tabId === undefined || !documentId) return null;
  const result = await withSession((session) => {
    const page = session.pages[tabId];
    if (!page || page.sessionId !== data.sessionId || page.frameDocuments[String(sender.frameId)] !== documentId) return null;
    page.frames[documentId] = { ...data, total: Math.max(0, Number(data.total) || 0), completed: Math.max(0, Number(data.completed) || 0), failed: Math.max(0, Number(data.failed) || 0) };
    return { state: aggregate(tabId, page), topDocumentId: page.topDocumentId };
  });
  if (result) void chrome.tabs.sendMessage(tabId, { type: 'page:aggregate', payload: result.state }, { documentId: result.topDocumentId }).catch(() => undefined);
  return result?.state || null;
}
async function ownJob(id: string, sender: chrome.runtime.MessageSender) {
  if (!sender.tab) return;
  const owner = await withSession((session) => session.jobs[id]);
  if (!owner || owner.tabId !== sender.tab.id || owner.documentId !== sender.documentId) throw new ExtensionError({ code: 'JOB_NOT_FOUND', message: 'This translation is no longer available.' });
}
async function submitJob(payload: CreateJob, sender: chrome.runtime.MessageSender, ownerUid?: string) {
  if (ownerUid && (await getAuthState()).user?.uid !== ownerUid) throw new ExtensionError({ code: 'AUTH_REQUIRED', message: 'The signed-in account changed. Submit this translation again.' });
  cleanLanguage(payload.sourceLanguage); cleanLanguage(payload.targetLanguage);
  const account = await translationAccount(); const prefs = await settings();
  const count = Array.isArray(payload.segments) ? payload.segments.reduce((sum, segment) => sum + (typeof segment?.text === 'string' ? Array.from(segment.text).length : 0), 0) : 0;
  if (!Array.isArray(payload.segments) || !payload.segments.length || payload.segments.length > account.limits.maxSegments || payload.segments.some(segment => typeof segment.id !== 'string' || typeof segment.text !== 'string') || count > account.limits.maxCharactersPerJob) throw new ExtensionError({ code: 'TEXT_TOO_LONG', message: `Use up to ${account.limits.maxCharactersPerJob.toLocaleString()} characters per translation.` });
  const mode = payload.mode || (sender.tab ? 'selection' : 'text');
  if (mode === 'page' && !account.features.pageTranslation) throw new ExtensionError({ code: 'PRO_REQUIRED', message: 'Page translation is available with Pro.' });
  const tone = payload.tone || (account.features.tones.includes(prefs.tone) ? prefs.tone : 'neutral');
  if (!account.features.tones.includes(tone)) throw new ExtensionError({ code: 'PRO_REQUIRED', message: 'Translation tones are available with Pro.' });
  let context = payload.context || '';
  if (context && (!prefs.usePageContext || !account.features.pageContext)) throw new ExtensionError({ code: 'PRO_REQUIRED', message: 'Page context requires Pro and your permission.' });
  if (!context && prefs.usePageContext && account.features.pageContext && !sender.tab) {
    const tabId = await activeTabId().catch(() => undefined);
    if (tabId !== undefined) context = await surroundingContext(tabId);
  }
  if (Array.from(context).length > 2000) throw new ExtensionError({ code: 'INVALID_REQUEST', message: 'Page context is limited to 2,000 characters.' });
  const request: CreateJob = { ...payload, mode, tone, context };
  const state = await getAuthState();
  if (ownerUid && state.user?.uid !== ownerUid) throw new ExtensionError({ code: 'AUTH_REQUIRED', message: 'The signed-in account changed. Submit this translation again.' });
  const job = await api<Job>('/translation-jobs', 'POST', request);
  await withSession(session => {
    const previous = session.jobs[job.id];
    session.jobs[job.id] = { ...previous, tabId: sender.tab?.id, documentId: sender.documentId, uid: state.user?.uid, ...(previous?.historySaved ? {} : { request }), createdAt: previous?.createdAt || Date.now(), ...(job.status === 'completed' ? { completedSeenAt: Date.now() } : {}) };
    for (const [id, owner] of Object.entries(session.jobs)) if (Date.now() - owner.createdAt > 3_600_000) delete session.jobs[id];
  });
  await rememberJob(job);
  return job;
}
async function handle(request: RuntimeRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (request.type) {
    case 'settings:get': return settings();
    case 'settings:set': return saveSettings(request.payload);
    case 'auth:get': return getAuthState();
    case 'auth:login': return login();
    case 'auth:logout': {
      const ids = await withSession((session) => Object.keys(session.pages).map(Number));
      await Promise.allSettled(ids.map((tabId) => changePage(tabId, 'restore')));
      await withSession((session) => { session.jobs = {}; });
      return logout();
    }
    case 'account:get': return accountWithBilling();
    case 'history:list': { requireUi(sender); const account = await translationAccount(); return listHistory(await historyScope(), account.plan === 'pro' ? 1000 : 20); }
    case 'history:delete': requireUi(sender); await deleteHistory(await historyScope(), request.payload.id); return { ok: true };
    case 'history:clear': requireUi(sender); await deleteHistory(await historyScope()); return { ok: true };
    case 'history:recording': requireUi(sender); await setHistoryRecording(await historyScope(), request.payload.enabled === true); return { ok: true };
    case 'billing:open': return openBilling(request.payload?.page, sender);
    case 'translation:submit': return submitJob(request.payload, sender, request.ownerUid);
    case 'translation:get':
    case 'translation:cancel': {
      await ownJob(request.payload.id, sender);
      const job = await api<Job>(`/translation-jobs/${encodeURIComponent(request.payload.id)}`, request.type === 'translation:cancel' ? 'DELETE' : 'GET');
      await rememberJob(job);
      if (job.status === 'completed') await withSession(session => { const owner = session.jobs[job.id]; if (owner && !owner.completedSeenAt) owner.completedSeenAt = Date.now(); });
      return job;
    }
    case 'translation:displayed': {
      await ownJob(request.payload.id, sender);
      const owner = await withSession(session => session.jobs[request.payload.id]);
      if (owner && Number.isFinite(request.payload.elapsedMs) && request.payload.elapsedMs >= 0) console.info('translation_timing', { totalMs: Math.round(request.payload.elapsedMs), readyToDisplayMs: owner.completedSeenAt ? Math.max(0, Date.now() - owner.completedSeenAt) : null });
      return null;
    }
    case 'image:intent': case 'image:prepare': case 'image:submit': case 'image:get': case 'image:cancel': case 'image:asset':
      throw new ExtensionError({ code: 'FEATURE_UNAVAILABLE', message: 'Image translation is no longer available.' });
    case 'page:start': return startPage(await activeTabId(sender.tab?.id ?? request.payload?.tabId), request.payload?.sourceLanguage, request.payload?.targetLanguage);
    case 'page:stop': return changePage(await activeTabId(sender.tab?.id ?? request.payload?.tabId), 'stop');
    case 'page:restore': return changePage(await activeTabId(sender.tab?.id ?? request.payload?.tabId), 'restore');
    case 'page:status': return pageStatus(await activeTabId(sender.tab?.id ?? request.payload?.tabId));
    case 'page:report': return report(sender, request.payload);
    default: throw new ExtensionError({ code: 'INVALID_REQUEST', message: 'Unknown extension request.' });
  }
}
chrome.runtime.onMessage.addListener((request: RuntimeRequest, sender, sendResponse: (result: Result<unknown>) => void) => {
  if (sender.id !== chrome.runtime.id || !request?.type || request.type === 'selection:translate' || request.type === 'page:command' as string) return false;
  handle(request, sender).then((data) => sendResponse({ ok: true, data }), (error) => sendResponse({ ok: false, error: errorInfo(error) }));
  return true;
});
async function createMenus() {
  const language = (await settings()).uiLanguage;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'translate-selection', title: language === 'uk' ? 'Перекласти виділене — AI Translator' : 'Translate selection — AI Translator', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'translate-page', title: language === 'uk' ? 'Перекласти сторінку — AI Translator' : 'Translate page — AI Translator', contexts: ['page'] });
}
chrome.runtime.onInstalled.addListener(() => { void createMenus(); });
chrome.runtime.onStartup.addListener(() => { void createMenus(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'translate-page') void startPage(tab.id).catch(() => chrome.runtime.openOptionsPage());
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    const target = info.frameId === undefined ? undefined : { frameId: info.frameId };
    void chrome.tabs.sendMessage(tab.id, { type: 'selection:translate', payload: { text: info.selectionText } }, target).catch(() => chrome.runtime.openOptionsPage());
  }
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0) {
    void withSession((session) => { delete session.pages[details.tabId]; }).then(() => cancelTabJobs(details.tabId));
  } else {
    void withSession((session) => {
      const page = session.pages[details.tabId];
      if (!page) return undefined;
      const previous = page.frameDocuments[String(details.frameId)];
      if (previous) delete page.frames[previous];
      page.frameDocuments[String(details.frameId)] = details.documentId;
      return previous;
    }).then((previous) => { if (previous) return cancelTabJobs(details.tabId, previous); });
  }
});
chrome.webNavigation.onDOMContentLoaded.addListener((details) => {
  if (details.frameId === 0) return;
  void withSession((session) => session.pages[details.tabId]).then((page) => {
    if (page && page.status !== 'paused') return command(details.tabId, details.documentId, page, 'start');
  }).catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void withSession((session) => { delete session.pages[tabId]; }).then(() => cancelTabJobs(tabId));
});
const endSpaSession = (details: { tabId: number; frameId: number }) => {
  if (details.frameId === 0) void changePage(details.tabId, 'restore').catch(() => undefined);
};
chrome.webNavigation.onHistoryStateUpdated.addListener(endSpaSession);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(endSpaSession);

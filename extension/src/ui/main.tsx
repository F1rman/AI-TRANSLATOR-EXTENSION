import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Copy, FileText, Globe2, Languages, LoaderCircle, LogOut, Monitor, Moon, MousePointer2, Pause, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';
import { DEFAULT_SETTINGS, send } from '../shared/protocol';
import type { Account, AuthState, CreateJob, Job, PageState, Settings, Tone } from '../shared/protocol';
import { pollTranslationJob } from '../shared/polling';
import { messages } from './i18n';
import { languageName } from './languages';
import { LanguageField } from './LanguageField';
import { Brand, PlanSummary, SupportLinks, quotaResetLabel } from './shared';
import { useRefreshOnReturn } from './refresh';
import { History } from './History';
import { billingBuild } from '../shared/billing';
import { readTextSession, removePendingText, savePendingText, saveTextDraft } from '../shared/drafts';
import { extensionVersion } from '../shared/version';
import './style.css';

const preview = !globalThis.chrome?.runtime?.id;
const isOptions = location.pathname.includes('options');
const initialPage: PageState = { sessionId: '', status: 'idle', total: 0, completed: 0, failed: 0 };
function App() {
  const [prefs, setPrefs] = useState<Settings>({ ...DEFAULT_SETTINGS, ...(preview ? { uiLanguage: 'en' as const } : {}) });
  const [auth, setAuth] = useState<AuthState>({ user: null, configured: true });
  const [account, setAccount] = useState<Account | null>(null);
  const [mode, setMode] = useState<'text' | 'page' | 'history'>('text');
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false); const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState(''); const [copied, setCopied] = useState(false); const [saved, setSaved] = useState(false);
  const [page, setPage] = useState<PageState>(initialPage);
  const jobId = useRef<string | null>(null); const mounted = useRef(true);
  const textRun = useRef(0);
  const textAbort = useRef<AbortController | null>(null);
  const draftReady = useRef(false);
  const currentUid = useRef<string | null>(null);
  const accountGeneration = useRef(0);
  const t = messages[prefs.uiLanguage];
  const maxCharacters = account?.limits.maxCharactersPerJob || 4000;
  const tone = account?.features.tones.includes(prefs.tone) ? prefs.tone : 'neutral';
  const readableError = (reason: unknown) => reason instanceof Error && 'code' in reason && reason.code === 'UPDATE_REQUIRED' ? 'UPDATE_REQUIRED' : reason instanceof Error ? reason.message : String(reason);
  async function refreshAccount() {
    if (preview) return;
    const generation = ++accountGeneration.current;
    const state = await send<AuthState>({ type: 'auth:get' });
    if (generation !== accountGeneration.current) return;
    if (currentUid.current !== (state.user?.uid || null)) {
      currentUid.current = state.user?.uid || null; draftReady.current = false;
      textRun.current++; textAbort.current?.abort(); jobId.current = null;
      setInput(''); setOutput(''); setBusy(false); setAccount(null);
    }
    setAuth(state);
    if (state.user) {
      const next = await send<Account>({ type: 'account:get' });
      if (generation === accountGeneration.current && currentUid.current === state.user.uid && next.user.uid === state.user.uid) setAccount(next);
    } else setAccount(null);
  }
  useRefreshOnReturn(refreshAccount, !preview);
  useEffect(() => {
    mounted.current = true;
    if (!preview) {
      void send<Settings>({ type: 'settings:get' }).then(setPrefs).catch((err) => setError(readableError(err)));
      void refreshAccount().catch((err) => setError(readableError(err)));
      void send<PageState>({ type: 'page:status' }).then(setPage).catch(() => undefined);
      if (!isOptions) void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) return;
        try {
          const selections = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.getSelection()?.toString() || '' });
          const text = selections.find((selection) => selection.result?.trim())?.result;
          if (text && !jobId.current) setInput(Array.from(text).slice(0, 50000).join(''));
        } catch { /* Chrome internal pages cannot be queried. */ }
      });
    }
    return () => { mounted.current = false; textAbort.current?.abort(); };
  }, []);
  useEffect(() => {
    draftReady.current = false;
    const uid = auth.user?.uid;
    if (preview || isOptions || !uid) return;
    let active = true;
    void readTextSession(billingBuild.environment, uid).then(({ draft, pending }) => {
      if (!active || currentUid.current !== uid) return;
      setInput(draft?.input || pending?.segments[0]?.text || ''); setOutput(draft?.output || '');
      draftReady.current = true;
      if (pending) void translateRequest(pending, uid);
    }).catch(reason => { if (active) setError(readableError(reason)); });
    return () => { active = false; };
  }, [auth.user?.uid]);
  useEffect(() => {
    const uid = auth.user?.uid;
    if (preview || isOptions || !uid || !draftReady.current) return;
    const timer = setTimeout(() => { if (currentUid.current === uid) void saveTextDraft(billingBuild.environment, uid, { input, output }); }, 200);
    return () => clearTimeout(timer);
  }, [input, output, auth.user?.uid]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = prefs.theme === 'system' ? media.matches ? 'dark' : 'light' : prefs.theme; document.documentElement.lang = prefs.uiLanguage; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [prefs.theme, prefs.uiLanguage]);
  useEffect(() => {
    if (preview || mode !== 'page') return;
    const timer = setInterval(() => { void send<PageState>({ type: 'page:status' }).then(setPage).catch(() => undefined); }, 1200);
    return () => clearInterval(timer);
  }, [mode]);
  async function updateSettings(change: Partial<Settings>) {
    const before = prefs; setPrefs({ ...prefs, ...change }); setError('');
    try {
      if (!preview) setPrefs(await send<Settings>({ type: 'settings:set', payload: change }));
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (err) { setPrefs(before); setError(readableError(err)); }
  }
  async function signIn() {
    setAuthBusy(true); setError('');
    try { if (preview) return; await send<AuthState>({ type: 'auth:login' }); await refreshAccount(); }
    catch (err) { setError(readableError(err)); }
    finally { setAuthBusy(false); }
  }
  async function translateRequest(payload: CreateJob, ownerUid = currentUid.current) {
    if (!ownerUid || currentUid.current !== ownerUid) return;
    const run = ++textRun.current;
    textAbort.current?.abort();
    const abort = new AbortController(); textAbort.current = abort;
    const started = Date.now();
    jobId.current = 'pending';
    setBusy(true); setError(''); setOutput('');
    try {
      await savePendingText(billingBuild.environment, ownerUid, payload);
      if (currentUid.current !== ownerUid || run !== textRun.current) return;
      let job = await send<Job>({ type: 'translation:submit', payload, ownerUid });
      if (run !== textRun.current) { void send({ type: 'translation:cancel', payload: { id: job.id } }).catch(() => undefined); return; }
      const applyBalance = (next: Job) => {
        if (mounted.current && run === textRun.current) setAccount(previous => previous ? {
          ...previous, characterQuota: next.characterQuota || previous.characterQuota,
        } : previous);
        return next;
      };
      applyBalance(job);
      jobId.current = job.id;
      job = await pollTranslationJob(job, async (id) => applyBalance(await send<Job>({ type: 'translation:get', payload: { id } })), { segments: payload.segments, signal: abort.signal, deadline: Date.now() + 180_000 });
      if (job.status !== 'completed') throw new Error(job.error?.message || t.error);
      if (run !== textRun.current) return;
      setOutput(job.translations?.find((segment) => segment.id === 'text')?.text || '');
      void send({ type: 'translation:displayed', payload: { id: job.id, elapsedMs: Date.now() - started } }).catch(() => undefined);
      await removePendingText(billingBuild.environment, ownerUid);
      await refreshAccount();
    } catch (err) {
      if (mounted.current && run === textRun.current) {
        setError(err instanceof Error && 'code' in err && err.code === 'QUOTA_EXCEEDED' ? t.quotaEmpty : readableError(err));
        // The idempotency key remains available for reopening after transient failures.
        if (err instanceof Error && 'code' in err && ['QUOTA_EXCEEDED', 'INVALID_REQUEST', 'AUTH_REQUIRED', 'UNAUTHENTICATED', 'NOT_CONFIGURED', 'UPDATE_REQUIRED', 'PRO_REQUIRED', 'TEXT_TOO_LONG'].includes(String(err.code))) await removePendingText(billingBuild.environment, ownerUid);
      }
    }
    finally { if (mounted.current && run === textRun.current) { setBusy(false); jobId.current = null; } }
  }
  function clearText() {
    textRun.current++;
    textAbort.current?.abort();
    const id = jobId.current;
    if (!preview) {
      if (currentUid.current) void removePendingText(billingBuild.environment, currentUid.current);
      if (id && id !== 'pending') void send({ type: 'translation:cancel', payload: { id } }).catch(() => undefined);
    }
    jobId.current = null; setBusy(false); setInput(''); setOutput(''); setError('');
  }
  async function translate() {
    if (!input.trim()) return;
    if (Array.from(input).length > maxCharacters) { setError(`${maxCharacters.toLocaleString(prefs.uiLanguage)} ${prefs.uiLanguage === 'uk' ? 'символів за один переклад' : 'characters per translation'}`); return; }
    if (preview) { setError(prefs.uiLanguage === 'uk' ? 'Переклад доступний у встановленому розширенні Chrome.' : 'Translation is available in the installed Chrome extension.'); return; }
    if (!auth.user) { await signIn(); return; }
    await translateRequest({ mode: 'text', tone, sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage, segments: [{ id: 'text', text: input }], idempotencyKey: crypto.randomUUID() });
  }
  async function pageAction(action: 'start' | 'stop' | 'restore') {
    setError('');
    if (preview) { setPage({ ...initialPage, status: action === 'start' ? 'translated' : 'idle', total: 24, completed: 24 }); return; }
    try {
      const request = action === 'start' ? { type: 'page:start' as const, payload: { sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage } } : { type: action === 'stop' ? 'page:stop' as const : 'page:restore' as const };
      setPage(await send<PageState>(request));
    }
    catch (err) { setError(readableError(err)); }
  }
  const quotaPercent = account ? Math.min(100, ((account.characterQuota.usedCharacters + account.characterQuota.reservedCharacters) / Math.max(1, account.characterQuota.monthlyCharacters)) * 100) : 0;
  const languagesRow = <div className="language-row"><LanguageField label={t.from} value={prefs.sourceLanguage} automatic settings={prefs} onChange={(sourceLanguage) => void updateSettings({ sourceLanguage })}/><button className="swap icon-button" aria-label={t.swapLanguages} disabled={prefs.sourceLanguage === 'auto'} onClick={() => void updateSettings({ sourceLanguage: prefs.targetLanguage, targetLanguage: prefs.sourceLanguage })}><ArrowDownUp size={19}/></button><LanguageField label={t.to} value={prefs.targetLanguage} settings={prefs} onChange={(targetLanguage) => void updateSettings({ targetLanguage })}/></div>;
  const loginCard = <div className="login-card"><div className="login-spark"><Sparkles size={18}/></div><div><strong>{t.welcome}</strong><p>{t.loginHint}</p></div><button className="google-button" onClick={() => void signIn()} disabled={authBusy || !auth.configured}><span className="google-g">G</span>{authBusy ? <LoaderCircle size={16} className="spin"/> : t.signIn}<ArrowRight size={14}/></button>{!auth.configured && <p className="setup-note">{t.setup}</p>}</div>;
  const quotaBar = <div className="quota-block"><div><span>{t.quota}</span><strong>{account ? `${account.characterQuota.usedCharacters.toLocaleString(prefs.uiLanguage)} / ${account.characterQuota.monthlyCharacters.toLocaleString(prefs.uiLanguage)}` : '—'}</strong></div><div className="quota-track"><span style={{ width: `${quotaPercent}%` }}/></div>{account && <small className="quota-reserved">{t.remaining}: {account.characterQuota.remainingCharacters.toLocaleString(prefs.uiLanguage)} · {t.reservedMonthly}: {account.characterQuota.reservedCharacters.toLocaleString(prefs.uiLanguage)}</small>}{account && <small className="quota-reset">{quotaResetLabel(account.characterQuota.resetsAt, prefs.uiLanguage)}</small>}</div>;
  const errorBox = error && <div className="error-box" role="alert">{error === 'UPDATE_REQUIRED' ? t.updateRequired : error}<button aria-label={t.close} onClick={() => setError('')}><X size={14}/></button></div>;
  const translationOptions = <details className="translation-options" open={isOptions || undefined}><summary>{t.translationOptions}</summary><label><span>{t.tone}</span><select value={tone} onChange={event => void updateSettings({ tone: event.target.value as Tone })}>{(['neutral', 'formal', 'friendly', 'technical'] as const).map(value => <option key={value} value={value} disabled={value !== 'neutral' && !account?.features.tones.includes(value)}>{t[value]}{value !== 'neutral' && !account?.features.tones.includes(value) ? ' · Pro' : ''}</option>)}</select></label><label className="setting-toggle"><input type="checkbox" checked={!!account?.features.pageContext && prefs.usePageContext} disabled={!account?.features.pageContext} onChange={event => void updateSettings({ usePageContext: event.target.checked })}/><span>{t.pageContext}{!account?.features.pageContext ? ' · Pro' : ''}</span></label><small>{t.pageContextHint}</small></details>;
  const themeButtons = <div className="theme-options">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([theme, Icon]) => <button key={theme} className={prefs.theme === theme ? 'active' : ''} aria-pressed={prefs.theme === theme} onClick={() => void updateSettings({ theme })}><Icon size={20}/><span>{t[theme]}</span>{prefs.theme === theme && <Check size={13}/>}</button>)}</div>;
  if (isOptions) return <div className="options-shell"><aside className="sidebar"><Brand/><div className="sidebar-caption">WORKSPACE</div><a href="#preferences" className="nav-active"><Settings2 size={18}/>{t.preferencesNav}</a><a href="#appearance"><Sun size={18}/>{t.appearanceNav}</a><a href="#account"><Globe2 size={18}/>{t.account}</a><div className="sidebar-bottom"><span className="little-spark">✦</span> MADE FOR A CONNECTED WORLD<span>AI Translator · v{extensionVersion}</span></div></aside><main className="options-main"><header className="options-heading"><div><span className="eyebrow">A LITTLE MORE UNDERSTANDING</span><h1>{t.prefs}</h1><p>{t.prefsHint}</p></div><span className={`saved-indicator ${saved ? 'visible' : ''}`}><Check size={14}/>{t.saved}</span></header>{errorBox}<section id="preferences" className="settings-card"><div className="section-title"><span className="section-icon"><Languages size={20}/></span><div><h2>{t.languageTitle}</h2><p>{t.languageHint}</p></div></div>{languagesRow}{translationOptions}</section><section className="settings-card"><div className="section-title"><span className="section-icon"><MousePointer2 size={20}/></span><div><h2>{t.selectTitle}</h2><p>{t.selectHint}</p></div></div><div className="selection-options">{(['icon', 'instant', 'disabled'] as const).map((selectionMode) => <button key={selectionMode} className={prefs.selectionMode === selectionMode ? 'active' : ''} aria-pressed={prefs.selectionMode === selectionMode} onClick={() => void updateSettings({ selectionMode })}><span className="radio-dot">{prefs.selectionMode === selectionMode && <span/>}</span><span><strong>{t[selectionMode]}</strong><small>{t[`${selectionMode}Hint`]}</small></span></button>)}</div></section><section id="appearance" className="settings-card"><div className="section-title"><span className="section-icon"><Sun size={20}/></span><div><h2>{t.appearance}</h2><p>{t.appearanceHint}</p></div></div>{themeButtons}<div className="interface-row"><span>{t.interface}</span><div className="segmented small"><button className={prefs.uiLanguage === 'uk' ? 'active' : ''} onClick={() => void updateSettings({ uiLanguage: 'uk' })}>Українська</button><button className={prefs.uiLanguage === 'en' ? 'active' : ''} onClick={() => void updateSettings({ uiLanguage: 'en' })}>English</button></div></div></section><section id="account" className="settings-card"><div className="section-title"><span className="section-icon"><ShieldCheck size={20}/></span><div><h2>{t.account}</h2><p>{t.accountHint}</p></div></div>{auth.user ? <><div className="account-row"><div className="avatar">{auth.user.name?.[0] || 'L'}</div><div><strong>{auth.user.name}</strong><small>{auth.user.email}</small></div><button className="quiet-button" onClick={() => void send<AuthState>({ type: 'auth:logout' }).then((state) => { accountGeneration.current++; currentUid.current = null; draftReady.current = false; textRun.current++; textAbort.current?.abort(); setInput(''); setOutput(''); setAuth(state); setAccount(null); }).catch((err: Error) => setError(readableError(err)))}><LogOut size={14}/>{t.signOut}</button></div>{quotaBar}<PlanSummary account={account} locale={prefs.uiLanguage} onRefresh={refreshAccount}/>{account && <History key={auth.user.uid} locale={prefs.uiLanguage} refreshKey={`${auth.user.uid}:${account.plan}`}/>}</> : loginCard}</section><SupportLinks locale={prefs.uiLanguage}/><footer className="options-footer"><ShieldCheck size={14}/>{t.privacy}</footer></main></div>;
  return <main className="popup"><header className="popup-header"><Brand small/><div className="header-actions"><button className="locale-button" aria-label={t.interface} onClick={() => void updateSettings({ uiLanguage: prefs.uiLanguage === 'uk' ? 'en' : 'uk' })}>{prefs.uiLanguage === 'uk' ? 'UA' : 'EN'}<ChevronDown size={13}/></button><button className="icon-button" aria-label={t.settings} onClick={() => preview ? window.open('/options.html') : chrome.runtime.openOptionsPage()}><Settings2 size={18}/></button>{auth.user && <span className="avatar tiny" title={auth.user.email || ''}>{auth.user.name?.[0] || 'L'}</span>}</div></header><div className="popup-intro"><span className="eyebrow"><span className="live-dot"/> AI, WITH A HUMAN TOUCH</span><h1>{t.heading.slice(0, -1)}<span className="heading-dot">.</span></h1><p>{t.intro}</p></div>{!auth.user && loginCard}<div className="segmented mode-switch"><button className={mode === 'text' ? 'active' : ''} aria-pressed={mode === 'text'} onClick={() => setMode('text')}><FileText size={15}/>{t.text}</button><button className={mode === 'page' ? 'active' : ''} aria-pressed={mode === 'page'} onClick={() => setMode('page')}><Globe2 size={15}/>{t.page}</button><button className={mode === 'history' ? 'active' : ''} aria-pressed={mode === 'history'} onClick={() => setMode('history')}>{t.history}</button></div>{mode !== 'history' && languagesRow}{mode === 'text' && translationOptions}{errorBox}{mode === 'text' ? <><div className="text-card"><textarea value={input} maxLength={maxCharacters * 2} placeholder={t.input} onChange={(event) => setInput(Array.from(event.target.value).slice(0, maxCharacters).join(''))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void translate(); }} aria-label={t.input}/><div className="text-card-bottom"><span>{Array.from(input).length.toLocaleString()} / {maxCharacters.toLocaleString(prefs.uiLanguage)}</span>{input && <button className="icon-button" aria-label={t.clear} onClick={clearText}><X size={14}/></button>}</div></div><button className="primary-button translate-button" aria-busy={busy} disabled={busy || !input.trim() || (!!account && account.characterQuota.remainingCharacters <= 0)} onClick={() => void translate()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>}<span>{busy ? t.translating : t.translate}</span><span className="shortcut">⌘ ↵</span></button><div className={`result-card ${output ? 'has-result' : ''}`} aria-live="polite" aria-busy={busy}>{output ? <><span className="result-caption">{languageName(prefs.targetLanguage, prefs.uiLanguage, t.auto)}</span><p dir="auto">{output}</p><button className="copy-button" onClick={() => void navigator.clipboard.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch((err: Error) => setError(readableError(err)))}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? t.copied : t.copy}</button></> : <><div className="result-symbol" aria-hidden="true">{busy ? <LoaderCircle size={24} className="spin"/> : <><Languages size={24}/><span>✦</span></>}</div><strong>{busy ? t.translating : t.output}</strong><p>{t.outputHint}</p></>}</div></> : mode === 'history' ? auth.user ? <History key={auth.user.uid} locale={prefs.uiLanguage} refreshKey={`${auth.user.uid}:${account?.plan || 'free'}`}/> : <p className="history-help">{t.loginHint}</p> : <div className="page-card"><div className="page-illustration"><div className="paper"><span/><span/><span/><b>文 <ArrowRight size={12}/> A</b></div><Sparkles size={22}/></div><h2>{t.pageTitle}</h2><p>{t.pageHint}</p>{page.status !== 'idle' && <div className="page-progress"><strong>{page.status === 'translated' ? t.pageDone : page.status === 'paused' ? t.pagePaused : t.translating}</strong><span>{page.completed} / {page.total} {t.progress}</span>{page.message && <small>{page.message}</small>}</div>}<button className="primary-button" onClick={() => void (account?.features.pageTranslation || page.status === 'translating' ? pageAction(page.status === 'translating' ? 'stop' : 'start') : send({ type: 'billing:open', payload: { page: 'pay' } }).catch(reason => setError(readableError(reason))))}>{page.status === 'translating' ? <Pause size={16}/> : <Globe2 size={16}/>} {page.status === 'translating' ? t.pause : account?.features.pageTranslation ? t.pageStart : t.upgrade}</button>{page.status !== 'idle' && <button className="quiet-button restore-button" onClick={() => void pageAction('restore')}><RotateCcw size={14}/>{t.restore}</button>}<small className="page-privacy"><ShieldCheck size={13}/>{t.pagePrivacy}</small></div>}{auth.user && <section className="account-usage" aria-label={t.account}>{quotaBar}<PlanSummary account={account} locale={prefs.uiLanguage} onRefresh={refreshAccount}/></section>}<SupportLinks locale={prefs.uiLanguage}/><footer className="popup-footer"><span className="footer-symbol">✦</span>{t.powered}<span>v{extensionVersion}</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

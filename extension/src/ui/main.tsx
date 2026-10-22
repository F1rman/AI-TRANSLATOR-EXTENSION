import React, { useEffect, useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Copy, FileText, Globe2, Languages, LoaderCircle, LogOut, Monitor, Moon, MousePointer2, Pause, RotateCcw, Settings2, ShieldCheck, Sparkles, Sun, X } from 'lucide-react';
import { DEFAULT_SETTINGS, send } from '../shared/protocol';
import type { Account, AuthState, CreateJob, Job, PageState, Settings } from '../shared/protocol';
import { messages } from './i18n';
import { languageName, languages } from './languages';
import './style.css';

const preview = !globalThis.chrome?.runtime?.id;
const isOptions = location.pathname.includes('options');
const initialPage: PageState = { sessionId: '', status: 'idle', total: 0, completed: 0, failed: 0 };
function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4c.9 7.4 4.6 11.1 12 12-7.4.9-11.1 4.6-12 12C15.1 20.6 11.4 16.9 4 16c7.4-.9 11.1-4.6 12-12Z" fill="currentColor"/><circle cx="25" cy="6" r="2" fill="currentColor"/></svg></span><span>AI Translator<span className="brand-sub">WORDS CONNECT WORLDS</span></span></div>;
}
function LanguageField({ label, value, automatic = false, settings, onChange }: { label: string; value: string; automatic?: boolean; settings: Settings; onChange: (value: string) => void }) {
  const id = useId(); const t = messages[settings.uiLanguage];
  const display = languageName(value, settings.uiLanguage, t.auto);
  const [draft, setDraft] = useState(display);
  useEffect(() => setDraft(display), [display]);
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) { setDraft(display); return; }
    const match = languages.find(([en, uk]) => en.toLowerCase() === trimmed.toLowerCase() || uk.toLowerCase() === trimmed.toLowerCase());
    onChange(automatic && [t.auto.toLowerCase(), 'auto'].includes(trimmed.toLowerCase()) ? 'auto' : match?.[0] || trimmed);
  };
  return <label className="language-field"><span>{label}</span><div><input list={id} value={draft} maxLength={80} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onFocus={(event) => event.currentTarget.select()} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label={label}/><ChevronDown size={14}/></div><datalist id={id}>{automatic && <option value={t.auto}/>} {languages.map(([en, uk]) => <option key={en} value={settings.uiLanguage === 'uk' ? uk : en}>{en}</option>)}</datalist></label>;
}
function App() {
  const [prefs, setPrefs] = useState<Settings>({ ...DEFAULT_SETTINGS, ...(preview ? { uiLanguage: 'en' as const } : {}) });
  const [auth, setAuth] = useState<AuthState>({ user: null, configured: true });
  const [account, setAccount] = useState<Account | null>(null);
  const [mode, setMode] = useState<'text' | 'page'>('text');
  const [input, setInput] = useState(''); const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false); const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState(''); const [copied, setCopied] = useState(false); const [saved, setSaved] = useState(false);
  const [page, setPage] = useState<PageState>(initialPage);
  const jobId = useRef<string | null>(null); const mounted = useRef(true);
  const textRun = useRef(0);
  const draftReady = useRef(false);
  const t = messages[prefs.uiLanguage];
  async function refreshAccount() {
    if (preview) return;
    const state = await send<AuthState>({ type: 'auth:get' });
    setAuth(state);
    if (state.user) setAccount(await send<Account>({ type: 'account:get' })); else setAccount(null);
  }
  useEffect(() => {
    mounted.current = true;
    if (!preview) {
      void send<Settings>({ type: 'settings:get' }).then(setPrefs).catch((err) => setError(err.message));
      void refreshAccount().catch((err) => setError(err.message));
      void send<PageState>({ type: 'page:status' }).then(setPage).catch(() => undefined);
      if (!isOptions) void chrome.storage.session.get(['textDraft', 'pendingText']).then((stored) => {
        const draft = stored.textDraft as { input?: string; output?: string } | undefined;
        const pending = stored.pendingText as CreateJob | undefined;
        setInput(draft?.input || pending?.segments[0]?.text || ''); setOutput(draft?.output || '');
        draftReady.current = true;
        if (pending) void translateRequest(pending);
      });
      if (!isOptions) void chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) return;
        try {
          const selections = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => window.getSelection()?.toString() || '' });
          const text = selections.find((selection) => selection.result?.trim())?.result;
          if (text && !jobId.current) setInput(Array.from(text).slice(0, 4000).join(''));
        } catch { /* Chrome internal pages cannot be queried. */ }
      });
    }
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (preview || isOptions || !draftReady.current) return;
    const timer = setTimeout(() => { void chrome.storage.session.set({ textDraft: { input, output } }); }, 200);
    return () => clearTimeout(timer);
  }, [input, output]);
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
    } catch (err) { setPrefs(before); setError((err as Error).message); }
  }
  async function signIn() {
    setAuthBusy(true); setError('');
    try { if (preview) return; setAuth(await send<AuthState>({ type: 'auth:login' })); await refreshAccount(); }
    catch (err) { setError((err as Error).message); }
    finally { setAuthBusy(false); }
  }
  async function translateRequest(payload: CreateJob) {
    const run = ++textRun.current;
    jobId.current = 'pending';
    setBusy(true); setError(''); setOutput('');
    try {
      await chrome.storage.session.set({ pendingText: payload, textDraft: { input: payload.segments[0].text, output: '' } });
      let job = await send<Job>({ type: 'translation:submit', payload });
      if (run !== textRun.current) { void send({ type: 'translation:cancel', payload: { id: job.id } }).catch(() => undefined); return; }
      jobId.current = job.id;
      const deadline = Date.now() + 180_000;
      while (job.status === 'queued' || job.status === 'running') {
        if (Date.now() > deadline) throw new Error(t.retryHint);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (!mounted.current || run !== textRun.current) return;
        job = await send<Job>({ type: 'translation:get', payload: { id: job.id } });
      }
      if (job.status !== 'completed') throw new Error(job.error?.message || t.error);
      if (run !== textRun.current) return;
      setOutput(job.translations?.find((segment) => segment.id === 'text')?.text || '');
      await chrome.storage.session.remove('pendingText');
      await refreshAccount();
    } catch (err) {
      if (mounted.current && run === textRun.current) {
        setError((err as Error).message);
        // The idempotency key remains available for reopening after transient failures.
        if (err instanceof Error && 'code' in err && ['QUOTA_EXCEEDED', 'INVALID_REQUEST', 'AUTH_REQUIRED', 'UNAUTHENTICATED', 'NOT_CONFIGURED'].includes(String(err.code))) await chrome.storage.session.remove('pendingText');
      }
    }
    finally { if (mounted.current && run === textRun.current) { setBusy(false); jobId.current = null; } }
  }
  function clearText() {
    textRun.current++;
    const id = jobId.current;
    if (!preview) {
      void chrome.storage.session.remove('pendingText');
      if (id && id !== 'pending') void send({ type: 'translation:cancel', payload: { id } }).catch(() => undefined);
    }
    jobId.current = null; setBusy(false); setInput(''); setOutput(''); setError('');
  }
  async function translate() {
    if (!input.trim()) return;
    if (Array.from(input).length > 4000) { setError(t.textLong); return; }
    if (preview) { setError(prefs.uiLanguage === 'uk' ? 'Переклад доступний у встановленому розширенні Chrome.' : 'Translation is available in the installed Chrome extension.'); return; }
    if (!auth.user) { await signIn(); return; }
    await translateRequest({ sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage, segments: [{ id: 'text', text: input.trim() }], idempotencyKey: crypto.randomUUID() });
  }
  async function pageAction(action: 'start' | 'stop' | 'restore') {
    setError('');
    if (preview) { setPage({ ...initialPage, status: action === 'start' ? 'translated' : 'idle', total: 24, completed: 24 }); return; }
    try {
      const request = action === 'start' ? { type: 'page:start' as const, payload: { sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage } } : { type: action === 'stop' ? 'page:stop' as const : 'page:restore' as const };
      setPage(await send<PageState>(request));
    }
    catch (err) { setError((err as Error).message); }
  }
  const quotaPercent = account ? Math.min(100, ((account.quota.usedCharacters + account.quota.reservedCharacters) / account.quota.dailyCharacters) * 100) : 0;
  const languagesRow = <div className="language-row"><LanguageField label={t.from} value={prefs.sourceLanguage} automatic settings={prefs} onChange={(sourceLanguage) => void updateSettings({ sourceLanguage })}/><button className="swap icon-button" aria-label="Swap languages" disabled={prefs.sourceLanguage === 'auto'} onClick={() => void updateSettings({ sourceLanguage: prefs.targetLanguage, targetLanguage: prefs.sourceLanguage })}><ArrowDownUp size={15}/></button><LanguageField label={t.to} value={prefs.targetLanguage} settings={prefs} onChange={(targetLanguage) => void updateSettings({ targetLanguage })}/></div>;
  const loginCard = <div className="login-card"><div className="login-spark"><Sparkles size={18}/></div><div><strong>{t.welcome}</strong><p>{t.loginHint}</p></div><button className="google-button" onClick={() => void signIn()} disabled={authBusy || !auth.configured}><span className="google-g">G</span>{authBusy ? <LoaderCircle size={16} className="spin"/> : t.signIn}<ArrowRight size={14}/></button>{!auth.configured && <p className="setup-note">{t.setup}</p>}</div>;
  const quotaBar = <div className="quota-block"><div><span>{t.quota}</span><strong>{account ? `${account.quota.usedCharacters.toLocaleString()} / ${account.quota.dailyCharacters.toLocaleString()}` : '0 / 20,000'}</strong></div><div className="quota-track"><span style={{ width: `${quotaPercent}%` }}/></div></div>;
  const errorBox = error && <div className="error-box" role="alert">{error}<button aria-label="Close" onClick={() => setError('')}><X size={14}/></button></div>;
  const themeButtons = <div className="theme-options">{([['light', Sun], ['dark', Moon], ['system', Monitor]] as const).map(([theme, Icon]) => <button key={theme} className={prefs.theme === theme ? 'active' : ''} onClick={() => void updateSettings({ theme })}><Icon size={20}/><span>{t[theme]}</span>{prefs.theme === theme && <Check size={13}/>}</button>)}</div>;
  if (isOptions) return <div className="options-shell"><aside className="sidebar"><Brand/><div className="sidebar-caption">WORKSPACE</div><a href="#preferences" className="nav-active"><Settings2 size={18}/>{t.preferencesNav}</a><a href="#appearance"><Sun size={18}/>{t.appearanceNav}</a><a href="#account"><Globe2 size={18}/>{t.account}</a><div className="sidebar-bottom"><span className="little-spark">✦</span> MADE FOR A CONNECTED WORLD<span>AI Translator · v1.0</span></div></aside><main className="options-main"><header className="options-heading"><div><span className="eyebrow">A LITTLE MORE UNDERSTANDING</span><h1>{t.prefs}</h1><p>{t.prefsHint}</p></div><span className={`saved-indicator ${saved ? 'visible' : ''}`}><Check size={14}/>{t.saved}</span></header>{errorBox}<section id="preferences" className="settings-card"><div className="section-title"><span className="section-icon"><Languages size={20}/></span><div><h2>{t.languageTitle}</h2><p>{t.languageHint}</p></div></div>{languagesRow}</section><section className="settings-card"><div className="section-title"><span className="section-icon"><MousePointer2 size={20}/></span><div><h2>{t.selectTitle}</h2><p>{t.selectHint}</p></div></div><div className="selection-options">{(['icon', 'instant', 'disabled'] as const).map((selectionMode) => <button key={selectionMode} className={prefs.selectionMode === selectionMode ? 'active' : ''} onClick={() => void updateSettings({ selectionMode })}><span className="radio-dot">{prefs.selectionMode === selectionMode && <span/>}</span><span><strong>{t[selectionMode]}</strong><small>{t[`${selectionMode}Hint`]}</small></span></button>)}</div></section><section id="appearance" className="settings-card"><div className="section-title"><span className="section-icon"><Sun size={20}/></span><div><h2>{t.appearance}</h2><p>{t.appearanceHint}</p></div></div>{themeButtons}<div className="interface-row"><span>{t.interface}</span><div className="segmented small"><button className={prefs.uiLanguage === 'uk' ? 'active' : ''} onClick={() => void updateSettings({ uiLanguage: 'uk' })}>Українська</button><button className={prefs.uiLanguage === 'en' ? 'active' : ''} onClick={() => void updateSettings({ uiLanguage: 'en' })}>English</button></div></div></section><section id="account" className="settings-card"><div className="section-title"><span className="section-icon"><ShieldCheck size={20}/></span><div><h2>{t.account}</h2><p>{t.accountHint}</p></div></div>{auth.user ? <><div className="account-row"><div className="avatar">{auth.user.name?.[0] || 'L'}</div><div><strong>{auth.user.name}</strong><small>{auth.user.email}</small></div><button className="quiet-button" onClick={() => void send<AuthState>({ type: 'auth:logout' }).then((state) => { setAuth(state); setAccount(null); }).catch((err: Error) => setError(err.message))}><LogOut size={14}/>{t.signOut}</button></div>{quotaBar}</> : loginCard}</section><nav className="support-links"><a href="https://ai-translator-ext.web.app/privacy" target="_blank" rel="noreferrer">Privacy</a><a href="https://ai-translator-ext.web.app/support" target="_blank" rel="noreferrer">Support</a></nav><footer className="options-footer"><ShieldCheck size={14}/>{t.privacy}</footer></main></div>;
  return <main className="popup"><header className="popup-header"><Brand small/><div className="header-actions"><button className="locale-button" onClick={() => void updateSettings({ uiLanguage: prefs.uiLanguage === 'uk' ? 'en' : 'uk' })}>{prefs.uiLanguage === 'uk' ? 'UA' : 'EN'}</button><button className="icon-button" aria-label={t.settings} onClick={() => preview ? window.open('/options.html') : chrome.runtime.openOptionsPage()}><Settings2 size={18}/></button>{auth.user && <span className="avatar tiny" title={auth.user.email || ''}>{auth.user.name?.[0] || 'L'}</span>}</div></header><div className="popup-intro"><span className="eyebrow"><span className="live-dot"/> AI, WITH A HUMAN TOUCH</span><h1>{t.heading}</h1><p>{t.intro}</p></div>{!auth.user && loginCard}<div className="segmented mode-switch"><button className={mode === 'text' ? 'active' : ''} onClick={() => setMode('text')}><FileText size={15}/>{t.text}</button><button className={mode === 'page' ? 'active' : ''} onClick={() => setMode('page')}><Globe2 size={15}/>{t.page}</button></div>{languagesRow}{errorBox}{mode === 'text' ? <><div className="text-card"><textarea value={input} maxLength={8000} placeholder={t.input} onChange={(event) => setInput(Array.from(event.target.value).slice(0, 4000).join(''))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void translate(); }} aria-label={t.input}/><div className="text-card-bottom"><span>{Array.from(input).length.toLocaleString()} / 4,000</span>{input && <button className="icon-button" aria-label={t.clear} onClick={clearText}><X size={14}/></button>}</div></div><button className="primary-button translate-button" disabled={busy || !input.trim() || account?.quota.remainingCharacters === 0} onClick={() => void translate()}>{busy ? <LoaderCircle size={17} className="spin"/> : <Sparkles size={17}/>}<span>{busy ? t.translating : t.translate}</span><span className="shortcut">⌘ ↵</span></button>{(auth.user || output || busy) && <div className={`result-card ${output ? 'has-result' : ''}`} aria-live="polite">{output ? <><span className="result-caption">{languageName(prefs.targetLanguage, prefs.uiLanguage, t.auto)}</span><p dir="auto">{output}</p><button className="copy-button" onClick={() => void navigator.clipboard.writeText(output).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch((err: Error) => setError(err.message))}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? t.copied : t.copy}</button></> : <><div className="result-symbol"><Languages size={24}/><span>✦</span></div><strong>{t.output}</strong><p>{t.outputHint}</p></>}</div>}</> : <div className="page-card"><div className="page-illustration"><div className="paper"><span/><span/><span/><b>文 <ArrowRight size={12}/> A</b></div><Sparkles size={22}/></div><h2>{t.pageTitle}</h2><p>{t.pageHint}</p>{page.status !== 'idle' && <div className="page-progress"><strong>{page.status === 'translated' ? t.pageDone : page.status === 'paused' ? t.pagePaused : t.translating}</strong><span>{page.completed} / {page.total} {t.progress}</span>{page.message && <small>{page.message}</small>}</div>}<button className="primary-button" onClick={() => void pageAction(page.status === 'translating' ? 'stop' : 'start')}>{page.status === 'translating' ? <Pause size={16}/> : <Globe2 size={16}/>} {page.status === 'translating' ? t.pause : t.pageStart}</button>{page.status !== 'idle' && <button className="quiet-button restore-button" onClick={() => void pageAction('restore')}><RotateCcw size={14}/>{t.restore}</button>}<small className="page-privacy"><ShieldCheck size={13}/>{t.pagePrivacy}</small></div>}{auth.user && quotaBar}<nav className="support-links"><a href="https://ai-translator-ext.web.app/privacy" target="_blank" rel="noreferrer">Privacy</a><a href="https://ai-translator-ext.web.app/support" target="_blank" rel="noreferrer">Support</a></nav><footer className="popup-footer"><span className="footer-symbol">✦</span>{t.powered}<span>v1.0</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDownUp, ArrowRight, Download, Image, LoaderCircle, LogOut, RotateCcw, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { DEFAULT_SETTINGS, send } from '../shared/protocol';
import type { Account, AuthState, ImageIntent, ImageJob, Settings } from '../shared/protocol';
import { LanguageField } from './LanguageField';
import { Brand, PlanSummary } from './shared';
import { messages } from './i18n';
import './style.css';

const activeJob = (job: ImageJob | null) => job?.status === 'queued' || job?.status === 'running';
function ImageApp() {
  const intentId = new URLSearchParams(location.search).get('intent') || '';
  const [prefs, setPrefs] = useState<Settings>(DEFAULT_SETTINGS);
  const [auth, setAuth] = useState<AuthState>({ user: null, configured: true });
  const [account, setAccount] = useState<Account | null>(null);
  const [intent, setIntent] = useState<ImageIntent | null>(null);
  const [job, setJob] = useState<ImageJob | null>(null);
  const [original, setOriginal] = useState(''); const [translated, setTranslated] = useState('');
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false); const [authBusy, setAuthBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false); const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(''); const [errorCode, setErrorCode] = useState('');
  const alive = useRef(false); const operation = useRef(0); const autoStarted = useRef(false); const cancelRequested = useRef(false);
  const currentJob = useRef<ImageJob | null>(null);
  const t = messages[prefs.uiLanguage];
  const pro = account?.plan === 'pro' && account.features.imageTranslation;
  const quotaEmpty = !!account && account.imageQuota.remainingImages <= 0;
  function fail(reason: unknown) {
    if (!alive.current) return;
    const code = reason instanceof Error && 'code' in reason ? String(reason.code) : '';
    setErrorCode(code); setError(reason instanceof Error ? reason.message : t.imageFailed);
    if (['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(code)) { setAuth((previous) => ({ ...previous, user: null })); setAccount(null); autoStarted.current = false; }
  }
  function readableError() {
    if (['PRO_REQUIRED', 'FEATURE_DISABLED'].includes(errorCode)) return t.imageProHint;
    if (['IMAGE_QUOTA_EXCEEDED', 'QUOTA_EXCEEDED'].includes(errorCode)) return t.imageQuotaEmpty;
    if (['INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'UNSUPPORTED_IMAGE', 'UNSUPPORTED_IMAGE_TYPE', 'IMAGE_DIMENSIONS_EXCEEDED', 'ANIMATED_IMAGE'].includes(errorCode)) return t.imageInvalid;
    if (['IMAGE_FETCH_FAILED', 'IMAGE_UNAVAILABLE', 'IMAGE_DOWNLOAD_FAILED'].includes(errorCode)) return t.imageUnavailable;
    if (['INTENT_NOT_FOUND', 'IMAGE_INTENT_NOT_FOUND'].includes(errorCode)) return t.imageIntentMissing;
    if (['JOB_EXPIRED', 'IMAGE_EXPIRED'].includes(errorCode)) return t.imageExpired;
    if (['AUTH_REQUIRED', 'UNAUTHENTICATED'].includes(errorCode)) return t.imageAuth;
    if (['NETWORK_ERROR', 'NO_RESPONSE'].includes(errorCode)) return t.retryHint;
    if (['IMAGE_JOB_ACTIVE', 'CONCURRENCY_LIMIT', 'TOO_MANY_JOBS'].includes(errorCode)) return t.imageBusy;
    return errorCode ? t.imageFailed : error;
  }
  async function refreshAccount() {
    const nextAuth = await send<AuthState>({ type: 'auth:get' });
    const nextAccount = nextAuth.user ? await send<Account>({ type: 'account:get' }) : null;
    if (alive.current) { setAuth(nextAuth); setAccount(nextAccount); }
  }
  useEffect(() => {
    alive.current = true; let cancelled = false;
    void (async () => {
      try {
        const settings = await send<Settings>({ type: 'settings:get' });
        if (cancelled) return;
        setPrefs(settings);
        await refreshAccount();
        if (!intentId) throw Object.assign(new Error('No image intent.'), { code: 'INTENT_NOT_FOUND' });
        const next = await send<ImageIntent>({ type: 'image:intent', payload: { intentId } });
        if (!cancelled) { setIntent(next); setPrefs((previous) => ({ ...previous, sourceLanguage: next.sourceLanguage, targetLanguage: next.targetLanguage })); }
      } catch (reason) { if (!cancelled) fail(reason); }
      finally { if (!cancelled) setReady(true); }
    })();
    return () => { cancelled = true; alive.current = false; operation.current++; };
  }, []);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.theme = prefs.theme === 'system' ? media.matches ? 'dark' : 'light' : prefs.theme; document.documentElement.lang = prefs.uiLanguage; };
    apply(); media.addEventListener('change', apply); return () => media.removeEventListener('change', apply);
  }, [prefs.theme, prefs.uiLanguage]);
  useEffect(() => {
    if (!ready || !pro || !intent || autoStarted.current || (quotaEmpty && !intent.jobId)) return;
    autoStarted.current = true;
    void (intent.jobId ? resume(intent.jobId) : translate(false));
  }, [ready, pro, intent, quotaEmpty]);
  function updateJob(next: ImageJob) { currentJob.current = next; setJob(next); setIntent((previous) => previous ? { ...previous, jobId: next.id } : previous); }
  async function watch(next: ImageJob, run: number) {
    updateJob(next);
    const began = Date.now();
    while (next.status === 'queued' || next.status === 'running') {
      if (Date.now() - began > 660_000) throw new Error(t.retryHint);
      await new Promise((resolve) => setTimeout(resolve, Date.now() - began < 10_000 ? 1200 : 2500));
      if (!alive.current || operation.current !== run) return;
      next = await send<ImageJob>({ type: 'image:get', payload: { id: next.id } });
      if (!alive.current || operation.current !== run) return;
      updateJob(next);
    }
    if (operation.current !== run) return;
    if (next.status === 'completed') {
      const asset = await send<{ dataUrl: string }>({ type: 'image:asset', payload: { id: next.id, variant: 'translated' } });
      if (alive.current && operation.current === run) setTranslated(asset.dataUrl);
    } else if (next.status === 'failed') throw Object.assign(new Error(next.error?.message || t.imageFailed), { code: next.error?.code });
    await refreshAccount();
  }
  async function resume(id: string) {
    const run = ++operation.current; setBusy(true); setError(''); setErrorCode('');
    try {
      const next = await send<ImageJob>({ type: 'image:get', payload: { id } });
      if (!alive.current || operation.current !== run) return;
      updateJob(next);
      if (next.status === 'cancelled' || next.status === 'failed') { await watch(next, run); return; }
      const asset = await send<{ dataUrl: string }>({ type: 'image:asset', payload: { id, variant: 'original' } });
      if (!alive.current || operation.current !== run) return;
      setOriginal(asset.dataUrl); await watch(next, run);
    } catch (reason) { fail(reason); }
    finally { if (alive.current && operation.current === run) setBusy(false); }
  }
  async function translate(restart: boolean) {
    if (!intent || !pro || busy || quotaEmpty) return;
    const run = ++operation.current; cancelRequested.current = false; setBusy(true); setPreparing(true); setError(''); setErrorCode(''); setTranslated('');
    try {
      if (!original) {
        const asset = await send<{ dataUrl: string }>({ type: 'image:prepare', payload: { intentId } });
        if (!alive.current || operation.current !== run) return;
        setOriginal(asset.dataUrl);
      }
      if (cancelRequested.current) { setPreparing(false); setCancelling(false); return; }
      setPreparing(false);
      const next = await send<ImageJob>({ type: 'image:submit', payload: { intentId, sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage, restart } });
      if (!alive.current || operation.current !== run) return;
      updateJob(next);
      if (cancelRequested.current) {
        updateJob(await send<ImageJob>({ type: 'image:cancel', payload: { id: next.id } }));
        await refreshAccount(); return;
      }
      await watch(next, run);
    } catch (reason) { fail(reason); }
    finally { if (alive.current && operation.current === run) { setBusy(false); setPreparing(false); setCancelling(false); } }
  }
  async function cancel() {
    cancelRequested.current = true; setCancelling(true);
    const next = currentJob.current;
    if (!next || !activeJob(next)) return;
    try {
      const cancelled = await send<ImageJob>({ type: 'image:cancel', payload: { id: next.id } });
      operation.current++; updateJob(cancelled); setBusy(false); setPreparing(false); setCancelling(false);
      if (cancelled.status === 'completed') { const asset = await send<{ dataUrl: string }>({ type: 'image:asset', payload: { id: cancelled.id, variant: 'translated' } }); if (alive.current) setTranslated(asset.dataUrl); }
      await refreshAccount();
    } catch (reason) { setCancelling(false); fail(reason); }
  }
  async function signIn() {
    setAuthBusy(true); setError('');
    try {
      const next = await send<AuthState>({ type: 'auth:login' }); setAuth(next); await refreshAccount();
      if (!intent && intentId) { const nextIntent = await send<ImageIntent>({ type: 'image:intent', payload: { intentId } }); setIntent(nextIntent); }
    } catch (reason) { fail(reason); }
    finally { setAuthBusy(false); }
  }
  async function updateLanguages(change: Partial<Settings>) {
    const before = prefs; setPrefs({ ...prefs, ...change });
    try { await send<Settings>({ type: 'settings:set', payload: change }); } catch (reason) { setPrefs(before); fail(reason); }
  }
  async function download() {
    try {
      const response = await fetch(translated); const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ai-translator-${job?.id || 'image'}.png`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { fail(reason); }
  }
  const pending = busy;
  const jobStatus = preparing ? t.imagePreparing : job?.status === 'queued' ? t.imageQueued : job?.status === 'running' ? t.imageWorking : job?.status === 'completed' ? t.imageReady : job?.status === 'cancelled' ? t.imageCancelled : '';
  return <main className="image-shell"><header className="image-header"><Brand/><div className="header-actions"><button className="locale-button" onClick={() => void updateLanguages({ uiLanguage: prefs.uiLanguage === 'uk' ? 'en' : 'uk' })}>{prefs.uiLanguage === 'uk' ? 'UA' : 'EN'}</button><button className="icon-button" aria-label={t.settings} onClick={() => chrome.runtime.openOptionsPage()}><Settings2 size={20}/></button></div></header><div className="image-heading"><span className="eyebrow">AI TRANSLATOR <span className="plan-badge is-pro">PRO</span></span><h1>{t.imageTitle}</h1><p>{t.imageHint}</p></div>{!ready ? <div className="image-gate"><LoaderCircle size={28} className="spin"/><p>{t.imagePreparing}</p></div> : !auth.user ? <section className="image-gate"><ShieldCheck size={30}/><h2>{t.signIn}</h2><p>{t.imageLoginHint}</p><button className="google-button" disabled={authBusy || !auth.configured} onClick={() => void signIn()}><span className="google-g">G</span>{authBusy ? <LoaderCircle size={16} className="spin"/> : t.signIn}<ArrowRight size={16}/></button>{!auth.configured && <p>{t.setup}</p>}</section> : <><div className="image-account"><span>{auth.user.email}</span><button className="quiet-button" disabled={pending} onClick={() => void send<AuthState>({ type: 'auth:logout' }).then((next) => { operation.current++; setAuth(next); setAccount(null); setOriginal(''); setTranslated(''); setBusy(false); setJob(null); currentJob.current = null; autoStarted.current = false; }).catch(fail)}><LogOut size={14}/>{t.signOut}</button></div><PlanSummary account={account} locale={prefs.uiLanguage}/>{!pro ? <section className="image-gate"><Image size={30}/><h2>{t.proOnly}</h2><p>{t.imageProHint}</p><button className="quiet-button" onClick={() => void refreshAccount().catch(fail)}><RotateCcw size={15}/>{t.imageRefresh}</button></section> : <><div className="image-controls"><div className="language-row"><LanguageField label={t.from} value={prefs.sourceLanguage} settings={prefs} automatic disabled={pending || activeJob(job)} onChange={(sourceLanguage) => void updateLanguages({ sourceLanguage })}/><button className="swap icon-button" disabled={pending || activeJob(job) || prefs.sourceLanguage === 'auto'} aria-label={t.swapLanguages} onClick={() => void updateLanguages({ sourceLanguage: prefs.targetLanguage, targetLanguage: prefs.sourceLanguage })}><ArrowDownUp size={17}/></button><LanguageField label={t.to} value={prefs.targetLanguage} settings={prefs} disabled={pending || activeJob(job)} onChange={(targetLanguage) => void updateLanguages({ targetLanguage })}/></div>{pending ? <button className="quiet-button image-cancel" disabled={cancelling} onClick={() => void cancel()}>{cancelling ? <LoaderCircle size={16} className="spin"/> : <X size={16}/>} {t.imageCancel}</button> : <button className="primary-button" disabled={(!activeJob(job) && quotaEmpty) || !intent} onClick={() => void (activeJob(job) && job ? resume(job.id) : translate(!!job))}><Sparkles size={17}/>{activeJob(job) ? t.imageRefresh : job ? t.imageAgain : t.translate}</button>}</div>{quotaEmpty && !pending && <p className="image-quota-note">{t.imageQuotaEmpty}</p>}{jobStatus && <div className="image-status" role="status" aria-live="polite">{pending ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={18}/>}<span>{jobStatus}</span></div>}<div className="image-comparison"><section className="image-panel"><header><h2>{t.imageOriginal}</h2></header>{original ? <img src={original} alt={t.imageOriginal}/> : <div className="image-placeholder"><Image size={40}/><p>{t.imageOriginal}</p></div>}</section><section className="image-panel"><header><h2>{t.imageResult}</h2>{translated && <button className="image-download" onClick={() => void download()}><Download size={15}/>{t.imageDownload}</button>}</header>{translated ? <img src={translated} alt={t.imageResult}/> : <div className="image-placeholder">{pending ? <LoaderCircle size={40} className="spin"/> : <Sparkles size={40}/>}<p>{pending ? t.translating : t.imageResult}</p></div>}</section></div>{translated && <p className="image-inspect">{t.imageInspect}</p>}</> }</>}{error && <div className="error-box image-error" role="alert">{readableError()}<button aria-label={t.close} onClick={() => { setError(''); setErrorCode(''); }}><X size={15}/></button>{job && !pending && <button className="error-retry" onClick={() => void resume(job.id)}>{t.imageRefresh}</button>}</div>}<footer className="image-footer"><ShieldCheck size={16}/><p>{t.imagePrivacy}</p><a href="https://ai-translator-ext.web.app/privacy" target="_blank" rel="noreferrer">Privacy</a><span>v1.1.0</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ImageApp/></React.StrictMode>);

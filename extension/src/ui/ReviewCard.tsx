import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { send } from '../shared/protocol';
import type { UiLanguage } from '../shared/protocol';

const fallback = {
  en: { reviewPrompt: 'Enjoying AI Translator? Rate it on the Chrome Web Store', reviewRate: '★ Rate', reviewDismiss: 'Dismiss review request' },
  uk: { reviewPrompt: 'Подобається AI Translator? Залиште відгук у Chrome Web Store', reviewRate: '★ Оцінити', reviewDismiss: 'Відхилити прохання про відгук' },
};

/** Appears at the bottom only on an idle, signed-in popup. No review gating. */
export function ReviewCard({ locale, idle, signedIn, refreshKey }: { locale: UiLanguage; idle: boolean; signedIn: boolean; refreshKey: string }) {
  const [eligible, setEligible] = useState(false);
  const [copy, setCopy] = useState(fallback[locale]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let active = true; setCopy(fallback[locale]);
    if (typeof globalThis.chrome?.runtime?.getURL === 'function') {
      void fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`)).then(response => {
        if (!response.ok) throw new Error('Local catalog unavailable');
        return response.json();
      }).then(catalog => {
        if (active) setCopy(Object.fromEntries(Object.entries(fallback[locale]).map(([key, value]) => [key, catalog[key]?.message || value])) as typeof copy);
      }).catch(() => undefined);
    }
    return () => { active = false; };
  }, [locale]);
  useEffect(() => {
    let active = true; setEligible(false);
    if (!signedIn || !idle || !globalThis.chrome?.runtime?.id) return;
    const check = () => {
      void send<{ eligible: boolean }>({ type: 'review:status' }).then(state => { if (active) setEligible(state.eligible); }).catch(() => undefined);
    };
    check(); window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('focus', check); };
  }, [idle, signedIn, refreshKey]);
  if (!idle || !signedIn || !eligible) return null;
  async function act(type: 'review:rate' | 'review:dismiss') {
    setPending(true);
    try { await send({ type }); setEligible(false); }
    catch { /* Optional review UI never interrupts translation. */ }
    finally { setPending(false); }
  }
  return <aside className="review-card" aria-label={copy.reviewPrompt}>
    <p>{copy.reviewPrompt}</p>
    <div><button className="quiet-button" disabled={pending} onClick={() => void act('review:rate')}>{copy.reviewRate}</button>
      <button className="icon-button" disabled={pending} aria-label={copy.reviewDismiss} onClick={() => void act('review:dismiss')}><X size={16}/></button></div>
  </aside>;
}

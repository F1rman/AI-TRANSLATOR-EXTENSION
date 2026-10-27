import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Account, UiLanguage } from '../shared/protocol';
import { billingBuild } from '../shared/billing';
import { send } from '../shared/protocol';
import { messages } from './i18n';
export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4c.9 7.4 4.6 11.1 12 12-7.4.9-11.1 4.6-12 12C15.1 20.6 11.4 16.9 4 16c7.4-.9 11.1-4.6 12-12Z" fill="currentColor"/><circle cx="25" cy="6" r="2" fill="currentColor"/></svg></span><span>AI Translator<span className="brand-sub">{billingBuild.environment === 'test' ? 'TEST · NO REAL PAYMENTS' : 'WORDS CONNECT WORLDS'}</span></span></div>;
}

export function PlanSummary({ account, locale, onRefresh }: { account: Account | null; locale: UiLanguage; onRefresh?: () => Promise<void> }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  if (!account) return null;
  const t = messages[locale]; const pro = account.plan === 'pro'; const availability = account.billingAvailability;
  async function open(page: 'pay' | 'account') {
    setOpening(true); setError('');
    try { await send({ type: 'billing:open', payload: { page } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t.billingUnavailable); }
    finally { setOpening(false); }
  }
  return <section className="plan-summary" aria-label={t.subscription}>
    <div className="plan-heading"><strong>AI Translator</strong><span className={`plan-badge ${pro ? 'is-pro' : ''}`}>{pro ? 'PRO' : t.freePlan}</span></div>
    <p className="subscription-copy">{pro ? t.proBenefits : t.freeBenefits}</p>
    {!pro && <p className="subscription-price">$4.99 {t.perMonth} · $39.99 {t.perYear}</p>}
    {billingBuild.environment === 'test' && <small>{t.testMode}</small>}
    <div className="billing-actions">
      {!pro && <button type="button" className="billing-buy" disabled={!availability?.canPurchase || opening} onClick={() => void open('pay')}>{t.upgrade}</button>}
      <button type="button" disabled={!availability?.canViewPurchases || opening} onClick={() => void open('account')}>{t.manageSubscription}</button>
      {onRefresh && <button type="button" onClick={() => void onRefresh().catch(reason => setError(String(reason.message || reason)))}><RotateCcw size={12}/>{t.refreshAccount}</button>}
    </div>
    {!availability?.canPurchase && !pro && <small role="status">{availability?.reason === 'environment-mismatch' ? t.billingMismatch : t.billingUnavailable}</small>}
    {error && <small role="alert">{error}</small>}
  </section>;
}

export function quotaResetLabel(resetsAt: string, locale: UiLanguage): string {
  const date = new Date(resetsAt);
  if (!Number.isFinite(date.getTime())) return messages[locale].monthlyReset;
  const formatted = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${messages[locale].quotaResets}: ${formatted} UTC`;
}

export function SupportLinks({ locale }: { locale: UiLanguage }) {
  const t = messages[locale];
  const portfolio = `https://ihorkharchyshyn.site${locale === 'uk' ? '/uk' : ''}/extensions/ai-translator`;
  return <nav className="support-links" aria-label={t.supportNavigation}><a href="https://ai-translator-ext.web.app/privacy" target="_blank" rel="noreferrer">{t.privacyLink}</a><a href="https://ai-translator-ext.web.app/support" target="_blank" rel="noreferrer">{t.supportLink}</a><a href={`${portfolio}/terms`} target="_blank" rel="noreferrer">{t.termsLink}</a></nav>;
}

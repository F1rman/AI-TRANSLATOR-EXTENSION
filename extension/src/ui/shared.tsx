import React, { useState } from 'react';
import { Image, LockKeyhole, RotateCcw } from 'lucide-react';
import type { Account, UiLanguage } from '../shared/protocol';
import { billingBuild } from '../shared/billing';
import { send } from '../shared/protocol';
import { messages } from './i18n';
export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4c.9 7.4 4.6 11.1 12 12-7.4.9-11.1 4.6-12 12C15.1 20.6 11.4 16.9 4 16c7.4-.9 11.1-4.6 12-12Z" fill="currentColor"/><circle cx="25" cy="6" r="2" fill="currentColor"/></svg></span><span>AI Translator<span className="brand-sub">{billingBuild.environment === 'test' ? 'TEST · NO REAL PAYMENTS' : 'WORDS CONNECT WORLDS'}</span></span></div>;
}

export function PlanSummary({ account, locale, onRefresh }: { account: Account | null; locale: UiLanguage; onRefresh?: () => Promise<void> }) {
  if (!account) return null;
  const t = messages[locale];
  const pro = account.plan === 'pro';
  const enabled = account.features?.imageTranslation;
  return <div className="plan-summary" title={quotaResetLabel(account.imageQuota.resetsAt, locale)}><div className="plan-heading"><span className="plan-label"><Image size={14} aria-hidden="true"/><span>{t.imageTranslation}</span></span><span className={`plan-badge ${pro ? 'is-pro' : ''}`}>{pro ? 'PRO' : t.freePlan}</span></div>{enabled ? <><div className="plan-quota"><span className="plan-quota-label">{t.imagesRemaining}</span><span className="plan-quota-value"><strong className="plan-quota-count">{account.imageQuota.remainingImages.toLocaleString(locale)} / {account.imageQuota.monthlyImages.toLocaleString(locale)}</strong><span className="plan-period">{t.monthlyPeriod}</span></span></div><small className="quota-reserved">{t.reservedMonthly}: {account.imageQuota.reservedImages.toLocaleString(locale)}</small></> : <div className="plan-unavailable"><LockKeyhole size={13} aria-hidden="true"/><span>{t.imageAccessDisabled}</span></div>}<PurchasedBalance account={account} locale={locale} onRefresh={onRefresh}/></div>;

}

export function PurchasedBalance({ account, locale, onRefresh }: { account: Account; locale: UiLanguage; onRefresh?: () => Promise<void> }) {
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const t = messages[locale];
  const balance = account.prepaid || { words: 0, images: 0, reservedWords: 0, reservedImages: 0 };
  const availability = account.billingAvailability;
  async function open(page: 'pay' | 'account') {
    if (opening) return;
    setOpening(true); setError('');
    try { await send({ type: 'billing:open', payload: { page } }); }
    catch { setError(t.billingUnavailable); }
    finally { setOpening(false); }
  }
  async function refresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true); setError('');
    try { await onRefresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : t.retryHint); }
    finally { setRefreshing(false); }
  }
  return <section className="purchased-balance" aria-label={t.purchasedBalance} title={t.packageHint}>
    <div className="plan-heading"><span>{t.purchasedBalance}</span><span className="plan-period">{t.noExpiry}</span></div>
    <div className="plan-quota"><span>{t.purchasedWords}</span><strong>{balance.words.toLocaleString(locale)}</strong></div>
    <div className="plan-quota"><span>{t.purchasedImages}</span><strong>{balance.images.toLocaleString(locale)}</strong></div>
    <small>{t.reservedBalance}: {balance.reservedWords.toLocaleString(locale)} {t.purchasedWords.toLowerCase()}, {balance.reservedImages.toLocaleString(locale)} {t.purchasedImages.toLowerCase()}</small>
    <div className="available-total" aria-label={t.totalAvailable}><strong>{t.totalAvailable}</strong><span>{(account.quota.remainingWords + balance.words).toLocaleString(locale)} {t.purchasedWords.toLowerCase()} · {(account.imageQuota.remainingImages + balance.images).toLocaleString(locale)} {t.purchasedImages.toLowerCase()}</span></div>
    <small>{t.packageHint}</small>
    {billingBuild.environment === 'test' && <small className="test-billing-notice">{t.testMode}</small>}
    <div className="billing-actions"><button type="button" className="billing-buy" disabled={!availability?.canPurchase || opening} onClick={() => void open('pay')}>{t.buyPackage}</button><button type="button" disabled={!availability?.canViewPurchases || opening} onClick={() => void open('account')}>{t.myPurchases}</button>{onRefresh && <button type="button" onClick={() => void refresh()} disabled={refreshing}><RotateCcw size={12} className={refreshing ? 'spin' : ''}/>{t.refreshBalance}</button>}</div>
    {!availability?.canPurchase && <small role="status">{t.billingUnavailable}</small>}
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

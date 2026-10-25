import React from 'react';
import { Image, LockKeyhole } from 'lucide-react';
import type { Account, UiLanguage } from '../shared/protocol';
import { messages } from './i18n';
export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4c.9 7.4 4.6 11.1 12 12-7.4.9-11.1 4.6-12 12C15.1 20.6 11.4 16.9 4 16c7.4-.9 11.1-4.6 12-12Z" fill="currentColor"/><circle cx="25" cy="6" r="2" fill="currentColor"/></svg></span><span>AI Translator<span className="brand-sub">WORDS CONNECT WORLDS</span></span></div>;
}

export function PlanSummary({ account, locale }: { account: Account | null; locale: UiLanguage }) {
  if (!account) return null;
  const t = messages[locale];
  const pro = account.plan === 'pro';
  const enabled = account.features?.imageTranslation;
  return <div className="plan-summary" title={quotaResetLabel(account.imageQuota.resetsAt, locale)}><div><span className={`plan-badge ${pro ? 'is-pro' : ''}`}>{pro ? 'PRO' : t.freePlan}</span><span>{t.imageTranslation}</span></div><span>{enabled ? <><Image size={13}/>{t.imagesRemaining}: <strong>{account.imageQuota.remainingImages.toLocaleString(locale)} / {account.imageQuota.monthlyImages.toLocaleString(locale)}</strong><span className="plan-period">{t.monthlyPeriod}</span></> : <><LockKeyhole size={12}/>{t.imageAccessDisabled}</>}</span></div>;
}

export function quotaResetLabel(resetsAt: string, locale: UiLanguage): string {
  const date = new Date(resetsAt);
  if (!Number.isFinite(date.getTime())) return messages[locale].monthlyReset;
  const formatted = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${messages[locale].quotaResets}: ${formatted} UTC`;
}

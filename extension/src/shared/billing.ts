import targets from '../../billing-targets.json';
import type { Account, BillingAvailability, BillingEnvironment } from './protocol';

export interface BillingBuild {
  environment: BillingEnvironment;
  apiBase: string;
  billingBase: string;
  authProjectId: string;
}
export interface CentralBillingConfig {
  environment?: unknown;
  authProjectId?: unknown;
  firebaseConfig?: { projectId?: unknown } | null;
}
const env = import.meta.env || {};
export const billingBuild: BillingBuild = {
  environment: (env.VITE_BILLING_ENVIRONMENT || 'live') as BillingEnvironment,
  apiBase: (env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  billingBase: env.VITE_BILLING_BASE_URL || targets.live.billingBaseUrl,
  authProjectId: env.VITE_FIREBASE_PROJECT_ID || 'ai-translator-ext',
};

/** A missing/old API fails closed for purchases while translation keeps working. */
export function billingAvailability(account: Pick<Account, 'billing'>, central?: CentralBillingConfig,
                                    build: BillingBuild = billingBuild): BillingAvailability {
  const unavailable = (reason: BillingAvailability['reason']): BillingAvailability => ({
    environment: build.environment, canPurchase: false, canViewPurchases: false, reason,
  });
  const expected = targets[build.environment];
  if (!expected || build.apiBase !== expected.apiBaseUrl || build.billingBase !== expected.billingBaseUrl
      || build.authProjectId !== 'ai-translator-ext') return unavailable('environment-mismatch');
  if (!account.billing || !central) return unavailable('unavailable');
  if (account.billing.environment !== build.environment || central.environment !== build.environment
      || central.authProjectId !== build.authProjectId || central.firebaseConfig?.projectId !== build.authProjectId) {
    return unavailable('environment-mismatch');
  }
  return { environment: build.environment, canPurchase: account.billing.purchasesEnabled === true,
    canViewPurchases: true, reason: account.billing.purchasesEnabled === true ? 'ready' : 'disabled' };
}

/** Billing links never contain Firebase credentials or arbitrary return URLs. */
export function billingPage(page: 'pay' | 'account', origin = billingBuild.billingBase): string {
  const base = new URL(origin);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || (base.pathname !== '/' && base.pathname !== '')) {
    throw new Error('The billing address must be an HTTPS origin.');
  }
  const url = new URL(`/${page}`, base);
  url.searchParams.set('product', 'ai-translator-extension');
  return url.href;
}

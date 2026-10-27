# AI Translator 1.3.0 — subscriptions and character allowances

This release replaces new prepaid-package purchases with Free and Pro subscriptions. It requires the v2 translator API and the matching central billing subscription deployment. Build artifacts are local; building or packaging does not publish to Chrome Web Store.

- Free: 100,000 source characters per UTC calendar month and 4,000 characters per request.
- Pro: $4.99 per month or $39.99 per year, 2,000,000 source characters per monthly subscription-anniversary window, 50,000 per request, webpage translation, translation tones and optional page context.
- Usage includes Unicode code points in source text; the server owns allowance/reservation enforcement. The popup and settings show used, reserved and remaining characters with the server reset date.
- Context is off initially and limited to 2,000 code points of visible text on the current page. Inputs, password controls, editable, hidden, fully transparent, ancestor-clipped and off-screen text are excluded. There is no arbitrary context-entry field.
- Translation history is local IndexedDB, isolated by Firebase UID and billing environment. Repeated completed-job polling does not duplicate a record. Free displays the latest 20 entries; Pro displays up to 1,000. Storage evicts oldest entries beyond 1,000 records or 25 MiB. Recording can be disabled, individual entries deleted, or all account entries cleared. Downgrading and signing out retain entries. Popup drafts and pending requests also use separate UID/environment keys; switching accounts clears visible text and never replays another account’s pending translation.
- Existing package balance and image translation entry points have been removed from this extension. Old image URLs show an unavailable screen, and the service worker rejects image requests without fetching image bytes.
- Billing links keep the same Google identity, fixed product ID, and separate live/test origins. Credentials never appear in links. An old API produces a readable update-required error.

Validation commands:

```sh
npm --prefix extension run typecheck
npm run test:extension
npm run build
npm run build:test
npm run qa:browser
npm run package
npm run package:test
```

The extension test suite includes real Chromium checks for character limits, Pro gating, keyboard language menus, responsive Ukrainian/English layouts, history storage retention/capacity/scoping, and context exclusion. Fixtures perform no billable AI or payment calls.

## Deployment verification — 2026-10-27

Backend v2, Free/Pro queues, billing API/webhook/schedulers and recurring prices were deployed to test and live. Stripe test Checkout $4.99 completed; verified invoice → revisioned OIDC subscription delivery → Pro2M allowance → priority Cloud Task → successful27-character translation. Test cancellation/refund returned the account to Free; the test subscription was then cancelled. No real card charge was performed. Billing/backend emulator integration checks passed (89 billing tests and186 backend tests); extension47 tests and Chrome package QA passed.

Live/testZIPs remain local artifacts; Chrome Web Store publication is not performed. Current subscription terms are available at https://balubenko-stripe.web.app/ai-translator-terms and /ai-translator-terms-uk. Vercel rejected PORTFOLIO publication with TEAM_ACCESS_REQUIRED (commit author has no deployment permission); its source and production build are ready for a retry after account access is resolved.

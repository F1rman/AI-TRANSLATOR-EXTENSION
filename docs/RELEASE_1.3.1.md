# AI Translator 1.3.1 — 2026-10-28

Completed the ten local marketing-dashboard tasks and installed the missing product features.

- The recommended name and summary now use manifest messages, with 55 complete packaged catalogs and 55 full Store-description drafts.
- The 128px Store icon retains the mint/green brand with centered 96px artwork and transparent 16px margins. Small toolbar variants remain legible.
- Five screenshots per locale localize editorial copy around authentic English UI captures: 275 locale exports. The main translator UI remains English/Ukrainian.
- A review request appears only in an idle, signed-in popup after five unique successful jobs. Retries count once; the first dismissal waits 14 days, the second dismissal or rating stops future asks. No translation text is stored by the counter.
- A packaged, localized welcome page opens once on first install. It respects the saved theme, uses local assets, and includes three starting steps, quotas, prices and privacy information.
- Literal price dollars are escaped for Chrome i18n, preserving `$4.99` and `$39.99` in the real browser.

The popup remains exactly **420 CSS px**. Free webpage-translation actions open the Pro purchase page; Pro retains normal page translation. No backend or Stripe deployment is required for this release.

Validation: typecheck, **52 extension tests**, test/live builds and packaging, real Chromium popup/settings/welcome/content checks, and complete 55-locale audits pass. Visual and dashboard evidence is in [meta/REPORT.md](../meta/REPORT.md) and `meta/data/`.

Packages: `artifacts/ai-translator-1.3.1.zip` and `artifacts/ai-translator-1.3.1-test.zip`. Both retain the existing extension ID/OAuth and exclude `meta/`. Store publication and independent native-language review were not performed.

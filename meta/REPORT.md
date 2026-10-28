# AI Translator — completed Store preparation for 1.3.1

Integration date: 2026-10-28. Research observations retain their original 2026-10-27 dates. Open [index.html](index.html) for listing copy, assets, source evidence and the ten-task dashboard. Product implementation and local release preparation are separate from owner editorial acceptance or completed Store actions; no Store publication is claimed.

| # | Task | Delivered result |
| --- | --- | --- |
| 1 | SEO name | Five options retained; the recommended AI Translator – Text & Webpage Translator is applied through localized manifest messages. Similar-name research remains available for owner review. |
| 2 | SEO short description | Five options retained; the recommended summary is applied through localized manifest messages, with translated summaries checked against Store limits. |
| 3 | SEO full description | Complete English plain-text description with current Free/Pro pricing, character limits, renewal, cancellation and data handling. |
| 4 | Localized descriptions | Full description and all fourteen message keys for all 55 target locales. Source catalogs are packaged under `_locales/`, with `default_locale` and message-based manifest fields. Native-language editorial review is not claimed. |
| 5 | Promo tile | Recommended text-free 440×280 tile, 1400×560 marquee and two small alternatives, with source templates and matching prompts. |
| 6 | Screenshots | Five English 1280×800 frames showing actual extension UI with documented, non-sensitive demo data. |
| 7 | Icon | Packaged 128px icon uses centered 96px artwork with a 16px transparent margin. The original mint/green brand is retained, including clear small toolbar variants; the comparison and visual evidence remain available. |
| 8 | Localized screenshots | Five 1280×800 marketing frames for each of 55 locales: 275 locale exports. Headlines and supporting copy are translated around authentic English UI captures; this does not imply the whole application supports 55 UI languages. |
| 9 | Review ask | Implemented in the extension: an optional idle-popup request after five unique confirmed successful jobs. First dismissal delays fourteen days; second dismissal or opening the review page stops future asks. No reward, sentiment filtering or five-star requirement. |
| 10 | Welcome page | Implemented packaged `welcome.html`, shown once on first install, with localized messages, local assets, three starting steps, allowance/privacy information and preferences access. Updates and reloads do not trigger it. |

The popup remains exactly **420 CSS pixels wide**. Free users clicking webpage translation go to the Pro purchase page; Pro users retain the page-translation workflow. The stable extension ID and Google authentication configuration are retained.

## Copy and release material

Use the [English full description](descriptions/en.txt), [five name/summary choices](data/names.json), [Store form](data/dashboard.json), and catalogs under `locales/<code>/messages.json`. Every translated description is in `descriptions/<code>.txt`. The selected name/summary is now part of the source catalogs, rather than only an unapplied recommendation. See [copy report](REPORT-copy.md).

Visual material includes the [recommended tile](promo/small-440x280.png), [marquee](promo/marquee-1400x560.png), five main screenshot frames under `screenshots/`, and localized sets under `screenshots/<locale>/`. The [icon comparison](icon/check.png), raw captures, repeatable jobs and matching prompts support review. See [visual report](REPORT-visuals.md).

Free includes 100,000 source characters per UTC calendar month and up to 4,000 per request. Pro is US$4.99/month or US$39.99/year, with 2,000,000 characters per monthly anniversary window and up to 50,000 per request. Pro adds page translation, optional visible context, tones, priority processing and access to more local history. Retired image and word-package offers are omitted from current listing copy.

## Saved Chrome Web Store draft

On 2026-10-28, version **1.3.1** was verified in the existing [Store draft](https://chrome.google.com/webstore/devconsole/04776745-9567-4c48-8dbd-167f5b8f5745/aieamemimbcbbnmakifejomadhegogge/edit/listing). All 55 full descriptions and 275 localized screenshots were read back after a server reload. The uploaded remote thumbnails also passed image, order and localized-caption checks. Five common screenshots, the icon, small promo and marquee are saved.

The seven permission explanations, single purpose, six data-use categories, three Limited Use declarations, privacy-policy URL and Google OAuth testing instructions are saved. Distribution declares optional purchases/subscriptions, retaining public visibility and all selected regions. The hosted product, privacy and support pages were updated to current Free/Pro behavior. **Submit for review is enabled; the draft has not been submitted or published.**

Google OAuth uses the reviewer's verified Google account, without a separate application password. The 473-character testing field provides Free test steps and the support contact for complimentary Pro access. No shared Pro reviewer account was supplied. Optional promotional videos and an unverified official-site property are left empty.

Evidence: `artifacts/store-listing-readback.json`, `artifacts/store-image-visual-validation.json`, and `artifacts/store-ui/*-readback.json`.

## Evidence and remaining owner actions

Machine-check results are in [artifact validation](data/validation.json), [localized screenshot validation](data/localized-screenshots-validation.json), [visual review](data/localized-visual-review.json), [dashboard interactions](data/dashboard-validation.json), [responsive layouts](data/dashboard-responsive-validation.json), and the built/overlay audits under `audits/`. Final delivery evidence records the actual release and test outcomes; this report does not invent new test totals. Source and built-package checks distinguish installed review/welcome behavior from historical proposals.

Translated text has not been reviewed by native speakers. Localized frames translate their marketing copy while preserving the supplied English UI; main popup/options UI languages remain English and Ukrainian. Screenshot fixtures do not prove live AI quality, interactive Google login or a real production payment. The [research report](REPORT-research.md) preserves dated competitor observations, the unavailable own-draft listing and one competitor video-embed download limitation.

The owner still reviews the listing, language wording, trademark/name similarity, policy declarations and Store submission. Dashboard owner marks describe editorial acceptance and completed Store actions, not merely file generation. No publication, ranking, install forecast or native-language sign-off is claimed. Current test/live extension packages exclude `meta/`.

The user explicitly requested completing all dashboard tasks, so this phase includes authorized product changes for catalogs, icon, review UI and welcome UI, alongside marketing artifacts. Existing unrelated work is preserved.

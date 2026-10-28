# Listing copy, localization and Store form — 1.3.1

Release preparation integrated on 2026-10-28. Keyword and competitor observations remain dated 2026-10-27. Previous copy is retained under `research/2026-10-27/previous/`; this report concerns the current files and authorized extension implementation, not Store publication.

Recommended name: **AI Translator – Text & Webpage Translator** (option 0, 41 characters). Recommended summary: **Translate text with AI and keep local history. Pro adds webpage translation, tone and optional context.** (option 0, 103 characters). The five name options and five summaries remain available in `data/names.json`. Similar AI Translator listings remain a naming consideration, not a claim of trademark clearance.

## Complete locale material

Each of the 55 target locales has a full description under `descriptions/` and a catalog under `locales/<code>/messages.json`. Every catalog contains the fourteen established keys: two listing fields, three review strings and nine welcome strings. Brand names, URLs, quota quantities and USD prices are preserved. English regional catalogs legitimately share wording; their similarity is not proof of an untranslated foreign-language draft. Translations are prepared for editorial use, with native-speaker review still unverified.

The source extension now has catalogs under `extension/public/_locales/`. Its manifest uses `__MSG_appName__`, `__MSG_appDescription__` and `default_locale: en`. Test builds append their Test label through the build process and retain the stable extension ID. Built and overlay audits under `audits/` provide structural, placeholder and field-length evidence. Main popup/options UI languages remain English and Ukrainian; catalog coverage localizes listing metadata, welcome messages and applicable extension strings, rather than every product screen.

The English description and its translations state current Free/Pro prices, monthly character limits, per-request limits, UTC calendar/anniversary renewal, no rollover, cancellation, local history and optional context. They distinguish requested translation, automatic instant-selection mode and new text during active Pro page sessions. Retired image and word-package offers are omitted. Exact text/permission checks are recorded in `audits/copy-and-store-form.json` and `data/validation.json`.

## Implemented product tasks

The selected metadata now ships in the extension. The review request is implemented through `extension/src/shared/review.ts`, background message handlers and `ReviewCard.tsx`. Only five unique successful completed jobs make it eligible; it appears in an idle signed-in popup. Its first dismissal postpones it fourteen days, its second stops it, and rating opens the runtime-ID-derived Store review URL before permanently suppressing the request. It stores no translation text and uses no incentives or sentiment gating.

The packaged welcome page uses local fonts, three starting steps, subscription allowance/privacy information and catalog messages. The installation handler preserves menu initialization and opens onboarding only once for first install, not on an update or reload. Historical adapted snippets in `data/recommendations.json` are background material; actual source and current validation establish implementation.

## Store form and owner review

`data/dashboard.json` includes the proposed Productivity → Tools category and source-traced justifications for the six API permissions and two HTTP(S) host patterns. The possible overlap between `activeTab` and persistent host access is an engineering review note; no unverified permission removal is claimed.

Evidence comes from the source and built 1.3.1 extension, locale audits and local artifact checks. The earlier TLS checks found the privacy, support and subscription-terms links available; link availability is not editorial approval of every sentence. Owner review of wording, policy declarations, native-language quality and Store submission remains separate from completed implementation and files.

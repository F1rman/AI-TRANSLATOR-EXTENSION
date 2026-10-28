# Listing copy and Store form — 1.3.0

Current drafts were refreshed 2026-10-27 and integrated 2026-10-28. Work is confined to `meta/`; nothing was published or uploaded. Previous copy/report evidence is retained under `research/2026-10-27/previous/`.

Recommended name: **AI Translator – Text & Webpage Translator** (option 0, 41 characters). Recommended summary: **Translate text with AI and keep local history. Pro adds webpage translation, tone and optional context.** (option 0, 103 characters). Five distinct names and five summaries fit the 75/132-character limits. Similar AI Translator listings require owner review; wording marked caution is not trademark clearance.

The current English description states the Free/Pro price, monthly character limits, per-request limits, UTC calendar/anniversary renewal, no rollover, cancellation, local history and optional context. It distinguishes requested translation, instant-selection mode and new text during an active Pro page session. Retired image and word-package offers are omitted. Exact word count and permission coverage are in `audits/copy-and-store-form.json` and `data/validation.json`.

`data/dashboard.json` proposes Productivity → Tools and gives source-backed explanations for all six API permissions and both HTTP(S) host patterns. It flags the possible redundancy of activeTab alongside persistent host access; this remains an engineering review recommendation, not a claimed permission removal.

`locales/en/messages.json` preserves all fourteen existing English proposal keys and refreshes the listing and review/welcome text. No Ukrainian listing description or catalog existed to overwrite. This normal run prepares English only: 54 of the 55 baseline locale drafts remain pending. The actual built package has literal name/description metadata, no default_locale and no _locales directory. The overlay is a draft and requires the separately proposed source/build changes before packaging.

`data/recommendations.json` contains unapplied review, welcome, localization and permission-review proposals. The review proposal counts five unique completed jobs, requests an honest review without incentives/gating, waits fourteen days after the first dismissal, stops after the second, and appears only in an idle popup. The welcome proposal preserves menu creation and runs only on first install. These snippets were not installed by the marketing workflow.

Evidence comes from the actual `extension/dist` 1.3.0 manifest and the background, UI, content, history and billing source. Screenshot fixtures demonstrate current UI states without establishing live sign-in or AI quality. The privacy, support and current subscription-terms URLs returned HTTP 200 through TLS-enabled curl. Owner editorial acceptance, native-language review and Store submission remain pending.

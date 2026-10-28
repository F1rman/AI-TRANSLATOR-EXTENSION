# AI Translator marketing research — 1.3.0 refresh

Current run: 2026-10-27. Raw 2026-10-23 material remains historical. The owner identified the Store item as an unpublished draft. No public own listing or Store-wide rank is claimed.

## Keyword decision

Retain the established AI Translator brand and use **webpage translator** as the task-led primary phrase, with the Free text entry point named explicitly. Recommended name: **AI Translator – Text & Webpage Translator**. Recommended summary: **Translate text with AI and keep local history. Pro adds webpage translation, tone and optional context.**

The webpage query has demand heuristic 3 and competition 0 in this snapshot. Competition 0 means no exact phrase among the checked result names; established competitors still solve the page-translation task. The listing labels page access as Pro.

| Phrase | Demand | Competition | Phrase in top names | Top 10 users | Decision |
|---|---:|---:|---:|---:|---|
| ai translator | 3 | 2 | 6 | 7,365,726 | secondary |
| webpage translator | 3 | 0 | 0 | 3,378,051 | primary |
| translate selected text | 3 | 2 | 2 | 39,525,000 | secondary |
| full page translator | 3 | 2 | 0 | 46,430,000 | secondary |
| text translator | 3 | 2 | 0 | 42,385,000 | description |
| context menu translator | 2 | 2 | 0 | 911,843 | description |

All six English probes and three Ukrainian probes fetched Store results and Google autocomplete successfully. The own item was not found among 10 checked results per query. Installed-user totals and autocomplete are comparison heuristics, not monthly searches, expected installs or ranking forecasts. Ukrainian queries are research only; this normal run does not create a Ukrainian Store translation.

## Direct competitors

| Listing | Users | Rating (count) | Category |
|---|---:|---|---|
| [AI Translator](https://chromewebstore.google.com/detail/hbblhboakojbegilahlbppmmkogdgehp) | 4,000 | 2.55 (11) | productivity/workflow |
| [Linguist - web page translator](https://chromewebstore.google.com/detail/gbefmodhlophhakmoecijeppjblibmie) | 200,000 | 4.39 (375) | productivity/communication |
| [AI Translator - Smart AI Translation (Hover, Select, Context Menu)](https://chromewebstore.google.com/detail/hkelkkhcmkhbpkenoogdeomannakpilk) | 549 | 5 (9) | productivity/tools |
| [DeepTranslate - Full Page & Bilingual Translator & AI-Powered Translation](https://chromewebstore.google.com/detail/noofnfniimcnghnkonpdlhlaeaocidbi) | 50,000 | 3.89 (489) | productivity/tools |
| [Simple Translate](https://chromewebstore.google.com/detail/ibplnjkanclpjokhdolnendpplpjiace) | 200,000 | 4.03 (478) | productivity/tools |
| [DeepL: translate and write with AI](https://chromewebstore.google.com/detail/cofdbpoegempjloogbagkncekinflcnj) | 4,000,000 | 4.52 (12669) | productivity/communication |
| [Immersive Translate: AI Web, PDF & Video Translator](https://chromewebstore.google.com/detail/bpoadfkcbjbfhfodiogcnhhhpibjhbnh) | 3,000,000 | 4.61 (3204) | productivity/tools |
| [Translate Selected Text](https://chromewebstore.google.com/detail/fbimffnjoeobhjhochngikepgfejjmgj) | 100,000 | 4.15 (772) | productivity/education |

All eight listings were refreshed on 2026-10-27. Their artwork and descriptions are research references only. Four use productivity/tools, supporting the proposed Productivity → Tools category. Several use AI Translator or closely related names, so all name options carry a caution; this is not trademark clearance. Differentiation comes from explicit Free/Pro terms and local-history/context controls, without claiming competitors lack those features.

One competitor asset error remains: Immersive Translate screenshot 1 is a YouTube embed, not an image. Other assets remain available. No competitor listing fetch failed.

## Verified product and Store form

The built manifest is 1.3.0 with six API permissions and two HTTP(S) host patterns. All eight have copyable source-traced justifications. Current marketing offers Free/Pro character subscriptions and hides retired image and word-package offers.

Free is 100,000 source characters per UTC calendar month, maximum 4,000 per request. Pro is US$4.99/month or US$39.99/year, with 2,000,000 characters in monthly anniversary windows and maximum 50,000 per request. Annual billing does not grant the entire year’s allowance upfront.

History is account/environment-scoped local IndexedDB: at most 1,000 entries or 25 MiB with oldest-first eviction. Free displays 20, Pro up to 1,000; recording, deletion and clear controls exist. Pro context is opt-in and limited to 2,000 visible surrounding characters, excluding fields, passwords, hidden content and HTML. The listing distinguishes requested text, automatic instant-selection mode and newly appearing text during an active Pro page session.

Existing onInstalled creates menus only. Review and welcome features remain adapted proposals inside meta/data/recommendations.json. The review proposal waits for five unique confirmed completed jobs, asks for an honest review with no gating or reward, and delays the first dismissal for fourteen days. The welcome proposal runs only on first install and preserves menu creation. A separate manifest-localization proposal is required before using chrome.i18n messages.

## Checks and remaining editorial work

- Five name options: 13–47 characters, all within 75. Five summaries: 103–113 characters, all within 132. Recommended name 41, summary 103.
- The full description is plain text with one occurrence of the primary phrase. Its exact word count and eight-permission coverage are recorded in audits/copy-and-store-form.json.
- All 14 existing English proposal keys are preserved and refreshed. The actual package has no _locales directories and literal manifest metadata. The English overlay covers 1 of 55 baseline locales; 54 remain pending. The draft has no placeholder, length or key structural errors; the audit still reports three expected manifest-localization blockers.
- No existing Ukrainian description or message draft was found to overwrite. Only English is drafted in this normal run.
- Own-listing collection cannot parse the draft item. Browser fallback reached a generic Chrome Web Store shell at an empty-title URL, with no item name or listing content. This does not independently prove publication status. Owner context supplies draft status.
- Owner editorial acceptance, native-language review and Store submission remain unperformed. Nothing was published or uploaded.

Evidence: data/keywords.json; research/2026-10-27/keywords-{en,uk}.json; competitors/competitors.json and individual listing.json snapshots; audits/copy-and-store-form.json; audits/locales-{built,with-en-draft}.json; research/2026-10-27/own-status.json; own-browser-check.json and own-status-response.html. Previous current copy files are preserved under research/2026-10-27/previous/.

Official length reference checked 2026-10-27: https://developer.chrome.com/docs/extensions/reference/manifest/description (plain-text summary maximum 132 characters).

The dashboard owner independently checked the current privacy, support and subscription-terms links with TLS-enabled curl: all returned HTTP 200 (no SiteNotFound page). Link availability is not editorial review of their full content.

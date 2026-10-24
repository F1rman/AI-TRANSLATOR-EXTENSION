# AI Translator — Store material

Prepared 2026-10-24. Keyword and competitor observations were collected 2026-10-23. Open [index.html](index.html) for the task dashboard and copy/download actions.

| # | Task | Delivered |
|---|---|---|
| 1 | SEO name | Five candidates; recommended: Webpage Translator – AI Translator. Draft only. |
| 2 | SEO short description | Five candidates; recommended option 2. Draft only. |
| 3 | SEO full description | English, 434 words, ready to copy. |
| 4 | 55 locale descriptions | English description and metadata draft; 54 translations remain. Translation mode was not requested. |
| 5 | Promo tile | Recommended 440×280, matching 1400×560 marquee, two small-tile variants. |
| 6 | Screenshots | Five English 1280×800 images from the actual built UI using local demo data. |
| 7 | Icon | Comparison and padding warning; optional redesign prompt. Existing icon unchanged. |
| 8 | Localized screenshots | No localized sets prepared. |
| 9 | Review ask | Adapted code recommendation, unapplied. |
| 10 | Welcome page | Adapted code recommendation, unapplied. |

## Recommended copy

Name: Webpage Translator – AI Translator

Short description: Read pages in your language with a webpage translator. Translate selected text and show the original when needed.

Full description: [descriptions/en.txt](descriptions/en.txt).

## Upload candidates

- [Recommended small tile](promo/small-440x280.png), [marquee](promo/marquee-1400x560.png), [variant B](promo/small-440x280-b.png), [variant C](promo/small-440x280-c.png).
- Screenshots: [1](screenshots/1.png), [2](screenshots/2.png), [3](screenshots/3.png), [4](screenshots/4.png), [5](screenshots/5.png).
- [Store form](data/dashboard.json): category, single purpose, all six permissions and two host patterns.
- [Code recommendations](data/recommendations.json), [English locale draft](locales/en/messages.json).

## Evidence and status

- [Copy report](REPORT-copy.md): exact source evidence, limits, retention and locale gaps.
- [Research report](REPORT-research.md): keyword decisions, eight competitors, observation dates and source links. Demand is a heuristic, not search volume; own listing rank is unavailable for the draft item.
- [Visual report](REPORT-visuals.md): real-UI capture method, fixture disclosure, asset inspection and icon warning. Demo screenshots do not establish live Google login or live AI quality.
- [Artifact validation](data/validation.json), [layout validation](data/layout-validation.json), [dashboard validation](data/dashboard-validation.json). All checks passed: 16 artifact checks, ten rendered layouts, ten task rows, seven working tabs and all 58 local image references. Copy payload and manual task persistence were checked in a disposable browser; clipboard transport was stubbed for this check. [Tasks preview](dashboard-tasks.png) was rendered and visually inspected.

The built manifest remains AI Translator v1.0.1 with literal English metadata and no packaged listing locales. Review and welcome code are recommendations. Dashboard checks reflect the existing package separately from prepared drafts. Real Google-account sign-in still needs its regular Chrome test recorded in the project documentation.

All work is confined to `meta/`. Existing workspace changes outside it were preserved. No Store listing, extension package, backend, hosting or account was modified or published.

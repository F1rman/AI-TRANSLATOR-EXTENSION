# AI Translator — visual asset handoff

Prepared 2026-10-24. Changes are confined to `meta/`. The extension, live backend, hosting and Store listing are unchanged.

## Render and upload files

Recommended: `promo/small-440x280.png` and `promo/marquee-1400x560.png`, both rendered from `promo/tile.html`: **Translate / Web Pages**. Forest ink #263027, near-white #FFFEFA fading to #F5F3ED, dark-gold accent #A27725; the translation symbol keeps forest strokes and gold detail. The wording covers supported web pages without claiming Chrome-internal or PDF pages.

Variants: `promo/small-440x280-b.png`, **Select / And Translate**, and `promo/small-440x280-c.png`, **AI Text / Translator**. Variant C retains the inverse forest-and-gold treatment. Each image has a matching prompt under `promo/prompts/`.

All final images are listed in `render-jobs.json`: four promo files, five screenshot frames at exactly 1280×800, and `icon/check.png`. They were rendered together with the skill renderer using `--batch meta/render-jobs.json` from the project root. Source templates are adapted copies of the skill's promo, screenshot and icon-check templates. Wide screenshot captures are limited to 1000 px and the settings capture to 900 px so the actual bottom controls remain in frame.

| Shot | Caption | Actual capture | Purpose |
|---|---|---|---|
| 1 | Translate text with AI | `screenshots/raw/text-result.png` | Source text and a completed English translation in the built popup. |
| 2 | Select text. Get the meaning. | `screenshots/raw/selection-translation.png` | Actual selection bubble with the completed translation. |
| 3 | Translate pages. Keep the layout. | `screenshots/raw/page-translated.png` | Actual page replacement, preserved layout, newly added text and the extension's page toolbar. |
| 4 | Choose your translation languages | `screenshots/raw/languages-options.png` | Actual source/target fields and selection settings, captured from options. |
| 5 | Read in light or dark | `screenshots/raw/selection-dark.png` | Actual dark selection bubble on a demo page that supplies its own dark stylesheet. |

Every screenshot has an image-edit prompt in `screenshots/prompts/`. The prompt requires the real UI to remain unchanged. If a generator redraws, misspells, translates or invents UI, use the deterministic rendered PNG instead. No ratings, user counts, awards, third-party branding or real personal data appear.

## Exact demo method

Reproduction script: `screenshots/capture-raw.mjs`. It reads the existing `extension/dist` build without rebuilding or modifying it. It creates temporary Chromium profiles in the OS temporary directory and deletes them afterward. All six raw captures use device pixel ratio 2. Interface language is English.

For the popup, the real unpacked extension is loaded with its Store public key. The script writes **only to that disposable browser profile**: `chrome.storage.local.settings` sets French → English, English UI and light mode; `chrome.storage.session.textDraft` contains an original French sentence and its manually supplied English translation. The unchanged popup's existing recovery path displays these values. It is unsigned-in; the screenshot crops/scrolls the real translation area and does not fabricate a user, account, quota or Google login.

For options, the unchanged `options.html` is opened and its actual language/selection cards are captured at their DOM bounds. The options frame uses no fabricated account.

The selection and page captures load the unchanged built `content.js` into `https://field-notes.example/garden`, a Playwright route served from `screenshots/fixtures/garden.html`. The garden article, quote and translation examples are original demo material created for this task. A deterministic runtime fixture responds to the production content script's existing `settings:get`, `translation:submit`, `translation:get`, `translation:cancel` and page-report messages using a fixed French → English dictionary. The same real content controller renders the bubble, updates text nodes, observes a dynamically appended note, shows the page toolbar and restores originals. No product UI is redrawn.

The script appends the original note “Demain, les ateliers commencent à dix heures.” after the first translation, waits until the real MutationObserver pipeline shows its English translation, and captures shot 3. It then issues the same restore command used by the extension and saves optional verification capture `raw/page-restored.png`. That restored capture is not one of the five upload shots. Shot 5 sets the real extension theme setting to dark and the demo page's own CSS theme to dark; AI Translator does not claim to change a website's theme.

These images demonstrate actual UI and behavior with local demo transport. They are **not** evidence of a live AI translation request, completed Google sign-in, translation quality benchmark or real user's session. `screenshots/raw/fixture-verification.json` records `authenticated:false`, `liveGoogleLoginTested:false`, `liveAiRequest:false`, session progress and browser errors (none in the completed capture pass).

## Icon judgment

`icon/source128.png` and `icon/source16.png` are unaltered copies of the existing build's icons. The real 16 px bitmap has a visible gold sparkle against forest; the small detached dot is subtle. The green-and-gold palette differs clearly from captured blue, cyan and magenta translation icons. The sparkle signals AI, but by itself it is not an explicit translation glyph.

**Warning:** the 128 px bitmap's artwork reaches the 128×128 canvas bounds instead of fitting a centered 96×96 area with 16 px transparent margins. Rounded corner transparency does not provide that margin. `data/checks.json` therefore sets `vis-icon-distinct` to `warn`. `icon/prompt.md` provides an optional padding proposal; no extension icon is replaced. The root render pass supplies the 16/32/48/128 px light/grey/dark comparison and actual competitor neighbors in `icon/check.png`.

## Source identity

Built manifest version: 1.0.1. Store ID observed in disposable Chromium: `aieamemimbcbbnmakifejomadhegogge`.

```json
{
  "manifest.json": "2584ec300ffbe57be7a66752f22bb812d59f600aa06aa87274fe97bd046bff02",
  "content.js": "398a27d8212f3dceeb244262f5ab50b15362fd38570d90835e52392ab7fc9d2b",
  "background.js": "3c1f1449a5367255cdf4f11aff1abbf9c47ae0866801b164ee6a09ab77d492ab"
}
```

## Final visual inspection — 2026-10-24

The root agent opened all ten final PNGs: four promos, five screenshot frames and the icon comparison. Captions are complete, translated results and copy controls are readable, and the page toolbar retains both Stop and Original. The popup capture intentionally bleeds off the bottom while its completed result and Copy translation control remain visible. No screenshot redraws product UI.

Exact promo dimensions are 440×280 / 1400×560 and screenshots are 1280×800, with square full-bleed canvas corners. `data/layout-validation.json` records all ten loaded layouts with no missing images or browser script errors, promo headlines of at least 40 px, and screenshot captions of 3–6 words with at most two lines. `promo/half-size-check.png` was separately rendered and visually inspected: all three small-tile headlines remain readable at 220×140.

The icon comparison confirms the padding warning above; it does not mark the existing icon fixed. Keep the entire `meta/` folder together for source links, and keep its neighboring built extension available for the dashboard's current-icon reference.

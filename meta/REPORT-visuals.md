# AI Translator — current visual assets

Refreshed for version 1.3.0 on 2026-10-27; final integration checked 2026-10-28. All marketing files are inside `meta/`. The Store and packaged icon are unchanged.

The recommended `promo/small-440x280.png` and `promo/marquee-1400x560.png` are text-free Soft Flat compositions of the original pale-mint/green mark. Variant B says “Translate with AI”; variant C uses a dark surface with the original mark. The 1024px marketing mark reproduces the exact procedural geometry/colors from the build script for crisp promotional scaling; it is not a redesign or a packaged icon replacement.

| Shot | Headline | Authentic capture |
| --- | --- | --- |
| 1 | Understand every word | Completed Free text translation, with the 4,000-character request limit |
| 2 | Select. Translate. Keep reading. | Current content-script selection result on the original demo article |
| 3 | Read the whole page | Current Pro page replacement, toolbar, and restoration controls |
| 4 | Make the tone fit | Current Pro tone/context controls in options |
| 5 | Keep translations close | Current local-history interface in dark theme |

All five composed images are exactly 1280×800 with full-bleed square corners. The real interface is proportionally contained or placed in a stacked composition, never stretched or redrawn. Matching prompts are under `screenshots/prompts/`; promo prompts are under `promo/prompts/`.

## Capture evidence

`screenshots/capture-raw.mjs` reads the actual current build and records source hashes, transport requests and capture facts in `screenshots/raw/fixture-verification.json`. The popup is 420px wide. The UI itself comes from the built React/content bundles; the account, quota, history records and translation responses use deterministic, non-sensitive demo transport. This is an authentic UI capture with demo data, not proof of live AI quality, Google login or paid checkout. The source fixture article is original material under `screenshots/fixtures/`.

Raw current captures remain in `screenshots/raw/`. Older raw captures are retained as history and are not linked in the five current frames. No uploaded image or remote screenshot service was used.

## Inspection and icon judgment

The root reviewed all ten main exports: five screenshots, three small promos, marquee and icon comparison. They display the current valid features and readable captions. A half-size preview is retained at `promo/half-size-check.png`; current 640×400 screenshot previews are combined in `screenshots/half-size-check.png`. Local image/font loads and template caption bounds are checked by the renderer and QA scripts.

`icon/source128.png` and `icon/source16.png` copy the current package unchanged. The mint square and dark green sparkle remain clear at 16px on light/dark surfaces and distinguish it from the observed blue/cyan competitors. The symbol communicates AI more directly than translation. Its 128px artwork reaches the canvas edges; the usual 16px transparent margin around 96px square artwork is absent. `vis-icon-distinct` therefore remains **warn**, with an optional padding prompt in `icon/prompt.md`. No redesign was installed.

Reproduction: `render-jobs.json` contains the ten main layouts; `screenshots/jobs.json` contains the five screenshot frames. Keep `meta/` together so local fonts, images and dashboard links remain portable.

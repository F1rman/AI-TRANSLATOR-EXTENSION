# AI Translator — visual release material for 1.3.1

Integration date: 2026-10-28. The original English scenes and research references were refreshed on 2026-10-27. Marketing files remain under `meta/`; the user also authorized applying the icon correction in the extension source. The Store has not been updated by this local work.

## Promo and main screenshots

The recommended `promo/small-440x280.png` and `promo/marquee-1400x560.png` are text-free Soft Flat compositions of the original pale-mint and dark-green mark. Variant B says “Translate with AI”; variant C uses the dark theme. The high-resolution marketing mark follows the same procedural geometry and colors for crisp scaling.

| Shot | English headline | Authentic UI content |
| --- | --- | --- |
| 1 | Understand every word | A completed Free text translation with its 4,000-character request limit |
| 2 | Select. Translate. Keep reading. | The content-script selection result on the original demo article |
| 3 | Read the whole page | Pro page replacement, translation toolbar and original-restoration controls |
| 4 | Make the tone fit | Pro tone and optional context controls in options |
| 5 | Keep translations close | The local-history interface in the dark theme |

The five main frames are 1280×800, full bleed with square outer corners. The captured interface is proportionally contained or placed in a stacked composition; it is not stretched, redrawn or represented as a fabricated device. Templates and prompts remain under `screenshots/` and `promo/`.

## Localized sets

All 55 target locales have five localized 1280×800 marketing exports under `screenshots/<locale>/`: 275 locale images, in addition to the main English set. Locale caption sources are under `screenshots/captions/`; repeatable jobs are in `screenshots/localized-jobs.json`. The renderer and validation results are recorded in `data/localized-screenshots-validation.json`, with contact-sheet review evidence in `data/localized-visual-review.json`.

Headlines and supporting marketing sentences are translated. The embedded real interface remains English, exactly as in the authentic capture. This is intentional: the images do not claim that popup/options UI has been translated into all 55 languages. RTL locale frames use suitable text direction while preserving the authentic UI image. Main product UI remains English and Ukrainian. Local render checks establish image dimensions, loaded assets and caption bounds; native-language editorial review is not claimed.

## Capture evidence

`screenshots/capture-raw.mjs` reads the built UI and records capture hashes and deterministic transport evidence in `screenshots/raw/fixture-verification.json`. The popup is exactly 420 CSS pixels wide. Account details, quotas, history records and translated responses use non-sensitive demo fixtures around the actual React/content bundles. These are authentic interface captures with demo data, not proof of live AI quality, interactive Google login or a paid checkout. The fixture article is original material under `screenshots/fixtures/`.

Raw captures remain under `screenshots/raw/`; old raw material is retained as history rather than linked as a current feature. The UI scenes continue to show the same current translation, context and local-history capabilities in 1.3.1. Local image/font loads, proportional placement and caption bounds are covered by the render/QA evidence.

## Icon correction and visual review

The original mint square and green sparkle brand is retained. The build now centers 96px artwork inside the 128px Store icon with a 16px transparent margin on each side. The toolbar variants retain their useful optical size rather than inheriting large Store padding. The change addresses the earlier concrete padding warning without replacing the established mark.

`icon/check.png` compares the actual package mark on light and dark surfaces and beside downloaded competitor icons. The symbol remains recognizably different from the observed blue/cyan translator marks; it communicates AI rather than promising any unimplemented feature. Current icon judgment and measured evidence are stored in `data/checks.json` and final validation rather than inferred from the old proposal prompt.

Main exports were inspected at full size; half-size previews and localized contact sheets support inspection of the complete set. Localized text remains subject to native editorial review. Keep `meta/` together so fonts, assets, reports and dashboard links remain portable. Current test/live release ZIPs exclude this marketing directory.

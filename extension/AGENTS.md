# Extension UI requirements

- The Chrome toolbar popup must always be exactly **420 CSS pixels wide**. This is an explicit, persistent user requirement. Do not change its width unless the user explicitly requests a different width.
- Preserve the fixed width on `html.popup-page`, its `body`, `#root`, and `.popup`, including loading, signed-out, Free, Pro, history, and error states. Do not replace it with viewport-relative widths, `min(420px, 100vw)`, or responsive rules that shrink the popup.
- Keep the options page responsive independently of the toolbar popup. The popup width is part of the product contract and must survive design changes and refactors.
- When changing popup layout, run the existing Chromium checks in `tests/ui-browser.test.mjs`; they verify the 420px document and content widths. For packaged UI changes, rebuild both live and test extension packages.

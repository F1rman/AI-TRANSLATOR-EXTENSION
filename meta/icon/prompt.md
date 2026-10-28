# AI Translator packaged icon — 1.3.1

Reference: `source128.png` and `source16.png` copied from the current package; comparison: `check.png`. The 128px Store bitmap now has centered 96px mint/green artwork with 16px transparent margins. Small toolbar variants preserve the original optical size. This correction is implemented in `extension/scripts/build.mjs`.

## Matching rendering prompt

```text
Reproduce the attached original AI Translator icon on an exactly 128×128 transparent canvas. Preserve the pale-mint rounded square, the bold dark-green curved four-point sparkle, and the small green dot near its upper-right. Preserve the supplied mark's proportions, geometry and colors. Center the complete rounded-square artwork in a 96×96 region, leaving 16px transparent margins on every side. Keep the interior solid and flat. No text, letters, added symbols, thin outlines, gradients, shadows, glow, blur, 3D or perspective. Compare the result against source128.png and check.png; the procedural packaged bitmap is authoritative. For 16px toolbar use the supplied source16.png optical variant rather than shrinking the padded Store image.
```

The actual source bitmap and comparison were inspected. Pixel bounds and toolbar dimensions are recorded by the release validators. Brand/name similarity remains a separate editorial decision, not a claim of trademark clearance.

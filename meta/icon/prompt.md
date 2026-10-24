# Icon padding and recognition variant, 128×128

Rendered comparison: `check.png`
Reference: `source128.png` and `source16.png` (unaltered copies of the extension's existing bitmap icons).
Use: image edit. Generate at 1024×1024 or nearest 1:1, then export a 128×128 transparent canvas with the artwork contained in the centered 96×96 area.
Attach: `source128.png`. Optionally attach `check.png` to show the competing store icons.

## Prompt

```text
Refine the attached existing icon for AI Translator, a browser extension that translates text and web pages. Retain its forest-green #263027 rounded-square tile and bold warm-gold #E9BA63 four-ray sparkle, with the small gold dot at upper right. Flat shapes, no fine lines.
Put the complete artwork within a centered 96×96 region of a 128×128 transparent canvas, leaving exactly 16 pixels of clear padding on every side. Do not let the background tile reach the canvas edges. Preserve thick shapes that remain recognizable at 16×16.
Keep the forest-and-gold identity visually distinct from the competitor icons: blue letter tiles, a blue globe, a magenta translation tile and a cyan translation tile. Do not imitate those colours or marks.
No letters, words, new glyphs, extra sparkles, 3D, perspective, texture, bevels, border, drop shadow, logos or awards. This is an optional design proposal, not a replacement for the extension icon.
```

## Check before using

- Transparent 128×128 canvas; artwork limited to 96×96 with a 16 px clear margin.
- Forest #263027 and gold #E9BA63 retained, thick simple sparkle readable at 16 px on a dark toolbar.
- Compare a generated proposal against the existing icon in the check sheet before accepting it.
- Image generators can alter shapes and spacing; reject outputs that add detail. The current extension icon is unchanged.

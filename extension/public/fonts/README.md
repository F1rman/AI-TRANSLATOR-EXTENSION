# Bundled interface fonts

Manrope (normal, variable weight 200–800) and Rubik (normal, variable weight
300–900) are bundled locally so the extension does not contact a font service.
Each family includes Latin, extended Latin, Cyrillic (including Ukrainian), and
extended Cyrillic WOFF2 subsets. Use a separate `@font-face` declaration per
subset, with the matching `unicode-range` and variable weight range.

Downloaded from the Google Fonts CSS API on 2026-10-27:
https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&family=Rubik:wght@300..900&display=swap

Google Fonts serves Manrope v20 from `https://fonts.gstatic.com/s/manrope/v20/`
and Rubik v31 from `https://fonts.gstatic.com/s/rubik/v31/`.

| Subset | `unicode-range` (both families) |
| --- | --- |
| `latin` | `U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD` |
| `latin-ext` | `U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF` |
| `cyrillic` | `U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116` |
| `cyrillic-ext` | `U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F` |

The unmodified fonts are licensed under SIL Open Font License 1.1. Their license
and copyright notices are in `Manrope-OFL.txt` and `Rubik-OFL.txt`, copied from
the corresponding family directories in https://github.com/google/fonts/tree/main/ofl.

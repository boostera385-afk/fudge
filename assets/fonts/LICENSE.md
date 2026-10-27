# Bundled typefaces

Both families are subset to latin + latin-ext as variable `woff2` and are shipped
inside the extension so no network request is made at runtime.

| File | Family | Axis | Licence |
|---|---|---|---|
| `inter-latin.woff2`, `inter-latin-ext.woff2` | Inter | `wght 400–700` | SIL Open Font License 1.1 |
| `grotesk-latin.woff2`, `grotesk-latin-ext.woff2` | Space Grotesk | `wght 500–700` | SIL Open Font License 1.1 |

- Inter — Rasmus Andersson. <https://github.com/rsms/inter>
- Space Grotesk — Florian Karsten. <https://github.com/floriankarsten/space-grotesk>

The SIL OFL permits bundling and redistribution inside this extension provided the
fonts are not sold on their own and the licence notice travels with them.

Inter carries the UI and all body copy; Space Grotesk carries the wordmark,
headings and every number (`.num`, which also sets `font-variant-numeric: tabular-nums`).

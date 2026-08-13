# Frontend Single-File Build — Architecture & Fix History

## Goal

`fe/` builds to a **single `dist/index.html`** with zero additional runtime
script requests for the app's own JS modules. This is enforced by the CI
smoke test, which fails if any `/js/*.js` request 404s or if more than one
JS payload is fetched for the app bundle.

`vite-plugin-singlefile` is in `fe/vite.config.js` specifically to produce
this single-file output. Its job is to inline everything that passes through
Vite's own module/asset pipeline into `dist/index.html`.

## Root cause of the recurring 404s

`vite-plugin-singlefile` **only inlines assets Vite itself processes**
(ES module imports, processed CSS, etc.). It does **not** inline static files
that live in `publicDir` and are referenced via plain
`<script src="...">` tags — those are copied to `dist/` verbatim and remain
separate HTTP requests, by design of both Vite and the plugin.

The 11 frontend modules (`state.js`, `ui.js`, `session.js`, `employees.js`,
`requests.js`, `salary.js`, `vacations.js`, `insurance.js`, `dochub.js`,
`charts.js`, `app.js`) were kept as classic (non-module) scripts sharing a
global scope, and referenced via `<script src="./js/*.js">` in
`fe/src/index.html`. That's incompatible with the single-file goal: no matter
how correctly `publicDir`/`outDir` are configured, or how the script paths
are written (relative vs. absolute), the browser will always make 11 separate
requests for those files. If any deploy/preview environment doesn't expose
`dist/js/` correctly, every one of those requests 404s — which is exactly
what the smoke test kept catching.

Several earlier fix attempts targeted symptoms instead of this root cause:
- Moving the 11 files into `fe/public/js/` so `publicDir` copies them (correct
  as far as it goes, but doesn't eliminate the extra requests).
- Pinning `publicDir`/`outDir` to absolute paths in `vite.config.js` (fixes a
  real config bug, but orthogonal to the single-file requirement).
- Fixing the `vite-plugin-singlefile` import name (`viteSingleFile`, not
  `singleFile`) — a real bug, unrelated to the 404s.
- Restoring `../config.js` / `../api.js` relative paths after an accidental
  regression — unrelated to the `/js/*.js` 404s, but broke Google Sign-In
  separately in the process.

None of these could resolve the smoke test failure, because the failure was
never about paths or copy timing — it was about the architecture requiring
11 external requests while the build tooling promises zero.

## Chosen fix: inline concatenation via a custom Vite plugin

Rather than rewriting all 11 files into real ES modules (high blast radius —
every `onclick="..."` handler across the HTML and every shared global like
`employees` in `state.js` would need export/import wiring, with no way to
verify correctness without a real build), the fix is a small custom Vite
plugin added to `fe/vite.config.js`:

- Hooks `transformIndexHtml`.
- Reads the 11 files from `fe/public/js/` **in the exact order** they were
  previously `<script src>`-included (order matters: later files reference
  functions/variables defined in earlier ones, since they share one global
  scope).
- Concatenates their contents and injects them as a single inline
  `<script>` block right before `</body>` in the emitted `dist/index.html`.
- Runs identically in `vite dev` and `vite build`.

`fe/src/index.html` no longer has the 11 `<script src="./js/*.js">` tags —
the plugin injects their code directly. Every other script tag
(`../config.js`, `../api.js`, the Chart.js and Google Identity Services CDN
tags) is unchanged; those are intentionally excluded from inlining because
they're either external CDN scripts or come from outside the Vite build root.

This preserves every file's internal code byte-for-byte (no functional
rewrite, no new risk of breaking global references) while satisfying the
true single-file / zero-extra-request requirement the smoke test checks for.

## Files touched by this fix

- `fe/vite.config.js` — added the `inlineAppScripts()` plugin.
- `fe/src/index.html` — removed the 11 `<script src="./js/*.js">` lines.

## Non-goals / things intentionally left alone

- `fe/public/js/*.js` files themselves are unchanged (still classic global
  scripts, not ES modules). They remain in `fe/public/js/` as the plugin's
  source of truth; they are simply no longer requested directly by the
  browser.
- `publicDir`/`outDir` absolute-path pinning from the earlier fix stays as-is
  — it's still correct and needed for any other files placed under
  `fe/public/` (e.g. static assets, favicons) that should be copied normally.
- `../config.js` / `../api.js` relative paths stay as-is (outside the Vite
  build root, loaded from the deploy root as before).

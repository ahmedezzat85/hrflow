# Frontend Single-File Build — Architecture & Fix History

## Goal

`fe/` builds to a **single `dist/index.html`** with zero additional runtime
script requests for the app's own JS modules, and `dist/` must be a fully
self-contained, deployable folder on its own. This is enforced by the CI
smoke test.

## Root cause of the recurring 404s (JS modules)

`vite-plugin-singlefile` **only inlines assets Vite itself processes**
(ES module imports, processed CSS, etc.). It does **not** inline static files
that live in `publicDir` and are referenced via plain `<script src="...">`
tags — those are copied to `dist/` verbatim and remain separate HTTP
requests, by design of both Vite and the plugin.

The 11 frontend modules (`state.js`, `ui.js`, `session.js`, `employees.js`,
`requests.js`, `salary.js`, `vacations.js`, `insurance.js`, `dochub.js`,
`charts.js`, `app.js`) are classic (non-module) scripts sharing a global
scope. No path or `publicDir`/`outDir` fix could satisfy the single-file /
zero-extra-request goal while they remained external `<script src>` tags.

**Fix**: a custom Vite plugin (`singleFileDeployBundle`, in
`fe/vite.config.js`) hooks `transformIndexHtml`, reads the 11 files from
`fe/public/js/` in their original load order (order matters — they share
one global scope), and injects their concatenated contents as a single
inline `<script>` block before `</body>`. The corresponding
`<script src="./js/*.js">` tags were removed from `fe/src/index.html`.
Every file's internal code is unchanged byte-for-byte.

## Second gap: dist/ wasn't self-contained (config.js, api.js, images)

Even with the JS modules inlined, `dist/` was still missing files needed
to actually run the app once deployed:

- `fe/src/index.html` references `../config.js` and `../api.js`. That's
  correct **only** for `vite dev`, where the dev server root is `fe/src/`
  and those files live one level up, in `fe/`. `vite build` / `vite preview`
  only ever serve `outDir` (`fe/dist/`) — they never reach one level above
  it — so in any built/deployed output those two script tags pointed
  nowhere.
- `voyance-health-logo.png` and `voyance-logo-v.png` are referenced by
  **bare filename** in `index.html`, meaning they must be siblings of
  `index.html`. They live in `fe/`, are not in `publicDir`, and were never
  copied into `dist/`.

A pre-existing, unrelated bug was found while wiring up the copy list: the
actual file in the repo is `Voyance-health-logo.png` (capital V), but
`index.html` references `voyance-health-logo.png` (lowercase). Invisible on
case-insensitive filesystems (macOS/Windows dev machines), but a real 404
on any case-sensitive static host (most Linux-based hosts).

**Fix**: the same `singleFileDeployBundle` plugin adds a `closeBundle` hook
(runs once after Vite finishes writing `dist/`) that:
- Copies `api.js` and `config.js` (if present at build time) into `dist/`.
- Copies both logo images into `dist/`, renaming
  `Voyance-health-logo.png` → `voyance-health-logo.png` on the way, fixing
  the casing bug.
- The plugin's `transformIndexHtml` hook also rewrites `../config.js` /
  `../api.js` → `./config.js` / `./api.js`, but **only when building**
  (`config.command === 'build'`) — dev mode is untouched and keeps `../`,
  since the dev server root really is one level below `fe/`.

A `closeBundle` hook was used instead of a separate npm `postbuild` /
shell script, since shell copy commands (`cp`) aren't portable to Windows
CI images; keeping the logic inside the existing Vite plugin also avoids a
second source of truth for the file list.

### Known caveat: config.js

`config.js` does not exist in the repository (only `config.example.js` /
`config-example.js` templates do) — it's expected to be generated at
deploy time from secrets/environment values. The copy step copies it
**if present** at build time and emits a build warning (not a failure) if
it's missing. Whether `fe/config.js` exists before `npm run build` runs is
a CI/deploy-pipeline concern outside the scope of this fix.

## Files touched

- `fe/vite.config.js` — the `singleFileDeployBundle` plugin (inlining +
  path rewriting + sibling file copy).
- `fe/src/index.html` — the 11 `<script src="./js/*.js">` lines removed
  (now inlined); `../config.js` / `../api.js` kept as-is in source (correct
  for dev; rewritten to `./` only in the build output by the plugin).

## Non-goals / things intentionally left alone

- `fe/public/js/*.js` files themselves are unchanged (still classic global
  scripts, not ES modules) — they remain the plugin's source of truth for
  inlining.
- `publicDir`/`outDir` absolute-path pinning stays as-is — still correct
  and needed for any other files placed under `fe/public/`.
- No change to how `config.js` is generated/provisioned in CI — that's a
  separate deploy-pipeline concern.

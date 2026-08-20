import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const APP_SCRIPT_ORDER = [
  'state.js',
  'ui.js',
  'session.js',
  'employees.js',
  'requests.js',
  'salary.js',
  'invoices.js',
  'vacations.js',
  'insurance.js',
  'dochub.js',
  'charts.js',
  'app.js',
];

// Files that live directly in fe/ and that the built dist/index.html
// expects to find in its own directory, matching the legacy fe/index.html
// deployment layout (one flat folder). None of these go through Vite's
// module or publicDir pipeline - config.js in particular is typically
// generated at deploy time from config.example.js and intentionally not
// committed - so they must be copied explicitly on build. `dest` lets us
// fix the pre-existing voyance-health-logo.png casing mismatch (actual
// file is Voyance-health-logo.png) on the way into dist/.
const DEPLOY_SIBLING_FILES = [
  { src: 'api.js', dest: 'api.js' },
  { src: 'config.js', dest: 'config.js' },
  { src: 'Voyance-health-logo.png', dest: 'voyance-health-logo.png' },
  { src: 'voyance-logo-v.png', dest: 'voyance-logo-v.png' },
];

// Single plugin handling everything needed to produce a working, fully
// self-contained dist/ deployment folder. See
// docs/frontend-singlefile-plan.md for the full writeup.
//   1. Inlines the 11 classic app scripts from public/js/ directly into
//      index.html (vite-plugin-singlefile does not inline publicDir files
//      referenced via <script src>, only Vite-bundled assets).
//   2. Rewrites ../config.js / ../api.js (correct in dev, where
//      fe/src/index.html is nested one level under the Vite root) to
//      ./config.js / ./api.js in the BUILD output only, since step 3
//      copies those files to be direct siblings of dist/index.html.
//   3. On closeBundle (after Vite finishes writing dist/), copies
//      config.js, api.js and the two logo images from fe/ into dist/, so
//      dist/ is a complete, deployable folder on its own.
function singleFileDeployBundle() {
  let outDir;
  let isBuild = false;
  return {
    name: 'single-file-deploy-bundle',
    configResolved(config) {
      outDir = config.build.outDir;
      isBuild = config.command === 'build';
    },
    transformIndexHtml(html) {
      const combined = APP_SCRIPT_ORDER
        .map((name) => readFileSync(resolve(__dirname, 'public/js', name), 'utf-8'))
        .join('\n;\n');
      let out = html.replace('</body>', `<script>\n${combined}\n</script>\n</body>`);
      if (isBuild) {
        out = out
          .replace('src="../config.js"', 'src="./config.js"')
          .replace('src="../api.js"', 'src="./api.js"');
      }
      return out;
    },
    closeBundle() {
      if (!isBuild) return;
      for (const { src, dest } of DEPLOY_SIBLING_FILES) {
        const srcPath = resolve(__dirname, src);
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, resolve(outDir, dest));
        } else {
          this.warn(`[single-file-deploy-bundle] ${src} not found in fe/ - dist/ will be missing it. Add it before deploying.`);
        }
      }
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src'),
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  plugins: [singleFileDeployBundle(), viteSingleFile()],
});

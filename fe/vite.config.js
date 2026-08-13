import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const APP_SCRIPT_ORDER = [
  'state.js',
  'ui.js',
  'session.js',
  'employees.js',
  'requests.js',
  'salary.js',
  'vacations.js',
  'insurance.js',
  'dochub.js',
  'charts.js',
  'app.js',
];

// Inlines the classic (non-module) app scripts from public/js/ directly into
// the emitted index.html as a single <script> block, so the single-file
// build has zero extra script requests. vite-plugin-singlefile only inlines
// assets that pass through Vite's own module/asset pipeline - it does not
// touch publicDir files referenced via <script src>, so those 11 files must
// be inlined explicitly here instead. Order matters: the files share one
// global scope and later files reference functions/variables defined in
// earlier ones. See docs/frontend-singlefile-plan.md for the full writeup.
function inlineAppScripts() {
  return {
    name: 'inline-app-scripts',
    transformIndexHtml(html) {
      const combined = APP_SCRIPT_ORDER
        .map((name) => readFileSync(resolve(__dirname, 'public/js', name), 'utf-8'))
        .join('\n;\n');
      return html.replace('</body>', `<script>\n${combined}\n</script>\n</body>`);
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
  plugins: [inlineAppScripts(), viteSingleFile()],
});

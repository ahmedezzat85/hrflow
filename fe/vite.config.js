import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Bundles the modular fe/src/ files into ONE self-contained index.html
// (JS + CSS inlined, no runtime fetches of separate files) at build time.
// Dev experience stays multi-file; the deployment artifact in fe/dist/
// remains a single HTML file, matching the existing deployment model.
//
// api.js is intentionally kept as its own top-level file (fe/api.js) and
// is NOT bundled - Vite's dev server and the build both treat it as an
// external script tag, consistent with how config.js is loaded today.
// This avoids re-plumbing the TokenStore/Api global wiring in this phase;
// revisit if/when api.js is converted to an ES module.
export default defineConfig({
  root: "src",
  publicDir: "../public",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  plugins: [viteSingleFile()],
});

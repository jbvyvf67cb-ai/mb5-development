import { defineConfig } from "vite";
import topLevelAwait from "vite-plugin-top-level-await";

// Config quirks carried over from the Joshua build (see DESIGN.md §"Gotchas"):
//  - base "./"        -> relative asset URLs, so GitHub Pages / subpath deploys work.
//  - publicDir assets -> static files served from /assets (referenced as ./...).
//  - Havok WASM needs top-level await at init, and must be excluded from
//    dep pre-bundling or the WASM glue breaks.
export default defineConfig({
  base: "./",
  publicDir: "assets",
  plugins: [topLevelAwait()],
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 4000,
  },
});

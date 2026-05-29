import { defineConfig } from "vite";

// Production (GitHub Pages) is served from https://<org>.github.io/linkproof-web/,
// so `npm run build` uses that base. `--mode preview` builds with base "/" so a
// local `vite preview` works at the root path (otherwise the sub-path base
// renders a blank page locally). The dataset runs in an ES-module Web Worker.
export default defineConfig(({ command, mode }) => ({
  base: command === "build" && mode !== "preview" ? "/linkproof-web/" : "/",
  worker: { format: "es" },
  build: { target: "es2022" },
}));

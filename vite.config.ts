import { defineConfig } from "vite";

// Production builds are served from the GitHub Pages sub-path
// https://<org>.github.io/linkproof-web/ , so assets need that base. Dev keeps
// "/" for convenience. The dataset runs in an ES-module Web Worker.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/linkproof-web/" : "/",
  worker: { format: "es" },
  build: { target: "es2022" },
}));

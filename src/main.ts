// 鏈證 LinkProof PWA — entry point.
import "./ui/styles.css";
import { Store } from "./app/state";
import { mountApp } from "./ui/view";

const root = document.getElementById("app");
if (root) {
  const store = new Store();
  mountApp(store, root);
  // Load cached dataset, render, then refresh from the public repo in the
  // background (first launch downloads + verifies; later launches are offline).
  void store.prepare();
}

// Register the offline service worker in production builds only (avoids
// interfering with the Vite dev server's HMR).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        /* SW registration is best-effort */
      });
  });
}

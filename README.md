# 鏈證 LinkProof — Web (PWA)

A Progressive Web App port of the 鏈證 LinkProof anti-fraud URL checker, for
iOS Safari users (no App Store account / native build required) and any desktop
browser.

> 點開前，先查證。 — Check the link before the tap.

## Status

Early build. The **parity-critical core** is in place and verified:

- `src/core/punycode.ts` — RFC 3492 encoder (port of the iOS hand-rolled one)
- `src/core/domain-policy.ts` — host + dataset-domain normalization, IDN, NFKC + ß→ss
- `src/core/url-normalizer.ts` — defang restore, IDN, tracking-param strip, hand-parsed URL
- `src/core/models.ts` — shared domain types + risk-level copy

Still to build: risk decision engine, local dataset store (IndexedDB + SHA-256),
UI screens, service worker, web manifest, GitHub Pages deploy.

## Parity contract

This PWA is the **third consumer** of the shared behaviour fixtures in
`linkproof/tests/parity/`. The same JSON drives the Swift (iOS) and Kotlin
(Android) tests. `tests/parity/url-normalization.json` here is a **copy** and
must stay in sync with the canonical file. Any divergence in URL normalization,
IDN handling, or defang restore will fail the parity test.

```
linkproof/tests/parity/*.json   ← canonical fixtures
        ├── iOS  XCTest          (Swift)
        ├── Android JUnit        (Kotlin)
        └── linkproof-web        (TypeScript, this repo)   ← copy, keep in sync
```

## Platform difference vs native apps

The PWA **cannot expand short URLs** (`bit.ly`, `reurl.cc`, …). Browsers cannot
do DNS resolution or cross-origin HEAD probing, so the native apps'
`ShortURLRedirectResolver` (and its SSRF defence) has no web equivalent. The PWA
detects a short URL as a heuristic signal and tells the user plainly that it
cannot see where the link leads — it does not silently pretend to.

## Develop

```sh
npm install
npm test          # run parity + unit tests (Vitest)
npm run typecheck # tsc --noEmit
npm run dev       # Vite dev server (once the UI lands)
npm run build     # production build to dist/
```

## Deploy

Target: **GitHub Pages, sub-path** `https://<org>.github.io/linkproof-web/`.
No custom domain. PWA uses hash routing to avoid 404s on sub-path refreshes.
Dataset refresh runs on app launch (iOS PWA background sync is unreliable).

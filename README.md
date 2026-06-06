# 鏈證 LinkProof — Web (PWA)

A Progressive Web App port of the 鏈證 LinkProof anti-fraud URL checker, for
iOS Safari users (no App Store account / native build required) and any desktop
or Android browser.

> 點開前，先查證。 — Check the link before the tap.

**Live:** https://openclaw-metis.github.io/linkproof-web/

## Why it matters

Online scams are one of Taiwan's largest sources of consumer financial harm, and
the most common attack is a single malicious link in a LINE message or SMS.
鏈證 LinkProof gives anyone a fast, private way to check a link **before** they
tap it — backed by Taiwan's public 165 government anti-fraud datasets and
PhishTank, with every check running on-device. This repository is the
open-source web/PWA client, so people can verify a link from any browser without
installing an app or handing their data to anyone. It shares its verdict logic
with the iOS and Android apps through cross-platform parity fixtures, and reads a
daily-refreshed, SHA-256-verified public threat dataset.

## What it does

Paste a suspicious URL (or a whole LINE/SMS message — even a *defanged* one like
`hxxps://006buy[.]store`). LinkProof normalizes it, checks it against Taiwan's
public fraud datasets, runs local heuristic signals, and gives a four-level
verdict with clear next steps. Everything runs on-device; nothing is uploaded.

## Verdicts

| Level | Colour | Meaning | Primary action |
| --- | --- | --- | --- |
| 已確認涉詐 confirmedScam | risk red | Matched official fraud data | Emergency steps (you may be a victim) |
| 高風險 highRisk | caution amber | Multiple fraud signals | Emergency steps |
| 需要查證 needsVerification | caution amber | Suspicious signal, unverified | **告訴 165** (report — likely not yet reported) |
| 未發現公開通報 noPublicReport | neutral grey | No match — **not** "safe" | **告訴 165** |

`noPublicReport` is deliberately **neutral grey, never green**: "no match" must
never read as "safe".

## Architecture

```
src/core/      parity-critical, framework-free, fully tested
  punycode.ts            RFC 3492 encoder (port of the iOS hand-rolled one)
  domain-policy.ts       host + dataset-domain normalization, IDN, NFKC + ß→ss
  url-normalizer.ts      defang restore, hand-parsed URL, tracking-param strip
  risk-decision-engine.ts heuristic signals, scoring, verdict + evidence
  external-signals.ts    merge official + external (non-official capped at highRisk)
  dataset-store.ts       fetch + SHA-256 verify + decode + IndexedDB cache + match
  report-builder.ts      165 summary + defanged shareable warning
  models.ts              shared domain types + bilingual copy
src/app/       state.ts (store + persistence), dataset-worker + dataset-client
src/ui/        i18n.ts, styles.css (design tokens), view.ts (screens + sheets)
```

The 12 MB dataset is fetched, SHA-256-verified, parsed, and indexed inside a
**Web Worker**, so the main thread never blocks. Matching uses a domain-suffix
index (O(labels) lookups) instead of scanning ~126k records.

## Parity contract

This PWA is the **third consumer** of the shared behaviour fixtures in
`linkproof/tests/parity/`. The same JSON drives the Swift (iOS) and Kotlin
(Android) tests. The copies in `tests/parity/` must stay in sync:

```
linkproof/tests/parity/*.json   ← canonical
        ├── iOS  XCTest          (Swift)
        ├── Android JUnit        (Kotlin)
        └── linkproof-web        (TypeScript, this repo)   ← copy, keep in sync
```

- `url-normalization.json` (25) · `heuristic-decisions.json` (16) ·
  `legitimate-domains.json` (10) · `external-merge.json` (7), plus dataset-store,
  report-builder, and store-resilience unit tests — **85 tests pass.**

## Platform difference vs native apps

The PWA **cannot expand short URLs** (`bit.ly`, `reurl.cc`, …): browsers cannot
do DNS resolution or cross-origin HEAD probing, so the native apps'
`ShortURLRedirectResolver` (and its SSRF defence) has no web equivalent. The PWA
detects a short URL as a heuristic signal and flags it plainly — it does not
silently pretend to follow it.

## Develop

```sh
npm install
npm test          # parity + unit tests (Vitest)
npm run typecheck # tsc --noEmit
npm run dev       # Vite dev server
npm run build     # production build to dist/
```

PWA icons (`public/icon-*.png`, `apple-touch-icon.png`) are the iOS app icon,
resized from `apps/ios/.../AppIcon.appiconset/AppIcon-1024x1024@1x.png`.

## Deploy

Pushing to `main` builds with Vite (base `/linkproof-web/`) and deploys `dist/`
to GitHub Pages via `.github/workflows/deploy.yml`. The dataset refreshes on
launch (every 6 h) and is cached in IndexedDB for offline use.

## Privacy

Check history and official-channel records are stored only in this browser's
`localStorage` and are never uploaded. The dataset is fetched read-only from the
public `linkproof-datasets` repo. LinkProof is not a government agency and never
submits reports for you — it only opens official channels you choose.

## License

MIT — see [LICENSE](LICENSE). © 2026 Openclaw-Metis.

Threat data is fetched from the public `linkproof-datasets` repo and its upstream
sources (Taiwan 165 open data, PhishTank) under their respective terms.

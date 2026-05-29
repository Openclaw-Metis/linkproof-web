// Unit tests for the dataset store. Not a cross-platform parity fixture, but
// verifies the port's decode (schema v1 + v2 compact), dataset normalization,
// domain-suffix + path-prefix matching, and the fetch -> SHA-256 verify ->
// cache -> apply update flow.

import { describe, it, expect } from "vitest";
import {
  DatasetStore,
  InMemoryDatasetCache,
  decodeDataset,
  domainSuffixes,
  parseManifest,
  sha256Hex,
  type FetchBytes,
} from "../src/core/dataset-store";
import { normalize } from "../src/core/url-normalizer";

const MANIFEST_URL = "https://example.com/data/manifest.json";
const DATASET_RESOLVED = "https://example.com/data/scam-datasets.json";

function utf8(text: string): ArrayBuffer {
  const u8 = new TextEncoder().encode(text);
  return u8.buffer.slice(0, u8.byteLength);
}

const DATASET_V2 = JSON.stringify({
  schemaVersion: 2,
  bundleVersion: "2026.01.01",
  fetchedAt: "2026-01-01T00:00:00Z",
  sources: [
    {
      id: "s_scam",
      riskLevel: "confirmedScam",
      sourceName: { zhTW: "停止解析涉詐網站", enUS: "Stopped-resolution scam site" },
      sourceURL: "https://data.gov.tw/dataset/176455",
      category: { zhTW: "涉詐網域", enUS: "Scam domain" },
    },
    {
      id: "s_phish",
      riskLevel: "highRisk",
      sourceName: { zhTW: "PhishTank 釣魚情資", enUS: "PhishTank phishing data" },
      sourceURL: "https://www.phishtank.com/",
      category: { zhTW: "釣魚網站", enUS: "Phishing site" },
    },
  ],
  records: [
    { domain: "evil.example.com", sourceID: "s_scam", datasetDate: "2026-01-01" },
    { domain: "phish.test", sourceID: "s_phish", datasetDate: "2026-01-02", pathPrefix: "/login" },
    // Invalid single-label domain: must be dropped by dataset normalization.
    { domain: "localhost", sourceID: "s_scam", datasetDate: "2026-01-03" },
  ],
});

function buildStore(opts?: { sha?: string; datasetVersion?: string; manifestText?: string }) {
  const cache = new InMemoryDatasetCache();
  const manifestText =
    opts?.manifestText ??
    JSON.stringify({
      schemaVersion: 1,
      datasetVersion: opts?.datasetVersion ?? "2026.01.01",
      datasetURL: "scam-datasets.json",
      sha256: opts?.sha ?? "PLACEHOLDER",
      publishedAt: "2026-01-01T00:00:00Z",
      minimumAppVersion: "0.1.0",
    });

  const responses = new Map<string, ArrayBuffer>([
    [MANIFEST_URL, utf8(manifestText)],
    [DATASET_RESOLVED, utf8(DATASET_V2)],
  ]);

  const fetchBytes: FetchBytes = async (url) => {
    const body = responses.get(url);
    if (!body) throw new Error(`unexpected fetch ${url}`);
    return body;
  };

  const store = new DatasetStore({ cache, manifestURL: MANIFEST_URL, fetchBytes });
  return { store, cache };
}

describe("decodeDataset", () => {
  it("expands schema v2 compact records and shares source fields", () => {
    const ds = decodeDataset(JSON.parse(DATASET_V2));
    expect(ds.bundleVersion).toBe("2026.01.01");
    // 3 input records, 1 dropped (localhost is a single-label invalid domain).
    expect(ds.records).toHaveLength(2);

    const evil = ds.records.find((r) => r.domain === "evil.example.com")!;
    expect(evil.source.riskLevel).toBe("confirmedScam");
    expect(evil.pathPrefix).toBe("");

    const phish = ds.records.find((r) => r.domain === "phish.test")!;
    expect(phish.source.riskLevel).toBe("highRisk");
    expect(phish.pathPrefix).toBe("/login");
  });

  it("decodes a schema v1 full-record dataset", () => {
    const v1 = JSON.stringify({
      bundleVersion: "v1",
      fetchedAt: "2026-01-01",
      records: [
        {
          domain: "scam.example",
          riskLevel: "confirmedScam",
          sourceName: { zhTW: "來源", enUS: "Source" },
          sourceURL: "https://x.example",
          datasetDate: "2026-01-01",
          category: { zhTW: "類別", enUS: "Category" },
        },
      ],
    });
    const ds = decodeDataset(JSON.parse(v1));
    expect(ds.records).toHaveLength(1);
    expect(ds.records[0]!.source.riskLevel).toBe("confirmedScam");
  });

  it("throws on duplicate or unknown compact source ids", () => {
    const dup = { schemaVersion: 2, bundleVersion: "v", fetchedAt: "", sources: [
      { id: "a", riskLevel: "highRisk", sourceName: { zhTW: "", enUS: "" }, sourceURL: "x", category: { zhTW: "", enUS: "" } },
      { id: "a", riskLevel: "highRisk", sourceName: { zhTW: "", enUS: "" }, sourceURL: "x", category: { zhTW: "", enUS: "" } },
    ], records: [] };
    expect(() => decodeDataset(dup)).toThrow();

    const unknown = { schemaVersion: 2, bundleVersion: "v", fetchedAt: "", sources: [], records: [
      { domain: "x.example", sourceID: "missing", datasetDate: "2026-01-01" },
    ] };
    expect(() => decodeDataset(unknown)).toThrow();
  });
});

describe("domainSuffixes", () => {
  it("enumerates label-boundary suffixes most-specific first", () => {
    expect(domainSuffixes("a.b.example.com")).toEqual([
      "a.b.example.com",
      "b.example.com",
      "example.com",
      "com",
    ]);
  });
});

describe("parseManifest", () => {
  it("returns null when required fields are missing", () => {
    expect(parseManifest({})).toBeNull();
    expect(parseManifest({ schemaVersion: 1 })).toBeNull();
  });
});

describe("DatasetStore.refreshFromRemote + matching", () => {
  async function freshUpdatedStore() {
    const sha = await sha256Hex(utf8(DATASET_V2));
    const { store, cache } = buildStore({ sha });
    const result = await store.refreshFromRemote();
    return { store, cache, result, sha };
  }

  it("verifies SHA-256, caches, and applies the dataset", async () => {
    const { store, cache, result } = await freshUpdatedStore();
    expect(result.kind).toBe("updated");
    const status = await store.currentStatus();
    expect(status.source).toBe("remoteCache");
    expect(status.version).toBe("2026.01.01");
    expect(status.recordCount).toBe(2);
    expect(await cache.read()).not.toBeNull();
  });

  it("matches exact domain, subdomain suffix, and path prefix", async () => {
    const { store } = await freshUpdatedStore();

    const exact = await store.evidenceFor(normalize("https://evil.example.com"));
    expect(exact).toHaveLength(1);
    expect(exact[0]!.riskLevel).toBe("confirmedScam");
    expect(exact[0]!.kind).toBe("officialDataset");

    const subdomain = await store.evidenceFor(normalize("https://login.evil.example.com/x"));
    expect(subdomain).toHaveLength(1);

    const pathHit = await store.evidenceFor(normalize("https://phish.test/login/session"));
    expect(pathHit).toHaveLength(1);
    expect(pathHit[0]!.matchedValue).toBe("phish.test/login");

    const pathMiss = await store.evidenceFor(normalize("https://phish.test/home"));
    expect(pathMiss).toHaveLength(0);

    const clean = await store.evidenceFor(normalize("https://google.com"));
    expect(clean).toHaveLength(0);
  });

  it("returns alreadyCurrent when the version is unchanged", async () => {
    const { store } = await freshUpdatedStore();
    const again = await store.refreshFromRemote();
    expect(again.kind).toBe("alreadyCurrent");
  });

  it("fails closed on checksum mismatch without applying", async () => {
    const { store } = buildStore({ sha: "0".repeat(64) });
    const result = await store.refreshFromRemote();
    expect(result.kind).toBe("failed");
    if (result.kind === "failed") expect(result.failure).toBe("checksumMismatch");
    expect((await store.currentStatus()).source).toBe("missing");
  });

  it("reports invalidManifest and invalidDataset", async () => {
    const badManifest = buildStore({ manifestText: "{}" });
    const r1 = await badManifest.store.refreshFromRemote();
    expect(r1.kind === "failed" && r1.failure).toBe("invalidManifest");

    const sha = await sha256Hex(utf8(DATASET_V2));
    const versionMismatch = buildStore({ sha, datasetVersion: "different-version" });
    const r2 = await versionMismatch.store.refreshFromRemote();
    expect(r2.kind === "failed" && r2.failure).toBe("invalidDataset");
  });

  it("loads a cached dataset on next launch without network", async () => {
    const { cache } = await freshUpdatedStore();
    const offlineFetch: FetchBytes = async () => {
      throw new Error("offline");
    };
    const offlineStore = new DatasetStore({ cache, manifestURL: MANIFEST_URL, fetchBytes: offlineFetch });
    const evidence = await offlineStore.evidenceFor(normalize("https://evil.example.com"));
    expect(evidence).toHaveLength(1);
    expect((await offlineStore.currentStatus()).source).toBe("remoteCache");
  });
});

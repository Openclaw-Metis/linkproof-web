// DatasetStore — fetch, verify, cache, and match the public risk dataset.
// Faithful port of apps/ios/.../Services/LocalRiskStore.swift (BundleRiskStore)
// plus the RiskDataset decode in LinkProofModels.swift.
//
// Differences from the native app, by necessity:
//   - The 12 MB dataset is NOT bundled into the web app; it is fetched on launch
//     from the public linkproof-datasets repo and cached in IndexedDB. First
//     launch needs network; afterwards the cache serves offline.
//   - SHA-256 uses Web Crypto (`crypto.subtle`) over the *raw* downloaded bytes,
//     not a hand-rolled digest, but verifies the same manifest checksum.
//   - Matching uses a domain-suffix index (O(labels) lookups) instead of a
//     linear scan over ~126k records. The matched set is identical to the
//     native linear `filter` (domain equal-or-subdomain + path prefix).
//   - Records keep the compact shape and share one source object per provider
//     by reference, so 126k records do not duplicate the localized source text.
//
// The store has no DOM dependency, so it can run on the main thread, inside a
// Web Worker, or under Vitest. `fetchBytes` and the cache are injectable.

import type { EvidenceRecord, LocalizedCopy, NormalizedURL, RiskLevel } from "./models";
import {
  normalizeDatasetDomain,
  normalizeDatasetPath,
  normalizePathForComparison,
} from "./domain-policy";

export const DEFAULT_MANIFEST_URL =
  "https://raw.githubusercontent.com/Openclaw-Metis/linkproof-datasets/main/manifest.json";

// --- Internal dataset model ------------------------------------------------

interface DatasetSource {
  readonly riskLevel: RiskLevel;
  readonly sourceName: LocalizedCopy;
  readonly sourceURL: string;
  readonly category: LocalizedCopy;
}

interface DatasetRecord {
  readonly domain: string; // normalized
  readonly pathPrefix: string; // normalized, "" when none
  readonly datasetDate: string;
  readonly source: DatasetSource; // shared by reference for schema v2
}

interface RiskDataset {
  readonly bundleVersion: string;
  readonly fetchedAt: string;
  readonly records: DatasetRecord[];
}

export interface RiskDatasetManifest {
  readonly schemaVersion: number;
  readonly datasetVersion: string;
  readonly datasetURL: string;
  readonly sha256: string;
  readonly publishedAt: string;
  readonly minimumAppVersion: string | null;
}

export type RiskDatasetSourceKind = "unloaded" | "bundled" | "remoteCache" | "missing";

export interface RiskDatasetStatus {
  readonly version: string;
  readonly fetchedAt: string;
  readonly source: RiskDatasetSourceKind;
  readonly recordCount: number;
}

export const UNLOADED_STATUS: RiskDatasetStatus = {
  version: "unloaded",
  fetchedAt: "",
  source: "unloaded",
  recordCount: 0,
};

export type RiskDatasetUpdateFailure =
  | "sourceUnavailable"
  | "network"
  | "invalidManifest"
  | "invalidDataset"
  | "checksumMismatch"
  | "cacheWriteFailed";

export type RiskDatasetUpdateResult =
  | { readonly kind: "updated"; readonly status: RiskDatasetStatus }
  | { readonly kind: "alreadyCurrent"; readonly status: RiskDatasetStatus }
  | { readonly kind: "failed"; readonly status: RiskDatasetStatus; readonly failure: RiskDatasetUpdateFailure };

// --- Cache abstraction ------------------------------------------------------

export interface CachedDataset {
  readonly datasetText: string;
  readonly version: string;
  readonly sha256: string;
  readonly fetchedAt: string;
  readonly publishedAt: string | null;
}

export interface DatasetCache {
  read(): Promise<CachedDataset | null>;
  write(entry: CachedDataset): Promise<void>;
}

export class InMemoryDatasetCache implements DatasetCache {
  private entry: CachedDataset | null = null;
  async read(): Promise<CachedDataset | null> {
    return this.entry;
  }
  async write(entry: CachedDataset): Promise<void> {
    this.entry = entry;
  }
}

// IndexedDB-backed cache for the browser / service worker.
export class IndexedDBDatasetCache implements DatasetCache {
  private static readonly DB_NAME = "linkproof";
  private static readonly STORE = "dataset";
  private static readonly KEY = "current";

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IndexedDBDatasetCache.DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IndexedDBDatasetCache.STORE)) {
          db.createObjectStore(IndexedDBDatasetCache.STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async read(): Promise<CachedDataset | null> {
    const db = await this.openDB();
    try {
      return await new Promise<CachedDataset | null>((resolve, reject) => {
        const tx = db.transaction(IndexedDBDatasetCache.STORE, "readonly");
        const req = tx.objectStore(IndexedDBDatasetCache.STORE).get(IndexedDBDatasetCache.KEY);
        req.onsuccess = () => resolve((req.result as CachedDataset | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  }

  async write(entry: CachedDataset): Promise<void> {
    const db = await this.openDB();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IndexedDBDatasetCache.STORE, "readwrite");
        tx.objectStore(IndexedDBDatasetCache.STORE).put(entry, IndexedDBDatasetCache.KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
}

// --- Manifest + dataset decoding -------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(value: unknown): string {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
}

function requireLocalizedCopy(value: unknown): LocalizedCopy {
  if (!isObject(value)) throw new Error("expected localized copy");
  return { zhTW: requireString(value.zhTW), enUS: requireString(value.enUS) };
}

function requireRiskLevel(value: unknown): RiskLevel {
  if (
    value === "confirmedScam" ||
    value === "highRisk" ||
    value === "needsVerification" ||
    value === "noPublicReport"
  ) {
    return value;
  }
  throw new Error(`unknown riskLevel ${String(value)}`);
}

export function parseManifest(json: unknown): RiskDatasetManifest | null {
  if (!isObject(json)) return null;
  try {
    const schemaVersion = json.schemaVersion;
    if (typeof schemaVersion !== "number") return null;
    return {
      schemaVersion,
      datasetVersion: requireString(json.datasetVersion),
      datasetURL: requireString(json.datasetURL),
      sha256: requireString(json.sha256),
      publishedAt: requireString(json.publishedAt),
      minimumAppVersion:
        typeof json.minimumAppVersion === "string" ? json.minimumAppVersion : null,
    };
  } catch {
    return null;
  }
}

/**
 * Decode a dataset JSON value into the normalized internal model. Mirrors the
 * Swift `RiskDataset` decoder: schema v2 expands the compact source/record
 * form; any other schema decodes full records. Records whose domain or path
 * fail dataset normalization are dropped (compactMap in Swift). Throws on
 * structural corruption (duplicate / unknown source id, missing fields).
 */
export function decodeDataset(json: unknown): RiskDataset {
  if (!isObject(json)) throw new Error("dataset must be an object");

  const bundleVersion = requireString(json.bundleVersion);
  const fetchedAt = requireString(json.fetchedAt);
  const schemaVersion = typeof json.schemaVersion === "number" ? json.schemaVersion : 1;

  const raw: { domain: string; pathPrefix: string; datasetDate: string; source: DatasetSource }[] = [];

  if (schemaVersion === 2) {
    const sourcesValue = json.sources;
    if (!Array.isArray(sourcesValue)) throw new Error("v2 dataset requires sources array");
    const sourcesById = new Map<string, DatasetSource>();
    for (const s of sourcesValue) {
      if (!isObject(s)) throw new Error("invalid source");
      const id = requireString(s.id);
      if (sourcesById.has(id)) throw new Error(`duplicate compact dataset source id ${id}`);
      sourcesById.set(id, {
        riskLevel: requireRiskLevel(s.riskLevel),
        sourceName: requireLocalizedCopy(s.sourceName),
        sourceURL: requireString(s.sourceURL),
        category: requireLocalizedCopy(s.category),
      });
    }

    const recordsValue = json.records;
    if (!Array.isArray(recordsValue)) throw new Error("v2 dataset requires records array");
    for (const r of recordsValue) {
      if (!isObject(r)) throw new Error("invalid record");
      const sourceId = requireString(r.sourceID);
      const source = sourcesById.get(sourceId);
      if (!source) throw new Error(`unknown compact dataset source id ${sourceId}`);
      raw.push({
        domain: requireString(r.domain),
        pathPrefix: typeof r.pathPrefix === "string" ? r.pathPrefix : "",
        datasetDate: requireString(r.datasetDate),
        source,
      });
    }
  } else {
    const recordsValue = json.records;
    if (!Array.isArray(recordsValue)) throw new Error("dataset requires records array");
    for (const r of recordsValue) {
      if (!isObject(r)) throw new Error("invalid record");
      raw.push({
        domain: requireString(r.domain),
        pathPrefix: typeof r.pathPrefix === "string" ? r.pathPrefix : "",
        datasetDate: requireString(r.datasetDate),
        source: {
          riskLevel: requireRiskLevel(r.riskLevel),
          sourceName: requireLocalizedCopy(r.sourceName),
          sourceURL: requireString(r.sourceURL),
          category: requireLocalizedCopy(r.category),
        },
      });
    }
  }

  const records: DatasetRecord[] = [];
  for (const r of raw) {
    const domain = normalizeDatasetDomain(r.domain);
    const pathPrefix = normalizeDatasetPath(r.pathPrefix);
    if (domain === null || pathPrefix === null) continue;
    records.push({ domain, pathPrefix, datasetDate: r.datasetDate, source: r.source });
  }

  return { bundleVersion, fetchedAt, records };
}

// --- SHA-256 (Web Crypto) ---------------------------------------------------

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this context");
  // Normalize to a plain (non-shared) ArrayBuffer so the digest input type is
  // unambiguous across TS lib versions.
  const data: ArrayBuffer =
    bytes instanceof Uint8Array
      ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      : bytes;
  const digest = await subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Matching ---------------------------------------------------------------

// Label-boundary suffixes of a host, most specific first:
// "a.b.example.com" -> ["a.b.example.com","b.example.com","example.com","com"].
export function domainSuffixes(domain: string): string[] {
  const labels = domain.split(".");
  const result: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    result.push(labels.slice(i).join("."));
  }
  return result;
}

function pathMatches(pathPrefix: string, comparisonPath: string): boolean {
  return pathPrefix.length === 0 || comparisonPath.startsWith(pathPrefix);
}

// --- Fetch abstraction ------------------------------------------------------

export type FetchBytes = (url: string) => Promise<ArrayBuffer>;

const defaultFetchBytes: FetchBytes = async (url) => {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.arrayBuffer();
};

function resolveDatasetURL(value: string, manifestURL: string): string {
  return new URL(value, manifestURL).toString();
}

// --- Store ------------------------------------------------------------------

export interface DatasetStoreOptions {
  cache: DatasetCache;
  manifestURL?: string | null;
  fetchBytes?: FetchBytes;
}

/**
 * The async surface the app talks to. `DatasetStore` implements it directly;
 * `WorkerDatasetClient` implements it over a Web Worker so the 12 MB fetch +
 * parse + index never touch the main thread.
 */
export interface DatasetService {
  load(): Promise<void>;
  evidenceFor(normalized: NormalizedURL): Promise<EvidenceRecord[]>;
  currentStatus(): Promise<RiskDatasetStatus>;
  currentBundleVersion(): Promise<string>;
  refreshFromRemote(): Promise<RiskDatasetUpdateResult>;
  isRemoteUpdateConfigured(): Promise<boolean>;
}

export class DatasetStore {
  private readonly cache: DatasetCache;
  private readonly manifestURL: string | null;
  private readonly fetchBytes: FetchBytes;

  private dataset: RiskDataset | null = null;
  private index: Map<string, DatasetRecord[]> = new Map();
  private status: RiskDatasetStatus = UNLOADED_STATUS;
  private loadPromise: Promise<void> | null = null;

  constructor(options: DatasetStoreOptions) {
    this.cache = options.cache;
    this.manifestURL = options.manifestURL === undefined ? DEFAULT_MANIFEST_URL : options.manifestURL;
    this.fetchBytes = options.fetchBytes ?? defaultFetchBytes;
  }

  /** Idempotent. Loads the cached dataset, or marks the store as missing. */
  async load(): Promise<void> {
    if (this.dataset) return;
    if (!this.loadPromise) this.loadPromise = this.loadOnce();
    await this.loadPromise;
  }

  private async loadOnce(): Promise<void> {
    let cached: CachedDataset | null = null;
    try {
      cached = await this.cache.read();
    } catch {
      cached = null;
    }

    if (cached) {
      try {
        this.apply(decodeDataset(JSON.parse(cached.datasetText)), "remoteCache");
        return;
      } catch {
        // Corrupt cache: fall through to missing.
      }
    }

    this.apply({ bundleVersion: "missing-bundle", fetchedAt: "", records: [] }, "missing");
  }

  async evidenceFor(normalized: NormalizedURL): Promise<EvidenceRecord[]> {
    await this.load();
    const comparisonPath = normalizePathForComparison(normalized.path);
    const matches: DatasetRecord[] = [];

    for (const candidate of domainSuffixes(normalized.domain)) {
      const bucket = this.index.get(candidate);
      if (!bucket) continue;
      for (const record of bucket) {
        if (pathMatches(record.pathPrefix, comparisonPath)) matches.push(record);
      }
    }

    return matches.map((record) => this.toEvidence(record));
  }

  async currentStatus(): Promise<RiskDatasetStatus> {
    await this.load();
    return this.status;
  }

  async currentBundleVersion(): Promise<string> {
    await this.load();
    return this.status.version;
  }

  isRemoteUpdateConfigured(): boolean {
    return this.manifestURL !== null;
  }

  async refreshFromRemote(): Promise<RiskDatasetUpdateResult> {
    await this.load();
    const previousVersion = this.status.version;

    if (!this.manifestURL) {
      return { kind: "failed", status: this.status, failure: "sourceUnavailable" };
    }

    try {
      const manifestBytes = await this.fetchBytes(this.manifestURL);
      const manifest = parseManifest(safeJsonParse(decodeUtf8(manifestBytes)));
      if (!manifest) {
        return { kind: "failed", status: this.status, failure: "invalidManifest" };
      }

      const datasetURL = resolveDatasetURL(manifest.datasetURL, this.manifestURL);
      const datasetBytes = await this.fetchBytes(datasetURL);

      const digest = await sha256Hex(datasetBytes);
      if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
        return { kind: "failed", status: this.status, failure: "checksumMismatch" };
      }

      const datasetText = decodeUtf8(datasetBytes);
      let decoded: RiskDataset;
      try {
        decoded = decodeDataset(JSON.parse(datasetText));
      } catch {
        return { kind: "failed", status: this.status, failure: "invalidDataset" };
      }

      if (decoded.bundleVersion !== manifest.datasetVersion) {
        return { kind: "failed", status: this.status, failure: "invalidDataset" };
      }

      try {
        await this.cache.write({
          datasetText,
          version: decoded.bundleVersion,
          sha256: manifest.sha256,
          fetchedAt: decoded.fetchedAt,
          publishedAt: manifest.publishedAt,
        });
      } catch {
        return { kind: "failed", status: this.status, failure: "cacheWriteFailed" };
      }

      this.apply(decoded, "remoteCache");
      return previousVersion === decoded.bundleVersion
        ? { kind: "alreadyCurrent", status: this.status }
        : { kind: "updated", status: this.status };
    } catch {
      return { kind: "failed", status: this.status, failure: "network" };
    }
  }

  private apply(dataset: RiskDataset, source: RiskDatasetSourceKind): void {
    this.dataset = dataset;
    this.index = new Map();
    for (const record of dataset.records) {
      const bucket = this.index.get(record.domain);
      if (bucket) bucket.push(record);
      else this.index.set(record.domain, [record]);
    }
    this.status = {
      version: dataset.bundleVersion,
      fetchedAt: dataset.fetchedAt,
      source,
      recordCount: dataset.records.length,
    };
  }

  private toEvidence(record: DatasetRecord): EvidenceRecord {
    return {
      kind: "officialDataset",
      riskLevel: record.source.riskLevel,
      providerId: null,
      sourceName: record.source.sourceName,
      sourceURL: record.source.sourceURL,
      datasetDate: record.datasetDate,
      category: record.source.category,
      matchedValue: record.pathPrefix.length === 0 ? record.domain : `${record.domain}${record.pathPrefix}`,
      summary: {
        zhTW: `命中 ${record.source.sourceName.zhTW}，資料日期 ${record.datasetDate}。`,
        enUS: `Matched ${record.source.sourceName.enUS}, dataset date ${record.datasetDate}.`,
      },
    };
  }
}

// --- helpers ---------------------------------------------------------------

function decodeUtf8(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Browser wiring: IndexedDB cache + default GitHub manifest + global fetch. */
export function createDatasetStore(): DatasetStore {
  return new DatasetStore({ cache: new IndexedDBDatasetCache() });
}

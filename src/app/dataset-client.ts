// Main-thread proxy to the dataset Web Worker. Implements DatasetService by
// round-tripping each call through postMessage with a request id.
//
// Resilience: if the worker fails to load or crashes (onerror / onmessageerror)
// or a call exceeds its timeout, the corresponding promises REJECT instead of
// hanging forever. The store treats a rejection as "dataset unavailable" and
// degrades to heuristic-only checks, so the UI never gets stuck.

import type { EvidenceRecord, NormalizedURL } from "../core/models";
import type {
  DatasetService,
  RiskDatasetStatus,
  RiskDatasetUpdateResult,
} from "../core/dataset-store";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// evidenceFor / status / load are quick; refreshFromRemote downloads ~12 MB so
// it gets a much longer ceiling.
const DEFAULT_TIMEOUT_MS = 25_000;
const REFRESH_TIMEOUT_MS = 180_000;

export class WorkerDatasetClient implements DatasetService {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private dead = false;

  constructor() {
    this.worker = new Worker(new URL("./dataset-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (
      event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>,
    ) => {
      const { id, ok, result, error } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error ?? "dataset worker error"));
    };
    this.worker.onerror = (event) => this.failAll(`dataset worker error: ${event.message || "load failed"}`);
    this.worker.onmessageerror = () => this.failAll("dataset worker message could not be deserialized");
  }

  private failAll(message: string): void {
    this.dead = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }

  private call<T>(method: string, payload?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    if (this.dead) return Promise.reject(new Error("dataset worker unavailable"));
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`dataset ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.worker.postMessage({ id, method, payload });
    });
  }

  load(): Promise<void> {
    return this.call<void>("load");
  }
  evidenceFor(normalized: NormalizedURL): Promise<EvidenceRecord[]> {
    return this.call<EvidenceRecord[]>("evidenceFor", normalized);
  }
  currentStatus(): Promise<RiskDatasetStatus> {
    return this.call<RiskDatasetStatus>("currentStatus");
  }
  currentBundleVersion(): Promise<string> {
    return this.call<string>("currentBundleVersion");
  }
  refreshFromRemote(): Promise<RiskDatasetUpdateResult> {
    return this.call<RiskDatasetUpdateResult>("refreshFromRemote", undefined, REFRESH_TIMEOUT_MS);
  }
  isRemoteUpdateConfigured(): Promise<boolean> {
    return this.call<boolean>("isRemoteUpdateConfigured");
  }
}

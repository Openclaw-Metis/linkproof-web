// Main-thread proxy to the dataset Web Worker. Implements DatasetService by
// round-tripping each call through postMessage with a request id.

import type { EvidenceRecord, NormalizedURL } from "../core/models";
import type {
  DatasetService,
  RiskDatasetStatus,
  RiskDatasetUpdateResult,
} from "../core/dataset-store";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class WorkerDatasetClient implements DatasetService {
  private readonly worker: Worker;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./dataset-worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const { id, ok, result, error } = event.data;
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (ok) entry.resolve(result);
      else entry.reject(new Error(error ?? "dataset worker error"));
    };
  }

  private call<T>(method: string, payload?: unknown): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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
    return this.call<RiskDatasetUpdateResult>("refreshFromRemote");
  }
  isRemoteUpdateConfigured(): Promise<boolean> {
    return this.call<boolean>("isRemoteUpdateConfigured");
  }
}

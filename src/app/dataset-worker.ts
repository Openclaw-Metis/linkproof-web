// Web Worker hosting the DatasetStore. The 12 MB dataset fetch, SHA-256 verify,
// JSON parse, normalization, and 126k-record index all run here, so the main
// thread (and the UI) never block. The page talks to it via WorkerDatasetClient.

import { createDatasetStore } from "../core/dataset-store";

const store = createDatasetStore();
const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface Request {
  id: number;
  method: "load" | "evidenceFor" | "currentStatus" | "currentBundleVersion" | "refreshFromRemote" | "isRemoteUpdateConfigured";
  payload?: unknown;
}

ctx.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    let result: unknown = null;
    switch (req.method) {
      case "load":
        await store.load();
        break;
      case "evidenceFor":
        result = await store.evidenceFor(req.payload as Parameters<typeof store.evidenceFor>[0]);
        break;
      case "currentStatus":
        result = await store.currentStatus();
        break;
      case "currentBundleVersion":
        result = await store.currentBundleVersion();
        break;
      case "refreshFromRemote":
        result = await store.refreshFromRemote();
        break;
      case "isRemoteUpdateConfigured":
        result = store.isRemoteUpdateConfigured();
        break;
    }
    ctx.postMessage({ id: req.id, ok: true, result });
  } catch (error) {
    ctx.postMessage({ id: req.id, ok: false, error: String(error) });
  }
};

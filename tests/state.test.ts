// Store resilience tests for the CODEX P1/P2 fixes:
//  - first-launch checks wait for the dataset, and degrade honestly if it never
//    loads (so an official scam is never silently shown as noPublicReport);
//  - a failing/hanging dataset worker degrades to heuristics instead of leaving
//    the UI stuck in "validating".

import { describe, it, expect } from "vitest";
import { Store } from "../src/app/state";
import type {
  DatasetService,
  RiskDatasetStatus,
  RiskDatasetUpdateResult,
} from "../src/core/dataset-store";
import type { EvidenceRecord, NormalizedURL } from "../src/core/models";

function makeStatus(source: RiskDatasetStatus["source"], version = "v1", recordCount = 0): RiskDatasetStatus {
  return { version, fetchedAt: "2026-01-01", source, recordCount };
}

const officialScam: EvidenceRecord = {
  kind: "officialDataset",
  riskLevel: "confirmedScam",
  providerId: null,
  sourceName: { zhTW: "165", enUS: "165" },
  sourceURL: "https://data.gov.tw",
  datasetDate: "2026-01-01",
  category: { zhTW: "涉詐", enUS: "Scam" },
  matchedValue: "scam.example",
  summary: { zhTW: "命中", enUS: "Matched" },
};

class FakeDataset implements DatasetService {
  status: RiskDatasetStatus;
  evidence: EvidenceRecord[] = [];
  throwOnEvidence = false;
  refreshSucceeds = true;

  constructor(initialSource: RiskDatasetStatus["source"]) {
    this.status = makeStatus(initialSource, initialSource === "missing" ? "missing-bundle" : "v1");
  }
  async load(): Promise<void> {}
  async evidenceFor(_normalized: NormalizedURL): Promise<EvidenceRecord[]> {
    if (this.throwOnEvidence) throw new Error("worker dead");
    return this.evidence;
  }
  async currentStatus(): Promise<RiskDatasetStatus> {
    return this.status;
  }
  async currentBundleVersion(): Promise<string> {
    return this.status.version;
  }
  async isRemoteUpdateConfigured(): Promise<boolean> {
    return true;
  }
  async refreshFromRemote(): Promise<RiskDatasetUpdateResult> {
    if (this.refreshSucceeds) {
      this.status = makeStatus("remoteCache", "v1", this.evidence.length);
      return { kind: "updated", status: this.status };
    }
    return { kind: "failed", status: this.status, failure: "network" };
  }
}

describe("Store dataset resilience", () => {
  it("uses official evidence once the first fetch completes (not degraded)", async () => {
    const fake = new FakeDataset("missing");
    fake.evidence = [officialScam];
    const store = new Store(fake);
    await store.prepare(); // first fetch succeeds -> remoteCache

    store.setRawInputSilent("scam.example");
    await store.submitCheck();

    const s = store.getState();
    expect(s.phase.kind).toBe("resolved");
    expect(s.currentResult?.riskLevel).toBe("confirmedScam");
    expect(s.lastCheckDegraded).toBe(false);
  });

  it("degrades honestly when the dataset never loads (offline first launch)", async () => {
    const fake = new FakeDataset("missing");
    fake.refreshSucceeds = false; // stays missing
    const store = new Store(fake);
    await store.prepare();

    store.setRawInputSilent("https://example.com/login");
    await store.submitCheck();

    const s = store.getState();
    expect(s.phase.kind).toBe("resolved");
    expect(s.lastCheckDegraded).toBe(true);
    // heuristic-only verdict, no false confirmedScam
    expect(s.currentResult?.riskLevel).toBe("noPublicReport");
  });

  it("does not hang when the worker fails mid-check (degrades to heuristics)", async () => {
    const fake = new FakeDataset("remoteCache");
    fake.throwOnEvidence = true;
    const store = new Store(fake);
    await store.prepare();

    store.setRawInputSilent("https://bit.ly/pay");
    await store.submitCheck();

    const s = store.getState();
    expect(s.phase.kind).toBe("resolved"); // not stuck in "validating"
    expect(s.currentResult?.riskLevel).toBe("highRisk"); // short-url + payment
    expect(s.lastCheckDegraded).toBe(true);
  });

  it("blocks on an unparseable URL", async () => {
    const fake = new FakeDataset("remoteCache");
    const store = new Store(fake);
    await store.prepare();

    store.setRawInputSilent("not a url");
    await store.submitCheck();

    expect(store.getState().phase.kind).toBe("blocked");
  });
});

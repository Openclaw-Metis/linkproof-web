// Parity test: external-signal merge must agree with the iOS / Android apps.
// Mirrors the external-merge.json fixture used by ExternalSignalCoordinatorTests.
//
// Fixture is COPIED from linkproof/tests/parity/ and MUST stay in sync.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  mergeExternalSignals,
  type ExternalProviderResult,
  type ExternalSignalResult,
} from "../src/core/external-signals";
import type { EvidenceRecord, RiskLevel } from "../src/core/models";

const here = dirname(fileURLToPath(import.meta.url));

interface MergeFixture {
  name: string;
  officialEvidence: { riskLevel: RiskLevel; providerId: string | null }[];
  externalResults: { providerId: string; kind: string; suggestedRisk?: RiskLevel }[];
  expectedFinalRisk: RiskLevel;
  expectedEvidenceOrder: string[];
}

const fixtures = JSON.parse(
  readFileSync(join(here, "parity", "external-merge.json"), "utf-8"),
) as MergeFixture[];

function stubEvidence(riskLevel: RiskLevel | null, providerId: string | null): EvidenceRecord {
  return {
    kind: "officialDataset",
    riskLevel,
    providerId,
    sourceName: { zhTW: "測試來源", enUS: "Test source" },
    sourceURL: null,
    datasetDate: "2026-01-01",
    category: { zhTW: "測試", enUS: "Test" },
    matchedValue: "example.com",
    summary: { zhTW: "測試", enUS: "Test" },
  };
}

function toResult(
  r: { providerId: string; kind: string; suggestedRisk?: RiskLevel },
): ExternalSignalResult {
  if (r.kind === "hit") {
    const risk = r.suggestedRisk ?? "needsVerification";
    return { kind: "hit", evidence: stubEvidence(risk, r.providerId), suggestedRisk: risk };
  }
  return { kind: r.kind as "clean" | "quotaExceeded" | "unavailable" };
}

function orderTag(e: EvidenceRecord): string {
  return e.providerId === null ? "official" : `external:${e.providerId}`;
}

describe("ExternalSignalCoordinator merge parity (external-merge.json)", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const official = fixture.officialEvidence.map((o) =>
        stubEvidence(o.riskLevel, o.providerId),
      );
      const external: ExternalProviderResult[] = fixture.externalResults.map((r) => ({
        providerId: r.providerId,
        result: toResult(r),
      }));

      const merged = mergeExternalSignals(official, external);

      expect(merged.finalRisk, `${fixture.name} finalRisk`).toBe(fixture.expectedFinalRisk);
      expect(merged.evidence.map(orderTag), `${fixture.name} order`).toEqual(
        fixture.expectedEvidenceOrder,
      );
    });
  }
});

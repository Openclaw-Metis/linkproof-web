// Parity test: the PWA's RiskDecisionEngine must agree with the iOS / Android
// apps. Mirrors RiskDecisionTests.testHeuristicDecisionParityFixtures and
// testLegitimateDomainParityFixturesStayNoPublicReport.
//
// These fixtures are COPIED from linkproof/tests/parity/ and MUST stay in sync.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize } from "../src/core/url-normalizer";
import { makeResult } from "../src/core/risk-decision-engine";
import type { RiskLevel } from "../src/core/models";

const here = dirname(fileURLToPath(import.meta.url));
function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(here, "parity", name), "utf-8")) as T;
}

interface HeuristicFixture {
  input: string;
  expectedRisk: RiskLevel;
  expectedSignals: string[];
}

interface LegitimateFixture {
  input: string;
  expectedRisk: RiskLevel;
}

describe("RiskDecisionEngine heuristic parity (heuristic-decisions.json)", () => {
  const fixtures = loadFixture<HeuristicFixture[]>("heuristic-decisions.json");
  for (const fixture of fixtures) {
    it(`decides: ${fixture.input}`, () => {
      const normalized = normalize(fixture.input);
      const result = makeResult(normalized.rawInput, normalized, [], "test");

      expect(result.riskLevel, fixture.input).toBe(fixture.expectedRisk);

      const first = result.evidence[0];
      expect(first, `${fixture.input} has evidence`).toBeDefined();
      for (const signal of fixture.expectedSignals) {
        expect(first!.matchedValue, `${fixture.input} missing ${signal}`).toContain(signal);
      }
      if (fixture.expectedSignals.length === 0) {
        expect(first!.kind, fixture.input).toBe("noMatch");
      }
    });
  }
});

describe("RiskDecisionEngine legitimate-domain parity (legitimate-domains.json)", () => {
  const fixtures = loadFixture<LegitimateFixture[]>("legitimate-domains.json");
  for (const fixture of fixtures) {
    it(`stays no-public-report: ${fixture.input}`, () => {
      const normalized = normalize(fixture.input);
      const result = makeResult(normalized.rawInput, normalized, [], "test");

      expect(result.riskLevel, fixture.input).toBe(fixture.expectedRisk);
      expect(result.evidence[0]?.kind, fixture.input).toBe("noMatch");
    });
  }
});

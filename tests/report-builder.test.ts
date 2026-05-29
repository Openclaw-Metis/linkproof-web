// Mirrors ReportSummaryBuilderTests: bilingual summary content, URL defanging,
// and the critical round-trip (a shared defanged warning re-parses cleanly,
// recovering the same domain/path and flagging it as defanged).

import { describe, it, expect } from "vitest";
import { buildReportSummary, buildWarningMessage, defangURL } from "../src/core/report-builder";
import { OFFICIAL_CHANNELS, type RiskLevel, type URLCheckResult } from "../src/core/models";
import { normalize } from "../src/core/url-normalizer";

function makeResult(url: string, riskLevel: RiskLevel, domain: string): URLCheckResult {
  return {
    id: "test-id",
    rawInput: url,
    normalizedURL: url,
    domain,
    riskLevel,
    evidence: [
      {
        kind: "officialDataset",
        riskLevel,
        providerId: null,
        sourceName: { zhTW: "165 涉詐網站資料集", enUS: "165 scam website dataset" },
        sourceURL: "https://data.gov.tw",
        datasetDate: "2026-05-16",
        category: { zhTW: "涉詐網域", enUS: "Scam domain" },
        matchedValue: domain,
        summary: { zhTW: "命中官方資料。", enUS: "Matched official data." },
      },
    ],
    checkedAt: "1970-01-01T00:00:00Z",
    bundleVersion: "test",
    defangedInput: null,
  };
}

const sampleResult = makeResult("https://fraud.example.com/login", "confirmedScam", "fraud.example.com");

describe("buildReportSummary", () => {
  it("includes government reporting context (zh-TW)", () => {
    const summary = buildReportSummary(sampleResult, OFFICIAL_CHANNELS[1]!, "zh-TW");
    expect(summary).toContain("鏈證給 165 的摘要");
    expect(summary).toContain("https://fraud.example.com/login");
    expect(summary).toContain("165 全民防騙網");
    expect(summary).toContain("命中官方資料");
    expect(summary).toContain("鏈證不是政府機關");
  });

  it("includes government reporting context (en-US)", () => {
    const summary = buildReportSummary(sampleResult, OFFICIAL_CHANNELS[0]!, "en-US");
    expect(summary).toContain("LinkProof 165 summary");
    expect(summary).toContain("https://fraud.example.com/login");
    expect(summary).toContain("Online fraud reporting portal");
    expect(summary).toContain("Matched official data");
    expect(summary).toContain("not a government agency");
  });
});

describe("buildWarningMessage defangs the URL", () => {
  const cases: { input: string; domain: string; mustNotContain: string[]; mustContain: string[] }[] = [
    { input: "https://example.com", domain: "example.com", mustNotContain: ["https://", "example.com"], mustContain: ["hxxps://", "example[.]com"] },
    { input: "https://006buy.store", domain: "006buy.store", mustNotContain: ["https://", "006buy.store"], mustContain: ["hxxps://", "006buy[.]store"] },
    { input: "http://example.com/login.html", domain: "example.com", mustNotContain: ["http://", "example.com", "login.html"], mustContain: ["hxxp://", "example[.]com", "login[.]html"] },
    { input: "https://sub.deep.example.co.uk/path", domain: "sub.deep.example.co.uk", mustNotContain: ["sub.deep.example.co.uk"], mustContain: ["sub[.]deep[.]example[.]co[.]uk"] },
  ];

  for (const c of cases) {
    it(`defangs ${c.input}`, () => {
      const message = buildWarningMessage(makeResult(c.input, "confirmedScam", c.domain), "zh-TW");
      expect(message).toContain("網址已防誤點處理");
      expect(message).toContain("請把原始訊息貼到鏈證");
      for (const forbidden of c.mustNotContain) {
        expect(message, `raw leaked: ${forbidden}`).not.toContain(forbidden);
      }
      for (const required of c.mustContain) {
        expect(message, `defanged missing: ${required}`).toContain(required);
      }
    });
  }

  it("explains the defanged URL in English", () => {
    const message = buildWarningMessage(
      makeResult("https://example.com/login", "needsVerification", "example.com"),
      "en-US",
    );
    expect(message).toContain("hxxps://example[.]com/login");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("example.com");
    expect(message).toContain("defanged to prevent accidental taps");
    expect(message).toContain("paste the original message into LinkProof");
  });
});

describe("warning message round-trips back through the URL normalizer", () => {
  const cases: { input: string; expectedDomain: string; expectedPath: string }[] = [
    { input: "https://006buy.store", expectedDomain: "006buy.store", expectedPath: "" },
    { input: "https://example.com/login/form.html", expectedDomain: "example.com", expectedPath: "/login/form.html" },
    { input: "https://xn--fiq228c.example", expectedDomain: "xn--fiq228c.example", expectedPath: "" },
    { input: "https://example.com:8080/path", expectedDomain: "example.com", expectedPath: "/path" },
  ];

  for (const c of cases) {
    it(`recovers ${c.input}`, () => {
      const result = makeResult(c.input, "confirmedScam", c.expectedDomain);
      const message = buildWarningMessage(result, "zh-TW");
      const reparsed = normalize(message);
      expect(reparsed.domain, "domain").toBe(c.expectedDomain);
      expect(reparsed.path, "path").toBe(c.expectedPath);
      expect(reparsed.defangedInput, "defang detected").not.toBeNull();
    });
  }

  it("defangURL leaves no bare scheme or dot", () => {
    expect(defangURL("https://a.b.c")).toBe("hxxps://a[.]b[.]c");
    expect(defangURL("HTTP://A.com")).toBe("hxxp://A[.]com");
  });
});

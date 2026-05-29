// ExternalSignalCoordinator — merge official dataset evidence with optional
// third-party reputation providers (Safe Browsing, VirusTotal, ...).
// Faithful port of apps/ios/.../Services/ExternalSignalCoordinator.swift.
//
// PARITY CONTRACT: drives tests/parity/external-merge.json.
//
// Core invariant: a non-official source can never produce `confirmedScam`. Any
// external "hit" suggesting confirmedScam is capped to highRisk. Official
// evidence is ordered first; `clean` / `quotaExceeded` / `unavailable` results
// contribute no evidence and do not raise the verdict.
//
// The PWA ships with no live providers (like the iOS app's mock), so by default
// `mergeExternalSignals([...], [])` is a no-op pass-through. The merge logic is
// ported in full so the invariant stays under test and future providers slot in.

import type { EvidenceKind, EvidenceRecord, RiskLevel, URLCheckResult } from "./models";

export type ExternalSignalResult =
  | { readonly kind: "hit"; readonly evidence: EvidenceRecord; readonly suggestedRisk: RiskLevel }
  | { readonly kind: "clean" }
  | { readonly kind: "quotaExceeded" }
  | { readonly kind: "unavailable" };

export interface ExternalProviderResult {
  readonly providerId: string;
  readonly result: ExternalSignalResult;
}

export interface ExternalSignalMergeResult {
  readonly finalRisk: RiskLevel;
  readonly evidence: EvidenceRecord[];
}

export function mergeExternalSignals(
  officialEvidence: readonly EvidenceRecord[],
  externalResults: readonly ExternalProviderResult[],
): ExternalSignalMergeResult {
  const official = officialEvidence.map((e) =>
    withProvider(e, { providerId: null, kind: "officialDataset" }),
  );

  const external = externalResults.flatMap((pr) => {
    if (pr.result.kind !== "hit") return [];
    return [
      withProvider(pr.result.evidence, {
        providerId: pr.providerId,
        kind: "externalSignal",
        riskLevel: sanitizedExternalRisk(pr.result.suggestedRisk),
      }),
    ];
  });

  const externalRisks = externalResults.flatMap((pr) =>
    pr.result.kind === "hit" ? [sanitizedExternalRisk(pr.result.suggestedRisk)] : [],
  );

  const finalRisk = mergedRisk(riskLevelFromEvidence(official), externalRisks);
  return { finalRisk, evidence: [...official, ...external] };
}

/**
 * Combine an external merge result into a base (heuristic/official) check
 * result. No-op when no external evidence is present.
 */
export function applyMerge(
  merge: ExternalSignalMergeResult,
  result: URLCheckResult,
): URLCheckResult {
  const externalEvidence = merge.evidence.filter((e) => e.providerId !== null);
  if (externalEvidence.length === 0) return result;

  const baseEvidence = result.evidence.filter(
    (e) => e.providerId === null && e.kind !== "noMatch",
  );
  const riskLevel = maxRisk(result.riskLevel, merge.finalRisk);

  return {
    ...result,
    riskLevel,
    evidence: [...baseEvidence, ...externalEvidence],
  };
}

function withProvider(
  evidence: EvidenceRecord,
  opts: { providerId: string | null; kind?: EvidenceKind; riskLevel?: RiskLevel | null },
): EvidenceRecord {
  return {
    ...evidence,
    providerId: opts.providerId,
    kind: opts.kind ?? evidence.kind,
    // Mirrors Swift `riskLevel ?? self.riskLevel` (nil keeps the original).
    riskLevel: opts.riskLevel ?? evidence.riskLevel,
  };
}

function riskLevelFromEvidence(evidence: readonly EvidenceRecord[]): RiskLevel {
  if (evidence.some((e) => e.riskLevel === "confirmedScam")) return "confirmedScam";
  if (evidence.some((e) => e.riskLevel === "highRisk")) return "highRisk";
  if (evidence.some((e) => e.riskLevel === "needsVerification")) return "needsVerification";
  return "noPublicReport";
}

function mergedRisk(officialRisk: RiskLevel, externalRisks: RiskLevel[]): RiskLevel {
  if (officialRisk === "confirmedScam") return "confirmedScam";
  return externalRisks.reduce((partial, risk) => maxRisk(partial, risk), officialRisk);
}

function sanitizedExternalRisk(riskLevel: RiskLevel): RiskLevel {
  return riskLevel === "confirmedScam" ? "highRisk" : riskLevel;
}

function maxRisk(lhs: RiskLevel, rhs: RiskLevel): RiskLevel {
  return riskRank(lhs) >= riskRank(rhs) ? lhs : rhs;
}

function riskRank(riskLevel: RiskLevel): number {
  switch (riskLevel) {
    case "confirmedScam":
      return 3;
    case "highRisk":
      return 2;
    case "needsVerification":
      return 1;
    case "noPublicReport":
      return 0;
  }
}

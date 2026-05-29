// 鏈證 LinkProof — core domain model
// Faithful TypeScript port of apps/ios/.../Domain/LinkProofModels.swift
// and apps/android/.../core/Models.kt.
//
// PARITY CONTRACT: behaviour here must match the iOS / Android apps so that
// the same tests/parity/*.json fixtures pass on all three platforms.

export type AppLanguage = "zh-TW" | "en-US";

export type RiskLevel =
  | "confirmedScam"
  | "highRisk"
  | "needsVerification"
  | "noPublicReport";

export type EvidenceKind =
  | "officialDataset"
  | "localHeuristic"
  | "externalSignal"
  | "noMatch";

export interface LocalizedCopy {
  readonly zhTW: string;
  readonly enUS: string;
}

export function localized(copy: LocalizedCopy, language: AppLanguage): string {
  return language === "zh-TW" ? copy.zhTW : copy.enUS;
}

export interface NormalizedURL {
  readonly rawInput: string;
  readonly normalizedURL: string;
  readonly domain: string;
  readonly path: string;
  readonly isShortURL: boolean;
  /**
   * The original defanged form the user pasted (e.g. `hxxps://006buy[.]store`),
   * preserved when the input had to be restored before parsing. `null` when the
   * input was not defanged.
   */
  readonly defangedInput: string | null;
}

export interface EvidenceRecord {
  readonly kind: EvidenceKind;
  readonly riskLevel: RiskLevel | null;
  readonly providerId: string | null;
  readonly sourceName: LocalizedCopy;
  readonly sourceURL: string | null;
  readonly datasetDate: string;
  readonly category: LocalizedCopy;
  readonly matchedValue: string;
  readonly summary: LocalizedCopy;
}

export interface URLCheckResult {
  readonly id: string;
  readonly rawInput: string;
  readonly normalizedURL: string;
  readonly domain: string;
  readonly riskLevel: RiskLevel;
  readonly evidence: readonly EvidenceRecord[];
  readonly checkedAt: string; // ISO-8601
  readonly bundleVersion: string;
  readonly defangedInput: string | null;
}

// --- Risk level copy (parity with RiskLevel.title / .guidance) -------------

export function riskTitle(level: RiskLevel, language: AppLanguage): string {
  const map: Record<RiskLevel, LocalizedCopy> = {
    confirmedScam: { zhTW: "已確認涉詐", enUS: "Confirmed scam" },
    highRisk: { zhTW: "高風險", enUS: "High risk" },
    needsVerification: { zhTW: "需要查證", enUS: "Needs verification" },
    noPublicReport: { zhTW: "未發現公開通報", enUS: "No public report found" },
  };
  return localized(map[level], language);
}

export function riskGuidance(level: RiskLevel, language: AppLanguage): string {
  const map: Record<RiskLevel, LocalizedCopy> = {
    confirmedScam: {
      zhTW: "不要輸入個資、付款資訊或驗證碼。",
      enUS: "Do not enter personal data, payment details, or verification codes.",
    },
    highRisk: {
      zhTW: "建議先核對官方網址，並避免在此連結輸入資料。",
      enUS: "Verify the official website first and avoid entering information on this link.",
    },
    needsVerification: {
      zhTW: "目前有可疑訊號，請先透過官方管道查證。",
      enUS: "Suspicious signals were found. Check through official channels first.",
    },
    noPublicReport: {
      zhTW: "目前公開資料未命中，但這不代表安全。",
      enUS: "Current public sources did not match, but this does not mean the link is safe.",
    },
  };
  return localized(map[level], language);
}

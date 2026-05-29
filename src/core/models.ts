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

/**
 * RFC-4122 identifier. Uses the Web Crypto `randomUUID` when available
 * (browsers and Node 18+), with a deterministic-shape fallback otherwise.
 */
export function newId(): string {
  const c: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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

// --- Report channels (parity with ReportChannel.officialChannels) ----------

export type ReportChannelKind = "fraudPortal" | "police165" | "investigationBureau";

export interface ReportChannel {
  readonly id: ReportChannelKind;
  readonly title: LocalizedCopy;
  readonly detail: LocalizedCopy;
  readonly officialURL: string;
}

export const OFFICIAL_CHANNELS: readonly ReportChannel[] = [
  {
    id: "fraudPortal",
    title: { zhTW: "網詐通報查詢網", enUS: "Online fraud reporting portal" },
    detail: {
      zhTW: "適合告知可疑網路詐騙訊息；若需要正式報案，網站會引導至 165。",
      enUS: "For suspicious online-fraud reports. For formal police reports, the site directs users to 165.",
    },
    officialURL: "https://fraudbuster.digiat.org.tw/accessibility/circular",
  },
  {
    id: "police165",
    title: { zhTW: "165 全民防騙網／報案檢舉", enUS: "165 anti-fraud reporting" },
    detail: {
      zhTW: "適合詐騙報案或檢舉；已受害或有急迫風險時請直接撥打 165。",
      enUS: "For fraud reports and complaints. Call 165 directly if harm has occurred or the risk is urgent.",
    },
    officialURL: "https://165.npa.gov.tw/#/report/statement",
  },
  {
    id: "investigationBureau",
    title: { zhTW: "刑事警察局線上檢舉信箱", enUS: "Criminal Investigation Bureau mailbox" },
    detail: {
      zhTW: "適合補充案件細節、證據與後續查詢。",
      enUS: "For case details, supporting evidence, and follow-up inquiry.",
    },
    officialURL: "https://www.cib.npa.gov.tw/ch/app/folder/2065",
  },
];

export interface ReportRecord {
  readonly id: string;
  readonly checkId: string;
  readonly channel: ReportChannel;
  readonly openedAt: string; // ISO-8601
  readonly normalizedURL: string;
  readonly statusText: LocalizedCopy;
}

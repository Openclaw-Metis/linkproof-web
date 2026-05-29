// RiskDecisionEngine — verdict + evidence from a normalized URL.
// Faithful port of apps/ios/.../Services/RiskDecisionEngine.swift.
//
// PARITY CONTRACT: drives tests/parity/heuristic-decisions.json and
// legitimate-domains.json on all three platforms. The signal codes, weights,
// structural flags, evaluation order, and scoring thresholds must match the
// Swift/Kotlin engines exactly.
//
// Scoring (no official/external evidence):
//   - a "structural" signal (short URL, punycode, high-abuse TLD, subdomain
//     spoof) with total score >= 2  -> highRisk
//   - total score >= 3 (regardless of structural)               -> highRisk
//   - any structural signal otherwise                            -> needsVerification
//   - otherwise (incl. 1-2 non-structural signals)              -> noPublicReport
//
// Signals are only *surfaced* (in the localHeuristic evidence's matchedValue)
// when the verdict is highRisk or needsVerification; a noPublicReport verdict
// always emits a single `noMatch` evidence record. This is why a URL like
// `paypal.com/login/pay/verify` (2 non-structural signals, no structural)
// resolves to noPublicReport with no surfaced signals.

import {
  newId,
  type EvidenceRecord,
  type LocalizedCopy,
  type NormalizedURL,
  type RiskLevel,
  type URLCheckResult,
} from "./models";

interface HeuristicSignal {
  readonly code: string;
  readonly weight: number;
  readonly isStructural: boolean;
  readonly title: LocalizedCopy;
}

export function makeResult(
  rawInput: string,
  normalized: NormalizedURL,
  matchedEvidence: readonly EvidenceRecord[],
  bundleVersion: string,
): URLCheckResult {
  const riskLevel = decideRiskLevel(normalized, matchedEvidence);
  const evidence = evidenceForResult(normalized, matchedEvidence, riskLevel);

  return {
    id: newId(),
    rawInput,
    normalizedURL: normalized.normalizedURL,
    domain: normalized.domain,
    riskLevel,
    evidence,
    checkedAt: new Date().toISOString(),
    bundleVersion,
    defangedInput: normalized.defangedInput,
  };
}

export function decideRiskLevel(
  normalized: NormalizedURL,
  evidence: readonly EvidenceRecord[],
): RiskLevel {
  if (evidence.some((e) => e.riskLevel === "confirmedScam")) return "confirmedScam";
  if (evidence.some((e) => e.riskLevel === "highRisk")) return "highRisk";
  if (evidence.length > 0) return "needsVerification";

  const signals = heuristicSignals(normalized);
  const signalScore = signals.reduce((score, signal) => score + signal.weight, 0);
  const hasStructuralSignal = signals.some((s) => s.isStructural);

  if (hasStructuralSignal && signalScore >= 2) return "highRisk";
  if (signalScore >= 3) return "highRisk";
  if (hasStructuralSignal) return "needsVerification";
  return "noPublicReport";
}

function evidenceForResult(
  normalized: NormalizedURL,
  matchedEvidence: readonly EvidenceRecord[],
  riskLevel: RiskLevel,
): EvidenceRecord[] {
  if (matchedEvidence.length > 0) return [...matchedEvidence];

  const signals = heuristicSignals(normalized);
  if (riskLevel === "highRisk" || riskLevel === "needsVerification") {
    return [
      {
        kind: "localHeuristic",
        riskLevel: null,
        providerId: null,
        sourceName: { zhTW: "本機風險規則", enUS: "Local risk rules" },
        sourceURL: null,
        datasetDate: "local",
        category: { zhTW: "可疑網址特徵", enUS: "Suspicious URL signals" },
        matchedValue:
          signals.length === 0
            ? normalized.domain
            : signals.map((s) => s.code).join(","),
        summary: heuristicSummary(signals),
      },
    ];
  }

  return [
    {
      kind: "noMatch",
      riskLevel: null,
      providerId: null,
      sourceName: { zhTW: "本機公開資料包", enUS: "Local public-data bundle" },
      sourceURL: null,
      datasetDate: "latest bundled sample",
      category: { zhTW: "未命中公開資料", enUS: "No public-data match" },
      matchedValue: normalized.domain,
      summary: {
        zhTW: "目前資料包與本機規則沒有命中此網域；這不代表安全。請仍確認網址拼字、網域與官方管道。",
        enUS: "The dataset and local rules did not match this domain; this does not mean it is safe. Still verify the spelling, domain, and official channel.",
      },
    },
  ];
}

function heuristicSignals(normalized: NormalizedURL): HeuristicSignal[] {
  const domain = normalized.domain.toLowerCase();
  const path = normalized.path.toLowerCase();
  const decodedPath = safeDecode(path);
  const pathTokens = asciiTokens(decodedPath);
  const signals: HeuristicSignal[] = [];

  if (normalized.isShortURL) {
    signals.push({
      code: "short-url",
      weight: 1,
      isStructural: true,
      title: { zhTW: "短網址", enUS: "short URL" },
    });
  }

  if (domain.split(".").some((label) => label.startsWith("xn--"))) {
    signals.push({
      code: "punycode-domain",
      weight: 1,
      isStructural: true,
      title: {
        zhTW: "可能混淆的國際化網域",
        enUS: "possible lookalike internationalized domain",
      },
    });
  }

  if (usesHighAbuseTopLevelDomain(domain)) {
    signals.push({
      code: "high-abuse-tld",
      weight: 1,
      isStructural: true,
      title: {
        zhTW: "需額外查證的網域結尾",
        enUS: "top-level domain that needs extra verification",
      },
    });
  }

  if (
    containsAnyToken(pathTokens, [
      "login", "signin", "account", "password", "verify", "otp", "auth", "secure",
    ]) ||
    containsAnySubstring(decodedPath, [
      "登入", "登录", "驗證", "验证", "密碼", "密码", "帳號", "账号",
    ])
  ) {
    signals.push({
      code: "credential-or-otp",
      weight: 1,
      isStructural: false,
      title: { zhTW: "登入、驗證或一次性密碼", enUS: "login, verification, or OTP" },
    });
  }

  if (
    containsAnyToken(pathTokens, [
      "pay", "payment", "checkout", "card", "bank", "atm", "transfer",
    ]) ||
    containsAnySubstring(decodedPath, [
      "付款", "支付", "轉帳", "转账", "銀行", "银行", "信用卡", "匯款", "汇款",
    ])
  ) {
    signals.push({
      code: "payment",
      weight: 1,
      isStructural: false,
      title: { zhTW: "付款、金融或轉帳", enUS: "payment, banking, or transfer" },
    });
  }

  if (
    containsAnyToken(pathTokens, [
      "invest", "investment", "stock", "crypto", "forex", "loan", "fund", "profit",
    ]) ||
    containsAnySubstring(decodedPath, [
      "投資", "投资", "股票", "加密貨幣", "加密货币", "貸款", "贷款", "獲利", "获利",
    ])
  ) {
    signals.push({
      code: "investment",
      weight: 1,
      isStructural: false,
      title: { zhTW: "投資、貸款或獲利話術", enUS: "investment, loan, or profit terms" },
    });
  }

  if (
    containsAnyToken(pathTokens, [
      "promo", "gift", "coupon", "bonus", "reward", "free", "lucky", "prize", "limited",
    ]) ||
    containsAnySubstring(decodedPath, [
      "優惠", "活动", "活動", "贈品", "赠品", "限時", "限时", "抽獎", "抽奖", "獎品", "奖品",
    ])
  ) {
    signals.push({
      code: "promotion",
      weight: 1,
      isStructural: false,
      title: { zhTW: "活動、贈品或限時優惠", enUS: "promotion, gift, or limited offer" },
    });
  }

  if (looksLikeAccountSubdomainSpoof(domain)) {
    signals.push({
      code: "subdomain-spoof",
      weight: 2,
      isStructural: true,
      title: { zhTW: "可疑多層子網域偽裝", enUS: "suspicious multi-level subdomain" },
    });
  }

  return signals;
}

function heuristicSummary(signals: HeuristicSignal[]): LocalizedCopy {
  const zhSignals = signals.map((s) => s.title.zhTW).join("、");
  const enSignals = signals.map((s) => s.title.enUS).join(", ");
  return {
    zhTW: `偵測到：${zhSignals}。請先透過官方管道查證，避免輸入個資、付款資料或驗證碼。`,
    enUS: `Detected: ${enSignals}. Verify through official channels before entering personal data, payment details, or verification codes.`,
  };
}

function containsAnyToken(tokens: string[], terms: string[]): boolean {
  const set = new Set(terms);
  return tokens.some((t) => set.has(t));
}

function containsAnySubstring(value: string, terms: string[]): boolean {
  return terms.some((t) => value.includes(t));
}

function looksLikeAccountSubdomainSpoof(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 4) return false;
  const subdomain = labels.slice(0, labels.length - 2).join(".");
  return (
    containsAnySubstring(subdomain, ["login", "secure", "verify", "account", "bank"]) ||
    containsAnyToken(asciiTokens(subdomain), ["tw"])
  );
}

function usesHighAbuseTopLevelDomain(domain: string): boolean {
  const parts = domain.split(".");
  const tld = parts[parts.length - 1];
  if (tld === undefined || tld.length === 0) return false;
  return [
    "top", "xyz", "icu", "click", "shop", "store", "cc", "vip",
    "win", "loan", "buzz", "cyou", "monster", "sbs", "skin",
    "beauty", "support", "site",
  ].includes(tld);
}

// Mirrors Swift `split { !$0.isASCIIAlphanumeric }` (omits empty subsequences).
// CJK and other non-ASCII characters act as separators, so a purely CJK path
// yields no tokens and is matched via containsAnySubstring instead.
function asciiTokens(value: string): string[] {
  return value.split(/[^a-z0-9]+/i).filter((t) => t.length > 0);
}

// Mirrors Swift `removingPercentEncoding ?? self`. The normalized path is
// already percent-decoded by the URL normalizer, so this is normally a no-op;
// the try/catch guards a literal "%" that is not valid encoding.
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

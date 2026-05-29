// ReportSummaryBuilder + WarningMessageBuilder.
// Faithful port of apps/ios/.../Services/ReportSummaryBuilder.swift.
//
// - buildReportSummary: a plain-text summary the user can hand to 165 / an
//   official channel (the app never submits on the user's behalf).
// - buildWarningMessage: a shareable warning whose URL is DEFANGED
//   (hxxps://, [.]) so a relative cannot accidentally tap it. It tells the
//   recipient to paste the *original* message back into 鏈證 to verify — the
//   defanged form round-trips cleanly through the URL normalizer.

import {
  localized,
  riskTitle,
  type AppLanguage,
  type ReportChannel,
  type URLCheckResult,
} from "./models";

export function buildReportSummary(
  result: URLCheckResult,
  channel: ReportChannel,
  language: AppLanguage,
): string {
  const t = (key: SummaryTextKey) => summaryText(key, language);

  const lines: string[] = [
    t("title"),
    `${t("checkedAt")}: ${formatInternetDate(result.checkedAt)}`,
    `${t("riskLevel")}: ${riskTitle(result.riskLevel, language)}`,
    `${t("url")}: ${result.normalizedURL}`,
    `${t("domain")}: ${result.domain}`,
    `${t("channel")}: ${localized(channel.title, language)}`,
    `${t("channelURL")}: ${channel.officialURL}`,
  ];

  if (result.evidence.length > 0) {
    lines.push(t("evidence"));
    for (const evidence of result.evidence.slice(0, 3)) {
      lines.push(`- ${localized(evidence.sourceName, language)}: ${localized(evidence.summary, language)}`);
    }
  }

  lines.push(`${t("noticeLabel")}: ${t("noticeBody")}`);
  return lines.join("\n");
}

export function buildWarningMessage(result: URLCheckResult, language: AppLanguage): string {
  const evidence = result.evidence[0];
  const sourceName = evidence ? localized(evidence.sourceName, language) : fallbackEvidenceSource(language);
  const sourceDate = evidenceContextLabel(evidence?.datasetDate, language);
  const safeURL = defangURL(result.normalizedURL);
  const verdict = riskTitle(result.riskLevel, language);

  if (language === "zh-TW") {
    return [
      "鏈證 LinkProof 查核結果",
      "-----",
      `網址：${safeURL}`,
      "網址已防誤點處理，請不要還原後打開。如需查證，請把原始訊息貼到鏈證。",
      `判定：${verdict}`,
      `依據：${sourceName}（${sourceDate}）`,
      "",
      zhTWGuidance(result.riskLevel),
      "",
      "— 鏈證 LinkProof",
    ].join("\n");
  }

  return [
    "LinkProof check result",
    "-----",
    `URL: ${safeURL}`,
    "The URL is defanged to prevent accidental taps. Do not restore and open it. To verify, paste the original message into LinkProof.",
    `Verdict: ${verdict}`,
    `Evidence: ${sourceName} (${sourceDate})`,
    "",
    enUSGuidance(result.riskLevel),
    "",
    "- LinkProof",
  ].join("\n");
}

/**
 * Defang a URL so it cannot be tapped: hxxps:// scheme + every "." -> "[.]".
 * Mirrors the Swift anchored, case-insensitive scheme replacement.
 */
export function defangURL(url: string): string {
  let out = url;
  if (/^https:\/\//i.test(out)) {
    out = `hxxps://${out.slice("https://".length)}`;
  } else if (/^http:\/\//i.test(out)) {
    out = `hxxp://${out.slice("http://".length)}`;
  }
  return out.replace(/\./g, "[.]");
}

// --- summary copy -----------------------------------------------------------

type SummaryTextKey =
  | "title" | "checkedAt" | "riskLevel" | "url" | "domain"
  | "channel" | "channelURL" | "evidence" | "noticeLabel" | "noticeBody";

function summaryText(key: SummaryTextKey, language: AppLanguage): string {
  const map: Record<SummaryTextKey, { zhTW: string; enUS: string }> = {
    title: { zhTW: "鏈證給 165 的摘要", enUS: "LinkProof 165 summary" },
    checkedAt: { zhTW: "查核時間", enUS: "Checked at" },
    riskLevel: { zhTW: "風險等級", enUS: "Risk level" },
    url: { zhTW: "網址", enUS: "URL" },
    domain: { zhTW: "網域", enUS: "Domain" },
    channel: { zhTW: "官方管道", enUS: "Official channel" },
    channelURL: { zhTW: "官方網址", enUS: "Official URL" },
    evidence: { zhTW: "判定依據", enUS: "Evidence" },
    noticeLabel: { zhTW: "提醒", enUS: "Notice" },
    noticeBody: {
      zhTW: "鏈證不是政府機關，實際提供內容與送出仍以官方網站為準。",
      enUS: "LinkProof is not a government agency. Final content and submission remain on the official website.",
    },
  };
  return language === "zh-TW" ? map[key].zhTW : map[key].enUS;
}

// Mirrors Swift ISO8601DateFormatter([.withInternetDateTime]): no fractional
// seconds. result.checkedAt is already an ISO-8601 string.
function formatInternetDate(checkedAt: string): string {
  const date = new Date(checkedAt);
  if (Number.isNaN(date.getTime())) return checkedAt;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

// --- warning copy -----------------------------------------------------------

function fallbackEvidenceSource(language: AppLanguage): string {
  return language === "zh-TW" ? "鏈證即時判定" : "LinkProof live decision";
}

function evidenceContextLabel(value: string | undefined, language: AppLanguage): string {
  if (!value || value.length === 0) {
    return language === "zh-TW" ? "即時判定" : "Live decision";
  }
  switch (value.toLowerCase()) {
    case "local":
      return language === "zh-TW" ? "本機規則" : "Local rules";
    case "latest bundled sample":
      return language === "zh-TW" ? "本機資料包" : "Bundled dataset";
    default:
      return value;
  }
}

function zhTWGuidance(risk: URLCheckResult["riskLevel"]): string {
  switch (risk) {
    case "confirmedScam":
      return "這個網址已在公開資料中命中。\n不要點，不要轉帳，不要輸入個資。\n如果已經點過：撥打 165 求助。";
    case "highRisk":
      return "鏈證偵測到這個網址有多項詐騙特徵。\n不要點，先到真正的官方網站確認。\n如果不確定：撥打 165 諮詢。";
    case "needsVerification":
      return "這個網址有可疑訊號，還不能確認安全。\n先不要輸入 OTP、帳密或信用卡資料。\n請先透過官方網站或 165 查證。";
    case "noPublicReport":
      return "公開資料目前沒有命中，但這不代表安全。\n仍請確認網址拼字、網域與官方管道。\n如果對方催促匯款或要求驗證碼，請撥打 165。";
  }
}

function enUSGuidance(risk: URLCheckResult["riskLevel"]): string {
  switch (risk) {
    case "confirmedScam":
      return "This URL matched public fraud data.\nDo not open it, send money, or enter personal data.\nIf it was already opened, call 165 for help.";
    case "highRisk":
      return "LinkProof detected multiple fraud signals in this URL.\nDo not open it. Verify through the real official website first.\nIf unsure, call 165 for advice.";
    case "needsVerification":
      return "This URL has suspicious signals and is not verified as safe.\nDo not enter OTPs, passwords, or card details.\nVerify through the official website or 165 first.";
    case "noPublicReport":
      return "No public report matched, but that does not mean it is safe.\nStill check the spelling, domain, and official channel.\nIf someone pressures payment or asks for codes, call 165.";
  }
}

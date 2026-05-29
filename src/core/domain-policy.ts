// DomainPolicy — host + dataset-domain normalization.
// Faithful port of the `DomainPolicy` enum in
// apps/ios/.../Services/URLNormalizer.swift.

import { punycodeEncode } from "./punycode";

export type URLNormalizationErrorCode =
  | "emptyInput"
  | "noURLFound"
  | "unsupportedScheme"
  | "missingHost"
  | "invalidURL";

export class URLNormalizationError extends Error {
  constructor(readonly code: URLNormalizationErrorCode) {
    super(code);
    this.name = "URLNormalizationError";
  }

  message_(language: "zh-TW" | "en-US"): string {
    const map: Record<URLNormalizationErrorCode, { zhTW: string; enUS: string }> = {
      emptyInput: { zhTW: "請貼上或輸入要查核的網址。", enUS: "Paste or enter a URL to check." },
      noURLFound: { zhTW: "找不到可查核的網址。", enUS: "No checkable URL was found." },
      unsupportedScheme: { zhTW: "目前只支援 http 或 https 網址。", enUS: "Only http and https URLs are supported." },
      missingHost: { zhTW: "網址缺少網域名稱。", enUS: "The URL is missing a domain name." },
      invalidURL: { zhTW: "網址格式無法解析，請重新確認。", enUS: "The URL could not be parsed. Please check it again." },
    };
    const copy = map[this.code];
    return language === "zh-TW" ? copy.zhTW : copy.enUS;
  }
}

const BLOCKED_PUBLIC_SUFFIX_RECORDS = new Set<string>([
  "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw", "mil.tw", "idv.tw",
  "co.uk", "org.uk", "ac.uk", "gov.uk",
  "co.jp", "ne.jp", "or.jp",
  "com.au", "net.au", "org.au",
  "co.kr", "or.kr",
]);

function isDigit(cp: number): boolean {
  return cp >= 48 && cp <= 57;
}

function isASCIILetter(cp: number): boolean {
  return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
}

function isLabelChar(cp: number): boolean {
  return isDigit(cp) || isASCIILetter(cp) || cp === 45; // 45 == '-'
}

function isValidASCIILabel(label: string): boolean {
  if (label.length < 1 || label.length > 63) return false;
  if (label.startsWith("-") || label.endsWith("-")) return false;
  for (const ch of label) {
    if (!isLabelChar(ch.codePointAt(0) as number)) return false;
  }
  return true;
}

function isValidTopLevelDomain(label: string): boolean {
  if (label.length < 2 || label.length > 24) return false;
  if (label.startsWith("xn--")) return isValidASCIILabel(label);
  for (const ch of label) {
    if (!isASCIILetter(ch.codePointAt(0) as number)) return false;
  }
  return true;
}

// Mirrors Swift `precomposedStringWithCompatibilityMapping` (NFKC) + ß->ss.
function prepareIDNLabel(label: string): string {
  return label.normalize("NFKC").replace(/ß/g, "ss");
}

function isAllASCII(label: string): boolean {
  for (const ch of label) {
    if ((ch.codePointAt(0) as number) >= 0x80) return false;
  }
  return true;
}

function toASCIILabel(label: string): string {
  if (isAllASCII(label)) {
    if (!isValidASCIILabel(label)) throw new URLNormalizationError("invalidURL");
    return label;
  }
  const encoded = punycodeEncode(label);
  if (encoded === null) throw new URLNormalizationError("invalidURL");
  const ascii = `xn--${encoded}`;
  if (ascii.length > 63) throw new URLNormalizationError("invalidURL");
  return ascii;
}

function trimDots(value: string): string {
  return value.replace(/^\.+/, "").replace(/\.+$/, "");
}

export function normalizeHost(host: string): string {
  const trimmed = trimDots(host.toLowerCase());
  if (trimmed.length === 0) throw new URLNormalizationError("missingHost");

  const labels = trimmed.split(".").map(prepareIDNLabel);
  if (labels.some((label) => label.length === 0)) {
    throw new URLNormalizationError("invalidURL");
  }

  const asciiHost = labels.map(toASCIILabel).join(".");
  if (asciiHost.length > 253) throw new URLNormalizationError("invalidURL");

  if (asciiHost.startsWith("www.") && asciiHost.length > 4) {
    return asciiHost.slice(4);
  }
  return asciiHost;
}

export function isValidDatasetDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((label) => label.length === 0)) return false;
  if (BLOCKED_PUBLIC_SUFFIX_RECORDS.has(domain)) return false;

  const tld = labels[labels.length - 1] as string;
  if (!isValidTopLevelDomain(tld)) return false;

  return labels.every((label) => {
    if (label.length < 1 || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    for (const ch of label) {
      if (!isLabelChar(ch.codePointAt(0) as number)) return false;
    }
    return true;
  });
}

export function normalizeDatasetDomain(domain: string): string | null {
  let normalized: string;
  try {
    normalized = normalizeHost(domain);
  } catch {
    return null;
  }
  return isValidDatasetDomain(normalized) ? normalized : null;
}

function decodePercent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function normalizeDatasetPath(pathPrefix: string): string | null {
  const trimmed = pathPrefix.trim();
  if (trimmed.length === 0) return "";
  const candidate = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return decodePercent(candidate);
}

export function normalizePathForComparison(path: string): string {
  return decodePercent(path) ?? path;
}

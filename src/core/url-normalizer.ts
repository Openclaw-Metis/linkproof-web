// URLNormalizer — defang restore + IDN normalization + tracking-param strip.
// Faithful port of `URLNormalizer` in
// apps/ios/.../Services/URLNormalizer.swift.
//
// We hand-parse the URL instead of using `new URL()` because the browser's URL
// parser eagerly punycodes the host (and adds a trailing "/" to empty paths),
// which diverges from the iOS `URLComponents` behaviour the parity fixtures
// were generated against. Hand-parsing lets us:
//   - keep the raw Unicode host and run our own DomainPolicy.normalizeHost,
//   - preserve the original percent-encoding in the output URL,
//   - return an empty path (not "/") when the input had none.

import type { NormalizedURL } from "./models";
import { URLNormalizationError, normalizeHost } from "./domain-policy";

const TRACKING_QUERY_NAMES = new Set<string>([
  "fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "msclkid", "_hsenc", "_hsmi",
]);

const SHORT_URL_HOSTS = new Set<string>([
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "reurl.cc",
  "is.gd", "cutt.ly", "ow.ly", "shorturl.at", "lihi.cc",
]);

const TRAILING_PUNCTUATION = new Set<string>([
  ".", ",", ";", "!", "?", ")", ">", "]", "}",
  "、", "。", "，", "！", "？", "」", "』", "】", "）",
]);

// Matches either a scheme URL or a bare domain (optionally with port/path).
// Note: no leading \b — JS \b is ASCII-only and would refuse to start a match
// on a leading CJK character, unlike Swift/ICU. The greedy label group makes
// the boundary unnecessary.
const URL_PATTERN =
  /([a-z][a-z0-9+.\-]*:\/\/[^\s<>"'，。！？、]+|(?:[\p{L}\p{N}\-]+\.)+[\p{L}]{2,}(?::\d+)?(?:\/[^\s<>"'，。！？、]*)?)/iu;

const DEFANGED_URL_PATTERN =
  /((?:hxxps?|https?):\/\/[^\s<>"'，！？、]+|(?:[\p{L}\p{N}\-]+(?:\.|\s*\[\.\]\s*|\s*\[\s*dot\s*\]\s*|\s*\(\s*dot\s*\)\s*|[。．]))+[\p{L}]{2,}(?::\d+)?(?:\/[^\s<>"'，。！？、]*)?)/iu;

interface DefangRestoration {
  text: string;
  didRestore: boolean;
}

interface ParsedURL {
  scheme: string;
  host: string; // raw, possibly Unicode, no port, no brackets for IPv6
  port: string | null;
  rawPath: string; // percent-encoded form, may be ""
  query: string | null; // raw query after "?", before "#"
}

export function normalize(input: string): NormalizedURL {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new URLNormalizationError("emptyInput");

  const restoration = restoreDefangedText(trimmed);
  let candidate = extractFirstURL(restoration.text);
  if (candidate === null) throw new URLNormalizationError("noURLFound");

  const defangedInput = restoration.didRestore ? extractFirstDefangedURL(trimmed) : null;

  if (!candidate.includes("://")) {
    candidate = `https://${candidate}`;
  }

  const parsed = parseURLComponents(candidate);
  if (parsed === null) throw new URLNormalizationError("invalidURL");

  const scheme = parsed.scheme.toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    throw new URLNormalizationError("unsupportedScheme");
  }
  if (parsed.host.length === 0) {
    throw new URLNormalizationError("missingHost");
  }

  const host = normalizeHost(parsed.host);
  const filteredQuery = filterQuery(parsed.query);

  const portPart = parsed.port !== null ? `:${parsed.port}` : "";
  const queryPart = filteredQuery !== null ? `?${filteredQuery}` : "";
  const normalizedURL = `${scheme}://${host}${portPart}${parsed.rawPath}${queryPart}`;

  return {
    rawInput: trimmed,
    normalizedURL,
    domain: host,
    path: decodePathSafe(parsed.rawPath),
    isShortURL: SHORT_URL_HOSTS.has(host),
    defangedInput,
  };
}

function extractFirstURL(text: string): string | null {
  const match = URL_PATTERN.exec(text);
  if (!match || match[1] === undefined) return null;
  return trimSentencePunctuation(match[1]);
}

function extractFirstDefangedURL(text: string): string | null {
  const match = DEFANGED_URL_PATTERN.exec(text);
  if (!match || match[1] === undefined) return null;
  const candidate = trimSentencePunctuation(match[1]);
  return restoreDefangedText(candidate).didRestore ? candidate : null;
}

function restoreDefangedText(text: string): DefangRestoration {
  let output = text;
  output = output.replace(/hxxps:\/\//gi, "https://");
  output = output.replace(/hxxp:\/\//gi, "http://");
  output = output.replace(/\s*\[\.\]\s*/g, ".");
  output = output.replace(/\s*\[\s*dot\s*\]\s*/gi, ".");
  output = output.replace(/\s*\(\s*dot\s*\)\s*/gi, ".");
  for (let i = 0; i < 4; i++) {
    const next = output.replace(/([\p{L}\p{N}\-])[。．]([\p{L}\p{N}\-])/gu, "$1.$2");
    if (next === output) break;
    output = next;
  }
  return { text: output, didRestore: output !== text };
}

function trimSentencePunctuation(candidate: string): string {
  let start = 0;
  let end = candidate.length;
  while (end > start && TRAILING_PUNCTUATION.has(candidate.charAt(end - 1))) end -= 1;
  while (start < end && TRAILING_PUNCTUATION.has(candidate.charAt(start))) start += 1;
  return candidate.slice(start, end);
}

function parseURLComponents(candidate: string): ParsedURL | null {
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\//.exec(candidate);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1] as string;
  const rest = candidate.slice(schemeMatch[0].length);

  let authorityEnd = rest.length;
  for (let i = 0; i < rest.length; i += 1) {
    const c = rest.charAt(i);
    if (c === "/" || c === "?" || c === "#") {
      authorityEnd = i;
      break;
    }
  }

  let authority = rest.slice(0, authorityEnd);
  const afterAuthority = rest.slice(authorityEnd);

  // Drop userinfo (everything up to and including the last "@").
  const atIndex = authority.lastIndexOf("@");
  if (atIndex >= 0) authority = authority.slice(atIndex + 1);

  let host = authority;
  let port: string | null = null;

  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0) return null;
    host = authority.slice(1, close); // strip brackets, mirroring URLComponents.host
    const afterClose = authority.slice(close + 1);
    if (afterClose.startsWith(":")) {
      const candidatePort = afterClose.slice(1);
      if (/^\d+$/.test(candidatePort)) port = candidatePort;
    }
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon >= 0) {
      const candidatePort = authority.slice(colon + 1);
      if (/^\d+$/.test(candidatePort)) {
        port = candidatePort;
        host = authority.slice(0, colon);
      }
    }
  }

  // Drop fragment, split path / query.
  let pathQuery = afterAuthority;
  const hashIndex = pathQuery.indexOf("#");
  if (hashIndex >= 0) pathQuery = pathQuery.slice(0, hashIndex);

  let rawPath = pathQuery;
  let query: string | null = null;
  const queryIndex = pathQuery.indexOf("?");
  if (queryIndex >= 0) {
    rawPath = pathQuery.slice(0, queryIndex);
    query = pathQuery.slice(queryIndex + 1);
  }

  return { scheme, host, port, rawPath, query };
}

function filterQuery(query: string | null): string | null {
  if (query === null || query.length === 0) return null;
  const kept = query.split("&").filter((item) => {
    const name = (item.split("=")[0] ?? "").toLowerCase();
    return !name.startsWith("utm_") && !TRACKING_QUERY_NAMES.has(name);
  });
  return kept.length === 0 ? null : kept.join("&");
}

function decodePathSafe(rawPath: string): string {
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

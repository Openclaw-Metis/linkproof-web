// RFC 3492 Punycode encoder.
// Faithful port of the hand-rolled `Punycode` enum in
// apps/ios/.../Services/URLNormalizer.swift (and the Kotlin equivalent).
//
// We deliberately do NOT use the browser's `new URL()` IDN handling: it
// diverges from the iOS/Android apps on Nameprep edge cases (e.g. `straße`
// is mapped to `ss` by our DomainPolicy before this encoder ever runs, but
// the browser would punycode the ß). Porting the exact algorithm keeps the
// PWA in lock-step with the native apps' parity fixtures.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const DELIMITER = "-";

function threshold(k: number, bias: number): number {
  if (k <= bias) return T_MIN;
  if (k >= bias + T_MAX) return T_MAX;
  return k - bias;
}

function adapt(deltaInput: number, numberOfPoints: number, isFirstTime: boolean): number {
  let delta = isFirstTime ? Math.floor(deltaInput / DAMP) : Math.floor(deltaInput / 2);
  delta += Math.floor(delta / numberOfPoints);

  let k = 0;
  while (delta > Math.floor(((BASE - T_MIN) * T_MAX) / 2)) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function encodeDigit(digit: number): string {
  // 0..25 -> 'a'..'z' (97..), 26..35 -> '0'..'9' (22 + digit)
  const scalarValue = digit < 26 ? 97 + digit : 22 + digit;
  return String.fromCharCode(scalarValue);
}

/**
 * Encode a single (already lowercased / Nameprep-prepared) label to its
 * Punycode body. Returns `null` for invalid input. Callers prepend `xn--`.
 */
export function punycodeEncode(input: string): string | null {
  // Iterate by Unicode code point (handles supplementary-plane chars like emoji).
  const codePoints = Array.from(input, (ch) => ch.codePointAt(0) as number);
  if (codePoints.length === 0) return null;

  let output = "";
  for (const cp of codePoints) {
    if (cp < 0x80) output += String.fromCodePoint(cp);
  }

  const basicCount = output.length;
  let handledCount = basicCount;
  if (basicCount > 0 && handledCount < codePoints.length) {
    output += DELIMITER;
  }

  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;

  while (handledCount < codePoints.length) {
    let nextMinimum = Number.MAX_SAFE_INTEGER;
    for (const cp of codePoints) {
      if (cp >= n && cp < nextMinimum) nextMinimum = cp;
    }
    if (nextMinimum === Number.MAX_SAFE_INTEGER) return null;

    const handledPlusOne = handledCount + 1;
    if (nextMinimum - n > Math.floor((Number.MAX_SAFE_INTEGER - delta) / handledPlusOne)) {
      return null;
    }
    delta += (nextMinimum - n) * handledPlusOne;
    n = nextMinimum;

    for (const cp of codePoints) {
      if (cp < n) {
        delta += 1;
      } else if (cp === n) {
        let q = delta;
        let k = BASE;
        while (true) {
          const t = threshold(k, bias);
          if (q < t) break;
          const value = t + ((q - t) % (BASE - t));
          output += encodeDigit(value);
          q = Math.floor((q - t) / (BASE - t));
          k += BASE;
        }
        output += encodeDigit(q);
        bias = adapt(delta, handledPlusOne, handledCount === basicCount);
        delta = 0;
        handledCount += 1;
      }
    }

    delta += 1;
    n += 1;
  }

  return output;
}

// Parity test: the PWA's URLNormalizer must agree with the iOS / Android apps.
//
// This fixture is COPIED from linkproof/tests/parity/url-normalization.json and
// MUST stay in sync with it. The same JSON drives the Swift and Kotlin tests;
// keeping a third consumer here guarantees the web port does not drift.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { normalize } from "../src/core/url-normalizer";

interface Fixture {
  input: string;
  expected: {
    normalizedURL: string;
    domain: string;
    path: string;
    isShortURL: boolean;
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "parity", "url-normalization.json");
const fixtures = JSON.parse(readFileSync(fixturePath, "utf-8")) as Fixture[];

describe("URLNormalizer parity (tests/parity/url-normalization.json)", () => {
  for (const fixture of fixtures) {
    it(`normalizes: ${fixture.input}`, () => {
      const result = normalize(fixture.input);
      expect(result.normalizedURL, "normalizedURL").toBe(fixture.expected.normalizedURL);
      expect(result.domain, "domain").toBe(fixture.expected.domain);
      expect(result.path, "path").toBe(fixture.expected.path);
      expect(result.isShortURL, "isShortURL").toBe(fixture.expected.isShortURL);
    });
  }
});

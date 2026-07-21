import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichRow } from "../src/core/enrich.js";
import { Cache } from "../src/core/cache.js";
import { normalizeRow, cacheKey } from "../src/core/normalize.js";
import { candidateEmails } from "../src/providers/patterns.js";
import type { Provider, Result, NormalizedRow } from "../src/core/types.js";

function mockProvider(
  name: string,
  result: Result | null,
  onCall?: () => void,
): Provider {
  return {
    name,
    cost: result?.cost ?? 0,
    async lookup(_row: NormalizedRow) {
      onCall?.();
      return result;
    },
  };
}

const R = (over: Partial<Result>): Result => ({
  email: "x@y.com",
  source: "mock",
  cost: 0.01,
  verified: false,
  method: "api",
  ...over,
});

test("pattern generator produces expected ordered candidates", () => {
  const row = normalizeRow({ name: "Jane Smith", domain: "acme.com" })!;
  assert.deepEqual(candidateEmails(row), [
    "jane.smith@acme.com",
    "jsmith@acme.com",
    "jane@acme.com",
    "j.smith@acme.com",
    "janesmith@acme.com",
  ]);
});

test("waterfall stops at first verified hit and skips later providers", async () => {
  let secondCalled = false;
  const providers = [
    mockProvider("a", R({ verified: true, email: "hit@acme.com" })),
    mockProvider("b", R({ verified: true }), () => {
      secondCalled = true;
    }),
  ];
  const res = await enrichRow({ name: "Jane Smith", domain: "acme.com" }, providers);
  assert.equal(res?.email, "hit@acme.com");
  assert.equal(secondCalled, false, "provider after a verified hit must not run");
});

test("cached row costs $0 and never calls a provider", async () => {
  const cache = new Cache("/tmp/oe-test-cache-" + process.pid + ".json");
  const row = normalizeRow({ name: "Jane Smith", domain: "acme.com" })!;
  cache.set(cacheKey(row), R({ verified: true, email: "cached@acme.com", cost: 0.05 }));

  let called = false;
  const providers = [mockProvider("a", R({}), () => (called = true))];
  const res = await enrichRow({ name: "Jane Smith", domain: "acme.com" }, providers, { cache });

  assert.equal(res?.email, "cached@acme.com");
  assert.equal(res?.cost, 0, "cache hit must be billed at $0");
  assert.equal(res?.method, "cache");
  assert.equal(called, false, "no provider should run on a cache hit");
});

test("no verified provider -> returns best-effort unverified guess (degrades, no crash)", async () => {
  const providers = [
    mockProvider("local", R({ verified: false, method: "pattern-only", email: "guess@acme.com", cost: 0 })),
    mockProvider("paid", null),
  ];
  const res = await enrichRow({ name: "Jane Smith", domain: "acme.com" }, providers);
  assert.equal(res?.verified, false);
  assert.equal(res?.method, "pattern-only");
  assert.equal(res?.email, "guess@acme.com");
});

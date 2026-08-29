import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichRow } from "../src/core/enrich.js";
import { enrichBatch } from "../src/core/batch.js";
import { Cache } from "../src/core/cache.js";
import { DomainMemory } from "../src/core/domains.js";
import { normalizeRow, cacheKey } from "../src/core/normalize.js";
import {
  applyPattern,
  candidateEmails,
  inferPattern,
  structuralPattern,
} from "../src/providers/patterns.js";
import { clearScrapeMemo, createScrapeProvider } from "../src/providers/scrape.js";
import { __test as smtp } from "../src/providers/local.js";
import type { LookupContext, Provider, Result, NormalizedRow } from "../src/core/types.js";

function mockProvider(
  name: string,
  result: Result | null,
  onCall?: () => void,
): Provider {
  return {
    name,
    cost: result?.cost ?? 0,
    async lookup(_row: NormalizedRow, _ctx: LookupContext) {
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

const row = (name: string, domain: string) => normalizeRow({ name, domain })!;

test("pattern generator produces expected ordered candidates", () => {
  assert.deepEqual(candidateEmails(row("Jane Smith", "acme.com")), [
    "jane.smith@acme.com",
    "jsmith@acme.com",
    "jane@acme.com",
    "j.smith@acme.com",
    "janesmith@acme.com",
  ]);
});

test("a learned pattern is probed first", () => {
  const candidates = candidateEmails(row("Jane Smith", "acme.com"), "firstl");
  assert.equal(candidates[0], "janes@acme.com");
  assert.equal(new Set(candidates).size, candidates.length);
});

test("inferPattern round-trips every template it can generate", () => {
  const r = row("Jane Smith", "acme.com");
  for (const id of ["first.last", "flast", "f.last", "firstlast", "last.first", "firstl"] as const) {
    const email = applyPattern(id, r)!;
    assert.equal(inferPattern(email, r.first, r.last), id, `${id} -> ${email}`);
  }
  assert.equal(inferPattern("someone.else@acme.com", r.first, r.last), null);
});

test("structuralPattern reads the separator shape only", () => {
  assert.equal(structuralPattern("bob.jones@acme.com"), "first.last");
  assert.equal(structuralPattern("bob_jones@acme.com"), "first_last");
  assert.equal(structuralPattern("b.jones@acme.com"), "f.last");
  assert.equal(structuralPattern("info@acme.com"), null);
});

test("a host refusing our IP is not read as a missing recipient", () => {
  const real =
    "554 5.7.1 <abts-north-dynamic-85.99.235.223.airtelbroadband.in>: Unverified Client host rejected: Dynamic - Please relay via ISP";
  assert.equal(smtp.classify({ code: 554, text: real }), "policy");
  assert.equal(
    smtp.classify({ code: 550, text: "550 5.1.1 The email account that you tried to reach does not exist." }),
    "no-such-user",
  );
  assert.equal(smtp.classify({ code: 550, text: "550 No such user here" }), "no-such-user");
  assert.equal(smtp.classify({ code: 250, text: "250 2.1.5 Ok" }), "accepted");
  assert.equal(smtp.classify({ code: 451, text: "451 4.7.1 Greylisted, try again later" }), "policy");
  assert.equal(smtp.classify({ code: 421, text: "421 too many connections" }), "temporary");
  assert.equal(smtp.classify({ code: 0, text: "" }), "dead");
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
  const cache = new Cache(`/tmp/oe-test-cache-${process.pid}.json`);
  const r = row("Jane Smith", "acme.com");
  cache.set(cacheKey(r), R({ verified: true, email: "cached@acme.com", cost: 0.05 }));

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

test("row cost is total spend across every provider that answered", async () => {
  const providers = [
    mockProvider("paid1", R({ verified: false, cost: 0.02, email: "a@acme.com" })),
    mockProvider("paid2", R({ verified: true, cost: 0.03, email: "b@acme.com" })),
  ];
  const res = await enrichRow({ name: "Jane Smith", domain: "acme.com" }, providers);
  assert.equal(res?.email, "b@acme.com");
  assert.equal(res?.cost, 0.05);
});

test("a verified hit teaches the domain its pattern", async () => {
  const domains = new DomainMemory();
  const providers = [mockProvider("api", R({ verified: true, email: "jane.smith@acme.com", cost: 0.01 }))];
  await enrichRow({ name: "Jane Smith", domain: "acme.com" }, providers, { domains });
  assert.equal(domains.pattern("acme.com"), "first.last");

  const learned = candidateEmails(row("Bob Jones", "acme.com"), domains.pattern("acme.com"));
  assert.equal(learned[0], "bob.jones@acme.com");
});

test("cost cap skips paid providers once the ceiling is reached", async () => {
  let paidCalls = 0;
  const paid = (): Provider => ({
    name: "paid",
    cost: 0.04,
    async lookup() {
      paidCalls++;
      return R({ verified: true, cost: 0.04, email: "hit@acme.com" });
    },
  });
  const inputs = [
    { name: "A One", domain: "a.com" },
    { name: "B Two", domain: "b.com" },
    { name: "C Three", domain: "c.com" },
  ];
  const { ledger } = await enrichBatch(inputs, [paid()], { maxCost: 0.05, concurrency: 1 });
  assert.equal(paidCalls, 1, "second paid lookup would breach the cap");
  assert.equal(ledger.totals.cost, 0.04);
  assert.equal(ledger.capped, true);
});

test("batch keeps input order, buckets by domain, and reports progress", async () => {
  const seen: string[] = [];
  const provider: Provider = {
    name: "mock",
    cost: 0,
    async lookup(r) {
      seen.push(r.domain);
      await new Promise((res) => setTimeout(res, r.domain === "slow.com" ? 20 : 1));
      return R({ verified: true, cost: 0, email: `${r.first}@${r.domain}` });
    },
  };
  const inputs = [
    { name: "A One", domain: "slow.com" },
    { name: "B Two", domain: "fast.com" },
    { name: "C Three", domain: "slow.com" },
  ];
  const progress: number[] = [];
  const { rows, ledger } = await enrichBatch(inputs, [provider], {
    concurrency: 4,
    onProgress: (p) => progress.push(p.done),
  });

  assert.deepEqual(
    rows.map((r) => r.email),
    ["a@slow.com", "b@fast.com", "c@slow.com"],
    "output must stay aligned with input order",
  );
  assert.equal(ledger.totals.verified, 3);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(
    seen.filter((d) => d === "slow.com").length,
    2,
    "both slow.com rows run on one worker",
  );
});

test("unresolvable rows still appear in the output", async () => {
  const { rows, ledger } = await enrichBatch(
    [{ name: "No Domain" }, { name: "Jane Smith", domain: "acme.com" }],
    [mockProvider("mock", R({ verified: true, cost: 0, email: "jane.smith@acme.com" }))],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].email, "");
  assert.equal(rows[1].email, "jane.smith@acme.com");
  assert.equal(ledger.totals.resolved, 1);
});

test("scrape provider claims a published email as verified", async () => {
  clearScrapeMemo();
  const pages: Record<string, string> = {
    "https://acme.com/": `<title>Acme</title><a href="/about-us">About</a>`,
    "https://acme.com/about-us": `<a href="mailto:jane.smith@acme.com">Jane</a> <a href="mailto:info@acme.com">info</a>`,
  };
  const domains = new DomainMemory();
  const provider = createScrapeProvider({ fetchText: async (url) => pages[url] ?? null });
  const res = await provider.lookup(row("Jane Smith", "acme.com"), { domains });

  assert.equal(res?.email, "jane.smith@acme.com");
  assert.equal(res?.verified, true);
  assert.equal(res?.method, "scrape");
  assert.equal(domains.pattern("acme.com"), "first.last");
  assert.deepEqual(domains.get("acme.com").roleEmails, ["info@acme.com"]);
});

test("scrape provider learns a colleague's pattern for an unlisted person", async () => {
  clearScrapeMemo();
  const pages: Record<string, string> = {
    "https://beta.com/": `<a href="/team">Team</a>`,
    "https://beta.com/team": `<a href="mailto:bob.jones@beta.com">Bob</a>`,
  };
  const domains = new DomainMemory();
  const provider = createScrapeProvider({ fetchText: async (url) => pages[url] ?? null });
  const res = await provider.lookup(row("Jane Smith", "beta.com"), { domains });

  assert.equal(res?.email, "jane.smith@beta.com");
  assert.equal(res?.verified, false, "a pattern guess must never be sold as verified");
  assert.equal(res?.pattern, "first.last");
});

test("scrape provider honours robots.txt", async () => {
  clearScrapeMemo();
  const fetched: string[] = [];
  const pages: Record<string, string> = {
    "https://blocked.com/robots.txt": "User-agent: *\nDisallow: /team\n",
    "https://blocked.com/": `<a href="/team">Team</a>`,
    "https://blocked.com/team": `<a href="mailto:jane.smith@blocked.com">Jane</a>`,
  };
  const provider = createScrapeProvider({
    fetchText: async (url) => {
      fetched.push(url);
      return pages[url] ?? null;
    },
  });
  const res = await provider.lookup(row("Jane Smith", "blocked.com"), { domains: new DomainMemory() });

  assert.equal(fetched.includes("https://blocked.com/team"), false, "disallowed path must not be fetched");
  assert.equal(res, null);
});

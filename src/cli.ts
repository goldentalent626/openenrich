#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, toCsv } from "./core/csv.js";
import { enrichBatch, type Ledger } from "./core/batch.js";
import { enrichRow } from "./core/enrich.js";
import { enrichCompany } from "./core/company.js";
import { buildProviders, DEFAULT_PROVIDERS } from "./core/providers.js";
import { Cache } from "./core/cache.js";
import { extractEmails, verifyEmails, verifySummary } from "./core/verify.js";
import type { Provider, Row } from "./core/types.js";

interface Args {
  command: string;
  rest: string[];
  providers: string[];
  noSmtp: boolean;
  smtpTimeoutMs: number;
  concurrency: number;
  maxCost: number;
  dryRun: boolean;
  out?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? "",
    rest: [],
    providers: DEFAULT_PROVIDERS,
    noSmtp: false,
    smtpTimeoutMs: 5000,
    concurrency: 8,
    maxCost: Infinity,
    dryRun: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--providers") args.providers = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--fields") i++;
    else if (a === "--no-smtp") args.noSmtp = true;
    else if (a === "--smtp-timeout") args.smtpTimeoutMs = Number(argv[++i] ?? 5000);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i] ?? 8);
    else if (a === "--max-cost") args.maxCost = Number(argv[++i] ?? Infinity);
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--out") args.out = argv[++i];
    else if (!a.startsWith("--")) args.rest.push(a);
  }
  return args;
}

function usage(): never {
  console.error(
    [
      "openenrich                       open the app in your browser (no flags, no keys)",
      "openenrich verify <file|emails>  check a list you already have, write <file>.verified.csv",
      "openenrich run <file.csv>        enrich a CSV, write <file>.enriched.csv + ledger.json",
      "openenrich find <name> <domain>  one lookup, prints the email",
      "openenrich company <domain>      free firmographics for a domain",
      "",
      "  --providers a,b       waterfall order (default: scrape,local)",
      "  --concurrency N       domains in flight (default 8)",
      "  --max-cost N          hard ceiling on paid lookups for the run",
      "  --dry-run             free rungs only, then project what paid would cost",
      "  --no-smtp             skip SMTP verification (pattern + MX only)",
      "  --smtp-timeout ms     per-connection timeout (default 5000)",
      "  --out path            output CSV path",
    ].join("\n"),
  );
  process.exit(1);
}

const money = (n: number): string => `$${n.toFixed(2)}`;

const providerOpts = (args: Args) => ({
  providers: args.providers,
  noSmtp: args.noSmtp,
  smtpTimeoutMs: args.smtpTimeoutMs,
});

async function run(args: Args): Promise<void> {
  const file = args.rest[0];
  if (!file) usage();

  const all = buildProviders(providerOpts(args));
  const providers = args.dryRun ? all.filter((p) => p.cost === 0) : all;
  if (!providers.length) {
    console.error("No usable providers. Add 'local' or set provider API keys.");
    process.exit(1);
  }

  const records = parseCsv(readFileSync(file, "utf8"));
  const inputs: Row[] = records.map((r) => ({
    name: r.name,
    first_name: r.first_name,
    last_name: r.last_name,
    domain: r.domain,
    company_url: r.company_url,
  }));

  const cache = new Cache();
  const live = process.stderr.isTTY;
  const { rows, ledger } = await enrichBatch(inputs, providers, {
    cache,
    concurrency: args.concurrency,
    maxCost: args.maxCost,
    onProgress: (p) => {
      if (!live) return;
      process.stderr.write(
        `\r${p.done}/${p.total} rows · ${p.verified} verified · ${money(p.cost)} spent   `,
      );
    },
  });
  if (live) process.stderr.write("\r\x1b[K");
  cache.flush();

  if (args.dryRun) {
    printDryRun(ledger, all);
    return;
  }

  const enriched = records.map((rec, i) => ({
    ...rec,
    email: rows[i].email,
    source: rows[i].source,
    verified: rows[i].verified,
    method: rows[i].method,
    pattern: rows[i].pattern ?? "",
    cost: rows[i].cost,
    note: rows[i].note ?? "",
  }));

  const outPath = args.out ?? `${file.replace(/\.csv$/i, "")}.enriched.csv`;
  const ledgerPath = path.join(path.dirname(outPath), "ledger.json");
  writeFileSync(outPath, toCsv(enriched));
  writeFileSync(ledgerPath, JSON.stringify({ ...ledger, rows }, null, 2));

  printSummary(ledger);
  console.log(`wrote ${outPath}`);
  console.log(`wrote ${ledgerPath}`);
}

function printSummary(ledger: Ledger): void {
  const { totals, bySource } = ledger;
  const parts = Object.entries(bySource).map(
    ([source, v]) => `${source} ${v.resolved} resolved (${v.verified} verified) ${money(v.cost)}`,
  );
  console.log("");
  console.log(parts.join(" / ") || "no rows resolved");
  console.log(
    `total ${totals.resolved}/${totals.rows} resolved, ${totals.verified} verified, ${money(totals.cost)}`,
  );
  if (totals.cached) console.log(`${totals.cached} rows came free from cache (never billed twice)`);
  console.log(`${totals.patternsKnown} domain email patterns known (reused free next run)`);
  if (ledger.capped) console.log("cost cap reached: paid providers were skipped for later rows");
  if (ledger.aborted) console.log("run aborted early");
}

function printDryRun(ledger: Ledger, all: Provider[]): void {
  const { totals } = ledger;
  const gap = totals.rows - totals.verified;
  const cheapest = all.filter((p) => p.cost > 0).sort((a, b) => a.cost - b.cost)[0];
  printSummary(ledger);
  console.log("");
  console.log(
    `dry run: ${totals.verified}/${totals.rows} verified for free, ${gap} rows unresolved or unverified`,
  );
  console.log(
    cheapest
      ? `paid fill-in would cost up to ${money(gap * cheapest.cost)} at ${cheapest.name} (${money(cheapest.cost)}/row)`
      : "no paid provider keys set, so nothing else to project",
  );
  console.log("nothing written (dry run)");
}

async function find(args: Args): Promise<void> {
  const [name, domain] = args.rest;
  if (!name || !domain) usage();
  const cache = new Cache();
  const result = await enrichRow({ name, domain }, buildProviders(providerOpts(args)), { cache });
  cache.flush();
  if (!result) {
    console.log("no email found");
    process.exit(2);
  }
  console.log(result.email);
  console.error(
    `${result.verified ? "verified" : "unverified"} · ${result.method} · ${result.source} · ${money(result.cost)}${result.note ? ` · ${result.note}` : ""}`,
  );
}

async function verify(args: Args): Promise<void> {
  if (!args.rest.length) usage();
  const file = args.rest.length === 1 && existsSync(args.rest[0]) ? args.rest[0] : undefined;
  const emails = extractEmails(file ? readFileSync(file, "utf8") : args.rest.join(" "));
  if (!emails.length) {
    console.error("no email addresses found in the input");
    process.exit(1);
  }

  const cache = new Cache();
  const live = process.stderr.isTTY;
  const rows = await verifyEmails(emails, {
    smtp: !args.noSmtp,
    smtpTimeoutMs: args.smtpTimeoutMs,
    concurrency: args.concurrency,
    domains: cache.domains,
    onProgress: (p) => {
      if (live) process.stderr.write(`\r${p.done}/${p.total} checked   `);
    },
  });
  if (live) process.stderr.write("\r\x1b[K");
  cache.flush();

  const s = verifySummary(rows);
  console.log("");
  console.log(`${s.valid} valid · ${s.invalid} invalid · ${s.risky} risky · ${s.unknown} unknown`);
  if (s.unknown && s.unknown === s.total) {
    console.log(`nothing could be proven from this network: ${rows[0].reason}.`);
    console.log("run it from a VPS with a clean IP, or add a paid provider key.");
  }

  if (!file) {
    for (const r of rows) console.log(`${r.status.padEnd(8)} ${r.email}  ${r.reason}`);
    return;
  }
  const outPath = args.out ?? `${file.replace(/\.[^.]+$/, "")}.verified.csv`;
  writeFileSync(outPath, toCsv(rows));
  console.log(`wrote ${outPath}`);
}

async function company(args: Args): Promise<void> {
  const domain = args.rest[0];
  if (!domain) usage();
  const cache = new Cache();
  const facts = await enrichCompany(domain, cache.domains);
  cache.flush();
  console.log(JSON.stringify(facts, null, 2));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.command) await import("./web.js");
  else if (args.command === "verify") await verify(args);
  else if (args.command === "run") await run(args);
  else if (args.command === "find") await find(args);
  else if (args.command === "company") await company(args);
  else usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env -S npx tsx
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, toCsv } from "./core/csv.js";
import { enrichRow } from "./core/enrich.js";
import { buildProviders } from "./core/providers.js";
import { Cache } from "./core/cache.js";
import type { Row } from "./core/types.js";

interface Args {
  command: string;
  file?: string;
  providers: string[];
  noSmtp: boolean;
  smtpTimeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? "",
    file: argv[1] && !argv[1].startsWith("--") ? argv[1] : undefined,
    providers: ["local"],
    noSmtp: false,
    smtpTimeoutMs: 5000,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--providers") args.providers = (argv[++i] ?? "").split(",").filter(Boolean);
    else if (a === "--fields") i++; // accepted for spec compat; output is fixed
    else if (a === "--no-smtp") args.noSmtp = true;
    else if (a === "--smtp-timeout") args.smtpTimeoutMs = parseInt(argv[++i] ?? "5000", 10);
  }
  return args;
}

function usage(): never {
  console.error(
    "Usage: openenrich run <file.csv> [--fields email] [--providers local,prospeo,leadmagic] [--no-smtp] [--smtp-timeout ms]",
  );
  process.exit(1);
}

async function run(args: Args): Promise<void> {
  if (!args.file) usage();

  const providers = buildProviders({
    providers: args.providers,
    noSmtp: args.noSmtp,
    smtpTimeoutMs: args.smtpTimeoutMs,
  });
  if (!providers.length) {
    console.error("No usable providers (missing API keys?). Add 'local' or set keys.");
    process.exit(1);
  }

  const csvText = readFileSync(args.file, "utf8");
  const records = parseCsv(csvText);
  const cache = new Cache();

  const enriched: Record<string, unknown>[] = [];
  const ledger: {
    rows: any[];
    totals: { cost: number; resolved: number; verified: number; rows: number };
    bySource: Record<string, { resolved: number; cost: number }>;
  } = {
    rows: [],
    totals: { cost: 0, resolved: 0, verified: 0, rows: records.length },
    bySource: {},
  };

  for (const rec of records) {
    const row: Row = {
      name: rec.name,
      first_name: rec.first_name,
      last_name: rec.last_name,
      domain: rec.domain,
      company_url: rec.company_url,
    };
    const result = await enrichRow(row, providers, { cache });

    const outRow: Record<string, unknown> = { ...rec };
    if (result) {
      outRow.email = result.email;
      outRow.source = result.source;
      outRow.verified = result.verified;
      outRow.method = result.method;
      outRow.cost = result.cost;

      ledger.totals.cost += result.cost;
      ledger.totals.resolved++;
      if (result.verified) ledger.totals.verified++;
      const src = (ledger.bySource[result.source] ??= { resolved: 0, cost: 0 });
      src.resolved++;
      src.cost += result.cost;
    } else {
      outRow.email = "";
      outRow.source = "";
      outRow.verified = false;
      outRow.method = "";
      outRow.cost = 0;
    }
    enriched.push(outRow);
    ledger.rows.push({
      name: row.name ?? [row.first_name, row.last_name].filter(Boolean).join(" "),
      domain: row.domain ?? row.company_url,
      email: result?.email ?? null,
      source: result?.source ?? null,
      verified: result?.verified ?? false,
      method: result?.method ?? null,
      cost: result?.cost ?? 0,
    });
  }

  cache.flush();

  const outPath = args.file.replace(/\.csv$/i, "") + ".enriched.csv";
  writeFileSync(outPath, toCsv(enriched));
  const ledgerPath = path.join(path.dirname(args.file), "ledger.json");
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));

  printSummary(ledger, outPath, ledgerPath);
}

function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

function printSummary(ledger: any, outPath: string, ledgerPath: string): void {
  const parts = Object.entries(ledger.bySource).map(
    ([src, v]: [string, any]) => `${src} ${v.resolved} resolved ${fmt(v.cost)}`,
  );
  console.log("");
  console.log(parts.join(" / ") || "no rows resolved");
  console.log(
    `total ${ledger.totals.resolved}/${ledger.totals.rows} resolved, ${ledger.totals.verified} verified, ${fmt(ledger.totals.cost)}`,
  );
  console.log(`wrote ${outPath}`);
  console.log(`wrote ${ledgerPath}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "run") await run(args);
  else usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { enrichRow } from "./core/enrich.js";
import { enrichBatch } from "./core/batch.js";
import { enrichCompany } from "./core/company.js";
import { buildProviders, DEFAULT_PROVIDERS, PROVIDER_NAMES } from "./core/providers.js";
import { Cache } from "./core/cache.js";
import { parseCsv, toCsv } from "./core/csv.js";
import { extractEmails, verifyEmails, verifySummary } from "./core/verify.js";
import type { Row } from "./core/types.js";

const cache = new Cache();

const server = new McpServer({ name: "openenrich", version: "0.1.0" });

const providersArg = z
  .array(z.string())
  .optional()
  .describe(`Ordered waterfall, from: ${PROVIDER_NAMES.join(", ")}. Defaults to the free rungs.`);

const personShape = {
  name: z.string().describe("Full name, e.g. 'Jane Smith'"),
  domain: z.string().describe("Company domain or URL, e.g. 'acme.com'"),
  providers: providersArg,
};

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

async function enrichOne(name: string, domain: string, providerNames?: string[]) {
  const providers = buildProviders({ providers: providerNames ?? DEFAULT_PROVIDERS });
  const result = await enrichRow({ name, domain } as Row, providers, { cache });
  cache.flush();
  return result;
}

server.tool(
  "enrich_person",
  "Enrich a single person to a verified email using the waterfall. Free rungs first.",
  personShape,
  async ({ name, domain, providers }) => json(await enrichOne(name, domain, providers)),
);

server.tool(
  "find_email",
  "Find the best email for a person. Returns the address alone.",
  personShape,
  async ({ name, domain, providers }) => {
    const result = await enrichOne(name, domain, providers);
    return text(result?.email ?? "no email found");
  },
);

server.tool(
  "enrich_company",
  "Free firmographics for a domain: name, description, socials, mail provider, role emails, known email pattern.",
  { domain: z.string().describe("Company domain or URL") },
  async ({ domain }) => {
    const facts = await enrichCompany(domain, cache.domains);
    cache.flush();
    return json(facts);
  },
);

server.tool(
  "enrich_csv",
  "Enrich a CSV file end to end; writes <file>.enriched.csv and returns the cost ledger.",
  {
    path: z.string().describe("Path to the input CSV file"),
    providers: providersArg,
    maxCost: z.number().optional().describe("Hard ceiling on paid lookups for this run, in dollars"),
    concurrency: z.number().optional().describe("Domains in flight, default 8"),
  },
  async ({ path: csvPath, providers, maxCost, concurrency }) => {
    const built = buildProviders({ providers: providers ?? DEFAULT_PROVIDERS });
    const records = parseCsv(readFileSync(csvPath, "utf8"));
    const { rows, ledger } = await enrichBatch(records as Row[], built, {
      cache,
      maxCost,
      concurrency,
    });
    cache.flush();

    const outPath = `${csvPath.replace(/\.csv$/i, "")}.enriched.csv`;
    writeFileSync(
      outPath,
      toCsv(
        records.map((rec, i) => ({
          ...rec,
          email: rows[i].email,
          source: rows[i].source,
          verified: rows[i].verified,
          method: rows[i].method,
          cost: rows[i].cost,
        })),
      ),
    );
    return json({ ...ledger, wrote: outPath });
  },
);

server.tool(
  "verify_emails",
  "Check emails you already have: valid, invalid, risky (catch-all or disposable) or unknown, each with a reason. Give addresses inline or a file path.",
  {
    emails: z.array(z.string()).optional().describe("Addresses to check"),
    path: z.string().optional().describe("Path to a CSV or text file to pull addresses out of"),
    smtp: z.boolean().optional().describe("Probe mailboxes over SMTP, default true"),
  },
  async ({ emails, path: filePath, smtp }) => {
    const list = extractEmails([...(emails ?? []), filePath ? readFileSync(filePath, "utf8") : ""].join("\n"));
    if (!list.length) return text("no email addresses found in the input");
    const rows = await verifyEmails(list, { smtp: smtp ?? true, domains: cache.domains });
    cache.flush();
    return json({ summary: verifySummary(rows), rows });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

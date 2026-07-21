import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { enrichRow } from "./core/enrich.js";
import { buildProviders } from "./core/providers.js";
import { Cache } from "./core/cache.js";
import { parseCsv, toCsv } from "./core/csv.js";
import type { Row } from "./core/types.js";

const cache = new Cache();

const server = new McpServer({ name: "openenrich", version: "0.0.0" });

const personShape = {
  name: z.string().describe("Full name, e.g. 'Jane Smith'"),
  domain: z.string().describe("Company domain or URL, e.g. 'acme.com'"),
  providers: z
    .array(z.string())
    .optional()
    .describe("Ordered provider names; defaults to ['local']"),
};

async function enrichOne(name: string, domain: string, providerNames?: string[]) {
  const providers = buildProviders({ providers: providerNames ?? ["local"] });
  const result = await enrichRow({ name, domain } as Row, providers, { cache });
  cache.flush();
  return result;
}

server.tool(
  "enrich_person",
  "Enrich a single person to a verified email using the waterfall.",
  personShape,
  async ({ name, domain, providers }) => {
    const result = await enrichOne(name, domain, providers);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

server.tool(
  "find_email",
  "Find the best-guess email for a person (alias of enrich_person).",
  personShape,
  async ({ name, domain, providers }) => {
    const result = await enrichOne(name, domain, providers);
    return {
      content: [{ type: "text", text: result?.email ?? "no email found" }],
    };
  },
);

server.tool(
  "enrich_csv",
  "Enrich a CSV file end to end; writes <file>.enriched.csv and returns a summary.",
  {
    path: z.string().describe("Path to the input CSV file"),
    providers: z.array(z.string()).optional(),
  },
  async ({ path: csvPath, providers }) => {
    const providerList = buildProviders({ providers: providers ?? ["local"] });
    const records = parseCsv(readFileSync(csvPath, "utf8"));
    const out: Record<string, unknown>[] = [];
    let cost = 0;
    let resolved = 0;
    for (const rec of records) {
      const result = await enrichRow(rec as Row, providerList, { cache });
      out.push({
        ...rec,
        email: result?.email ?? "",
        source: result?.source ?? "",
        verified: result?.verified ?? false,
        method: result?.method ?? "",
        cost: result?.cost ?? 0,
      });
      if (result) {
        cost += result.cost;
        resolved++;
      }
    }
    cache.flush();
    const outPath = csvPath.replace(/\.csv$/i, "") + ".enriched.csv";
    writeFileSync(outPath, toCsv(out));
    return {
      content: [
        {
          type: "text",
          text: `Enriched ${resolved}/${records.length} rows, total $${cost.toFixed(2)}. Wrote ${outPath}`,
        },
      ],
    };
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

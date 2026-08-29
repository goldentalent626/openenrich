# OpenEnrich v0 — build spec

Goal: the smallest thing that proves the pitch. A CLI that turns a CSV of leads into verified emails, free where possible, with a cost ledger. MCP server wrapping the same core.

Stack: TypeScript, Node 20+, run with `tsx`/`bun`. Zero heavy frameworks. Package manager: whatever's already fine (npm). Keep dependencies minimal.

## Scope (build exactly this, nothing more)

### 1. Core: the waterfall
`src/core/enrich.ts` — `enrichRow({name, domain}, providers[]) -> {email, source, cost, verified}`
- Runs providers in order, stops at first verified hit.
- Providers implement a common interface `{ name, cost, lookup(row) -> Result | null }`.
- Dedup: keep a local JSON/SQLite cache keyed by `name+domain`; a cached hit costs $0 and short-circuits.

### 2. The free local engine (waterfall step 0, always first)
`src/providers/local.ts` — no API key, cost $0:
- **Pattern inference**: given first/last name + domain, generate candidate emails (`first.last@`, `flast@`, `first@`, `f.last@`, `firstlast@`).
- **MX check**: resolve the domain's MX records (node `dns/promises`). No MX = unreachable, skip.
- **SMTP verify**: connect to the MX host on port 25, `HELO`/`MAIL FROM`/`RCPT TO`, read the response code to tell deliverable from rejected. Close before `DATA`. Handle: catch-all domains (accept-all → mark `unverifiable`, don't claim verified), timeouts, greylisting.
- **CRITICAL ENV CAVEAT**: outbound port 25 is blocked on most residential ISPs and cloud hosts. When SMTP is unreachable, DEGRADE: return the top pattern guess marked `verified:false, method:"pattern-only"` rather than failing. Never crash on a blocked port. Make the SMTP timeout and a `--no-smtp` flag configurable.
- Optional (only if time): fetch the domain homepage + `/about`, `/team`, `/contact`, regex out `mailto:` and published emails.

### 3. Paid providers (thin adapters, BYO key from env)
`src/providers/prospeo.ts`, `leadmagic.ts` — implement the provider interface over their real REST APIs. Read keys from env (`PROSPEO_API_KEY`, `LEADMAGIC_API_KEY`). If key absent, provider is silently skipped. Do NOT hardcode keys. Keep each adapter under ~40 lines. (Endpoints: look them up; if unsure, leave a clearly-marked TODO with the interface stubbed so the waterfall still runs on the local engine alone.)

### 4. CLI
`src/cli.ts` — `openenrich run <file.csv> --fields email --providers local,prospeo,leadmagic [--no-smtp]`
- Reads CSV (columns: name/first_name/last_name, domain or company_url), runs the waterfall per row, writes `<file>.enriched.csv` + `ledger.json` (per-row source + cost, plus totals).
- Prints a summary table like: `local 291 resolved $0.00 / prospeo 118 $1.18 / total $8.85`.

### 5. MCP server
`src/mcp.ts` — expose tools over the MCP SDK (`@modelcontextprotocol/sdk`), stdio transport:
- `enrich_person({name, domain})`, `find_email({name, domain})`, `enrich_csv({path, providers})`.
- Each calls the same core. This is the agent-native selling point; keep it thin.

### 6. Proof it works (ponytail rule: one runnable check)
`test/enrich.test.ts` — node:test or vitest. Assert:
- pattern generator produces the expected candidate set for a known name+domain.
- waterfall stops at first verified provider (mock providers, no network).
- cached row returns cost 0 and doesn't call providers.
- SMTP-blocked path degrades to `pattern-only` instead of throwing.

## Definition of done
`npm i && npx tsx src/cli.ts run examples/sample.csv --providers local` runs end to end on the free engine alone (no keys), writes an enriched CSV + ledger, and the tests pass. Include `examples/sample.csv` with ~5 rows.

## Explicitly OUT of scope for v0
Web UI, Docker, hosted tier, the pattern-commons dataset, CRM sync, scheduling, more than 2 paid providers. README already covers the vision; build only the above.

## Built (v0 complete)

The spec above shipped, plus the parts that turned out to be load-bearing:

- **Website crawl** (`src/providers/scrape.ts`), which the spec had as optional. Home page plus up to three hinted pages (about, team, contact, impressum), robots.txt honoured, role addresses kept separate from people. A published email that matches the person is the strongest free signal there is.
- **Per-domain pattern memory** (`src/core/domains.ts`, persisted in the cache). Any verified email teaches the domain its pattern, from the crawl, from SMTP, or from a paid provider. The next colleague at that company is resolved free. This is also the seed of the pattern-commons roadmap.
- **SMTP reply classification** (`src/providers/local.ts`). A strict mail server refusing a residential IP answers `554 5.7.1`, which is indistinguishable from "no such user" unless the enhanced status code is read. Reading it wrong is how a verifier invents nonexistent people. After three hosts refuse us, probing stops for the process.
- **One SMTP connection per lookup** instead of one per candidate, with a control probe for catch-all first, and probes serialized per MX host so shared mail hosts do not tarpit us.
- **Batch engine** (`src/core/batch.ts`): rows bucketed by domain, bounded concurrency, progress callback, abort signal, cost ledger. This is the seam the UI sits on.
- **Cost cap and dry run**: `--max-cost` is enforced before each paid call, `--dry-run` projects paid spend from a free pass. Row cost is total spend across every provider that answered, not the winner's list price.
- **`enrich_company`** (`src/core/company.ts`): free firmographics out of bytes the crawl already fetched, plus mail provider from MX.
- CLI gained `find` and `company`; MCP gained `enrich_company`, `maxCost` and `concurrency`.

Deliberately still out: more paid adapters, the commons dataset, CRM sync, scheduling, hosted tier.

# OpenEnrich

Open-source lead enrichment waterfall. Bring your own API keys, pay wholesale.

Clay charges $495/mo to pass your data through APIs you can call yourself for about $0.01 per lead. OpenEnrich is the open-source engine that makes those calls for you, in order, until one hits.

## The math

| What you need | Clay / Apollo / ZoomInfo | Wholesale (BYO key) |
|---|---|---|
| Verified work email | bundled into $167-495/mo plans | $0.01 (Prospeo) |
| Email + company data | credits, re-billed on refresh | $0.01-0.03 (LeadMagic) |
| Mobile number | premium credits | $0.05-0.30 (LeadMagic) |
| Full person profile | $15k-40k/yr (ZoomInfo) | $0.20-0.28 (People Data Labs) |

A $120 Clay list costs roughly $10 in raw API calls. You keep the difference.

## Free by default

OpenEnrich runs with zero API keys. The built-in local engine is always the first step of the waterfall:

- crawls the company's own website (team, about, contact pages) for names, titles, and published emails
- infers email patterns (`first.last@`, `f.last@`) and verifies them against the domain's mail server
- pulls free public registries where they apply

Expect roughly 30-50% email coverage for free, more for SMBs with real websites, less for big companies. Catch-all mail servers can't be verified and some ISPs block outbound SMTP checks, so paid providers exist for a reason. But nothing in OpenEnrich requires a paid key to be useful.

## How it works

1. Feed it a CSV, a domain list, or a single lookup.
2. The free local engine tries first. Costs nothing, ever.
3. If you added provider keys (LeadMagic, Prospeo, FullEnrich, People Data Labs, Enrich.so, Coresignal), unresolved rows fall through the waterfall in your order until a lookup verifies. One hit, one charge, no double billing. PDL's free tier (100 lookups) means even the paid rungs cost nothing to try.
4. Results come back as CSV/JSON, deduped against everything you already enriched. You never pay to enrich the same row twice.

No credits. No seats. No inference at runtime: the waterfall is a deterministic pipeline, so enriching 10,000 rows burns zero LLM tokens.

## Your agent can run it

OpenEnrich ships an MCP server. Connect Claude Code or any MCP client and your agent enriches leads directly:

- `enrich_person` - email, title, company from a name + domain
- `enrich_company` - firmographics from a domain
- `find_email` - waterfall email discovery + verification
- `enrich_csv` - point it at a file, get the file back enriched

ZoomInfo shipped an MCP server in February 2026. They know where this is going. The difference: theirs meters you at retail, this one runs at cost.

## Not another AI enrichment demo

Fire Enrich and similar tools use LLM agents to scrape and guess. OpenEnrich calls the same structured data providers Clay resells, so results are verified data with a price tag you can predict, not model output.

## Quickstart (v0 in progress)

```bash
docker compose up
```

Then open http://localhost:3000, upload a CSV, optionally paste provider keys.

## Status

Pre-v0: this README is the spec, code is landing now. v0 scope = free local engine, provider waterfall, CSV flow, MCP server. Star the repo if you want this to exist; open an issue with your stack (providers, CRM, list sizes) and it shapes the roadmap.

## Roadmap: the pattern commons

After v0: an opt-in, open dataset of domain email patterns and catch-all flags, contributed by installs. Never names, never emails, never personal data, just "this domain uses first.last@ and is not catch-all". Every user makes the free engine better for everyone. Incumbents can't open their pattern data without commoditizing themselves.

## Hosted version

Self-hosting is and stays free. A hosted version (managed keys, scheduling, team access) comes later if people want it.

## License

AGPL-3.0

# OpenEnrich

Free email verifier and finder that runs on your own machine. Nothing is uploaded.

```bash
npx openenrich
```

That opens an app in your browser. Drop the list you already have, or paste names and companies to find the addresses. No signup, no API keys, no credits, no upload.

## Two jobs

**Check my list.** You have a spreadsheet of addresses and you don't know which ones are real. OpenEnrich sorts them into safe to send, will bounce, risky and not sure, and says why in plain words for every row. Then you download the clean file or copy just the safe ones.

**Find the missing ones.** You have names and companies but no addresses. OpenEnrich crawls the company site, works out the address pattern that company uses (`first.last@`, `f.last@`), applies it to your people and checks each one against the company's mail server.

Both are free forever and both run locally. Paid data providers are optional, and only run on the rows the free work missed.

## What free actually gets you

Honesty first, because every other tool in this category is vague about it.

Free and reliable, on any machine:

- dead domains: no mail server at all, so the address cannot work
- disposable inboxes (mailinator and friends)
- role addresses (`info@`, `sales@`) flagged as shared inboxes, not people
- malformed addresses
- catch-all domains, which accept everything and therefore prove nothing
- the email pattern a company uses, learned from addresses published on its own site

Free but network-dependent: proving one specific mailbox exists needs an SMTP conversation on port 25, and strict mail servers refuse home and cloud IP addresses. When that happens the row comes back **not sure**, with the reason, instead of a guess dressed up as a fact. Microsoft-hosted domains refuse most residential IPs outright. Run it from a VPS with a clean IP and this rung starts working; that is a large part of what ZeroBounce and NeverBounce charge for.

The web UI binds to `127.0.0.1` so a pasted list cannot be read by anyone else on your network. To reach it on a VPS, start it with `HOST=0.0.0.0` and put it behind your own auth.

Expect a typical scraped list to lose 20-40% of its junk for free, and the rest to need either a clean IP or a paid key.

## The price math, if you do this at scale

| What you need | Clay / Apollo / ZoomInfo | Wholesale (your own key) |
|---|---|---|
| Verified work email | bundled into $167-495/mo plans | $0.01 (Prospeo) |
| Email + company data | credits, re-billed on refresh | $0.01-0.03 (LeadMagic) |
| Bulk verification | $8-40 per 5,000 | $0 locally, or a fraction of a cent |
| Full person profile | $15k-40k/yr (ZoomInfo) | $0.20-0.28 (People Data Labs) |

Add a provider key and unresolved rows fall through the waterfall in your order until one hits. One hit, one charge, never billed twice for the same row. `--max-cost` is a hard ceiling. `--dry-run` shows what the paid fill-in would cost before you spend anything.

Paid rungs activate only when their key is in the environment (`PROSPEO_API_KEY`, `LEADMAGIC_API_KEY`). No key means the provider is skipped silently.

## Command line

```bash
npx openenrich                                  # the app, in your browser

openenrich verify list.csv                      # writes list.verified.csv
openenrich verify jane@acme.com bob@acme.com    # prints the verdicts
openenrich run leads.csv --concurrency 8        # find addresses, writes leads.enriched.csv
openenrich run leads.csv --dry-run              # free rungs only, projects paid cost
openenrich find "Jane Smith" acme.com           # one lookup
openenrich company acme.com                     # free firmographics for a domain
```

Useful flags: `--providers scrape,local,prospeo` (waterfall order), `--max-cost 5`, `--no-smtp`, `--smtp-timeout 5000`, `--out path`.

## Your agent can run it

OpenEnrich ships an MCP server. Connect Claude Code or any MCP client:

- `verify_emails` - check addresses you already have, inline or from a file
- `enrich_person` - run the waterfall on a name + domain
- `find_email` - the address alone
- `enrich_company` - free firmographics for a domain
- `enrich_csv` - a file in, an enriched file out, plus the cost ledger

```json
{ "mcpServers": { "openenrich": { "command": "npx", "args": ["-y", "openenrich-mcp"] } } }
```

Enriching 10,000 rows burns zero LLM tokens: the waterfall is a deterministic pipeline, not an agent guessing.

## Why not just use the cheap SaaS

You can, and sometimes you should. The difference is where your list goes. Every hosted verifier asks you to upload a list of real people to someone else's server. OpenEnrich never sends your list anywhere; the only packets that leave are the ones any mail client would send.

That is also why the SMTP rung is limited by your IP. It is a real tradeoff, not a bug we are hiding.

## Status

Working: the local engine (crawl, pattern inference, SMTP checks with honest failure classification), list verification, per-domain memory so the second person at a company is nearly free, the provider waterfall with a cost ledger and cap, CLI, browser app, MCP server. Two paid adapters (Prospeo, LeadMagic).

Not built yet: more paid adapters (FullEnrich, People Data Labs, Coresignal), the pattern commons, CRM sync, scheduling, a hosted verifier for people without a clean IP.

Open an issue with your list size and what you send, and it shapes the roadmap.

## The pattern commons

Planned: an opt-in, open dataset of domain email patterns and catch-all flags contributed by installs. Never names, never addresses, never personal data, just "this domain uses first.last@ and is not catch-all". Every user makes the free engine better for everyone. The incumbents cannot open their pattern data without commoditizing themselves.

## License

AGPL-3.0. Self-hosting is free and stays free.

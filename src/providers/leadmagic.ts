import type { NormalizedRow, Provider, Result } from "../core/types.js";

// LeadMagic Email Finder — https://leadmagic.io/docs/api-reference/email-finder
// POST https://api.leadmagic.io/v1/people/email-finder, header X-API-Key, body {first_name,last_name,domain}.
export function createLeadMagicProvider(): Provider | null {
  const key = process.env.LEADMAGIC_API_KEY;
  if (!key) return null; // silently skipped when no key

  return {
    name: "leadmagic",
    cost: 0.0099, // ~0.5 credit; adjust to your plan
    async lookup(row: NormalizedRow): Promise<Result | null> {
      try {
        const res = await fetch(
          "https://api.leadmagic.io/v1/people/email-finder",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-API-Key": key },
            body: JSON.stringify({
              first_name: row.first,
              last_name: row.last,
              domain: row.domain,
            }),
          },
        );
        if (!res.ok) return null;
        const json: any = await res.json();
        if (!json?.email || json?.status !== "valid") return null;
        return {
          email: json.email,
          source: "leadmagic",
          cost: this.cost,
          verified: true,
          method: "api",
        };
      } catch {
        return null;
      }
    },
  };
}

import type { NormalizedRow, Provider, Result } from "../core/types.js";

// Prospeo Email Finder — https://prospeo.io/api-docs
// POST https://api.prospeo.io/email-finder, header X-KEY, body {first_name,last_name,company}.
export function createProspeoProvider(): Provider | null {
  const key = process.env.PROSPEO_API_KEY;
  if (!key) return null; // silently skipped when no key

  return {
    name: "prospeo",
    cost: 0.0099, // ~0.5 credit; adjust to your plan
    async lookup(row: NormalizedRow): Promise<Result | null> {
      try {
        const res = await fetch("https://api.prospeo.io/email-finder", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-KEY": key },
          body: JSON.stringify({
            first_name: row.first,
            last_name: row.last,
            company: row.domain,
          }),
        });
        if (!res.ok) return null;
        const json: any = await res.json();
        const email: string | undefined = json?.response?.email ?? json?.email;
        if (!email) return null;
        const status = json?.response?.email_status ?? json?.email_status;
        return {
          email,
          source: "prospeo",
          cost: this.cost,
          verified: status === "VALID" || status === "valid",
          method: "api",
        };
      } catch {
        return null;
      }
    },
  };
}

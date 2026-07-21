import type { NormalizedRow, Provider, Result } from "../core/types.js";

interface ApiConfig {
  name: string;
  cost: number;
  keyEnv: string;
  keyHeader: string;
  url: string;
  body: (row: NormalizedRow) => unknown;
  parse: (json: any) => { email?: string; verified: boolean };
}

function apiProvider(cfg: ApiConfig): Provider | null {
  const key = process.env[cfg.keyEnv];
  if (!key) return null;
  return {
    name: cfg.name,
    cost: cfg.cost,
    async lookup(row: NormalizedRow): Promise<Result | null> {
      try {
        const res = await fetch(cfg.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", [cfg.keyHeader]: key },
          body: JSON.stringify(cfg.body(row)),
        });
        if (!res.ok) return null;
        const { email, verified } = cfg.parse(await res.json());
        if (!email) return null;
        return { email, source: cfg.name, cost: cfg.cost, verified, method: "api" };
      } catch {
        return null;
      }
    },
  };
}

// cost is ~0.5 credit; tune to your plan
export const createProspeoProvider = () =>
  apiProvider({
    name: "prospeo",
    cost: 0.0099,
    keyEnv: "PROSPEO_API_KEY",
    keyHeader: "X-KEY",
    url: "https://api.prospeo.io/email-finder",
    body: (r) => ({ first_name: r.first, last_name: r.last, company: r.domain }),
    parse: (j) => {
      const email = j?.response?.email ?? j?.email;
      const status = j?.response?.email_status ?? j?.email_status;
      return { email, verified: status === "VALID" || status === "valid" };
    },
  });

export const createLeadMagicProvider = () =>
  apiProvider({
    name: "leadmagic",
    cost: 0.0099,
    keyEnv: "LEADMAGIC_API_KEY",
    keyHeader: "X-API-Key",
    url: "https://api.leadmagic.io/v1/people/email-finder",
    body: (r) => ({ first_name: r.first, last_name: r.last, domain: r.domain }),
    parse: (j) => ({ email: j?.email, verified: j?.status === "valid" }),
  });

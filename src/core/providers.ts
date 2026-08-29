import type { Provider } from "./types.js";
import { createLocalProvider, type LocalOptions } from "../providers/local.js";
import { createScrapeProvider, type ScrapeOptions } from "../providers/scrape.js";
import { createProspeoProvider, createLeadMagicProvider } from "../providers/api.js";

export interface BuildOptions extends LocalOptions, ScrapeOptions {
  providers?: string[];
}

/** Free rungs first: scrape has real evidence, and its learned pattern feeds local. */
export const DEFAULT_PROVIDERS = ["scrape", "local"];

// Paid providers with no API key in env return null and are dropped, so the
// waterfall still runs on the free rungs alone.
const factories: Record<string, (o: BuildOptions) => Provider | null> = {
  local: (o) => createLocalProvider(o),
  scrape: (o) => createScrapeProvider(o),
  prospeo: () => createProspeoProvider(),
  leadmagic: () => createLeadMagicProvider(),
};

export const PROVIDER_NAMES = Object.keys(factories);

export function buildProviders(opts: BuildOptions = {}): Provider[] {
  const names = [
    ...new Set((opts.providers ?? DEFAULT_PROVIDERS).map((n) => n.trim().toLowerCase())),
  ];
  return names
    .filter(Boolean)
    .map((name) => {
      const factory = factories[name];
      if (!factory) {
        console.error(
          `openenrich: unknown provider "${name}" (have: ${PROVIDER_NAMES.join(", ")})`,
        );
        return null;
      }
      return factory(opts);
    })
    .filter((p): p is Provider => p !== null);
}

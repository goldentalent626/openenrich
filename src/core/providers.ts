import type { Provider } from "./types.js";
import { createLocalProvider, type LocalOptions } from "../providers/local.js";
import { createProspeoProvider, createLeadMagicProvider } from "../providers/api.js";

export interface BuildOptions extends LocalOptions {
  providers: string[];
}

// Paid providers with no API key in env return null and are dropped, so the
// waterfall still runs on local alone.
const factories: Record<string, (o: BuildOptions) => Provider | null> = {
  local: (o) => createLocalProvider(o),
  prospeo: () => createProspeoProvider(),
  leadmagic: () => createLeadMagicProvider(),
};

export function buildProviders(opts: BuildOptions): Provider[] {
  return opts.providers
    .map((name) => factories[name.trim().toLowerCase()]?.(opts) ?? null)
    .filter((p): p is Provider => p !== null);
}

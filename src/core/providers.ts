import type { Provider } from "./types.js";
import { createLocalProvider, type LocalOptions } from "../providers/local.js";
import { createProspeoProvider } from "../providers/prospeo.js";
import { createLeadMagicProvider } from "../providers/leadmagic.js";

export interface BuildOptions extends LocalOptions {
  /** Ordered provider names, e.g. ["local","prospeo","leadmagic"]. */
  providers: string[];
}

/**
 * Build the provider list in the requested order. Paid providers with no API
 * key in env are silently dropped so the waterfall still runs on local alone.
 */
export function buildProviders(opts: BuildOptions): Provider[] {
  const out: Provider[] = [];
  for (const name of opts.providers) {
    switch (name.trim().toLowerCase()) {
      case "local":
        out.push(createLocalProvider(opts));
        break;
      case "prospeo": {
        const p = createProspeoProvider();
        if (p) out.push(p);
        break;
      }
      case "leadmagic": {
        const p = createLeadMagicProvider();
        if (p) out.push(p);
        break;
      }
      default:
        // Unknown provider name — ignore.
        break;
    }
  }
  return out;
}

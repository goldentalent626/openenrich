import type { NormalizedRow, Provider, Result, Row } from "./types.js";
import { normalizeRow, cacheKey } from "./normalize.js";
import { Cache } from "./cache.js";

export interface EnrichContext {
  cache?: Cache;
}

/**
 * Run providers in order, stopping at the first VERIFIED hit.
 * A cached hit costs $0 and short-circuits before any provider runs.
 * If no provider verifies, the last non-null (best-effort) result is returned.
 */
export async function enrichRow(
  input: Row,
  providers: Provider[],
  ctx: EnrichContext = {},
): Promise<Result | null> {
  const row = normalizeRow(input);
  if (!row) return null;

  const cache = ctx.cache;
  if (cache) {
    const key = cacheKey(row);
    const hit = cache.get(key);
    if (hit) {
      return { ...hit, cost: 0, method: "cache", source: hit.source };
    }
  }

  const result = await runWaterfall(row, providers);

  if (cache && result) {
    cache.set(cacheKey(row), result);
  }
  return result;
}

async function runWaterfall(
  row: NormalizedRow,
  providers: Provider[],
): Promise<Result | null> {
  let best: Result | null = null;
  for (const provider of providers) {
    const res = await provider.lookup(row);
    if (!res) continue;
    if (res.verified) return res; // stop at first verified hit
    if (!best) best = res; // remember first best-effort guess
  }
  return best;
}

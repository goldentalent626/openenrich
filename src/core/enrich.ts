import type { NormalizedRow, Provider, Result, Row } from "./types.js";
import { normalizeRow, cacheKey } from "./normalize.js";
import { Cache } from "./cache.js";

export interface EnrichContext {
  cache?: Cache;
}

export async function enrichRow(
  input: Row,
  providers: Provider[],
  ctx: EnrichContext = {},
): Promise<Result | null> {
  const row = normalizeRow(input);
  if (!row) return null;

  const { cache } = ctx;
  const key = cache ? cacheKey(row) : "";
  if (cache) {
    const hit = cache.get(key);
    if (hit) return { ...hit, cost: 0, method: "cache" };
  }

  const result = await runWaterfall(row, providers);
  if (cache && result) cache.set(key, result);
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
    if (res.verified) return res;
    best ??= res;
  }
  return best;
}

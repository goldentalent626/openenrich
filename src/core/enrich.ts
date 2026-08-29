import type { Budget, LookupContext, NormalizedRow, Provider, Result, Row } from "./types.js";
import { normalizeRow, cacheKey } from "./normalize.js";
import { DomainMemory } from "./domains.js";
import { Cache } from "./cache.js";

export interface EnrichContext {
  cache?: Cache;
  domains?: DomainMemory;
  budget?: Budget;
}

export async function enrichRow(
  input: Row,
  providers: Provider[],
  ctx: EnrichContext = {},
): Promise<Result | null> {
  const row = normalizeRow(input);
  if (!row) return null;

  const { cache } = ctx;
  const domains = ctx.domains ?? cache?.domains ?? new DomainMemory();
  const budget = ctx.budget ?? { max: Infinity, spent: 0 };

  const key = cache ? cacheKey(row) : "";
  if (cache) {
    const hit = cache.get(key);
    if (hit) return { ...hit, cost: 0, method: "cache" };
  }

  const { result, spend } = await runWaterfall(row, providers, { domains }, budget);
  budget.spent += spend;

  if (result?.verified) domains.learnFromEmail(row, result.email, result.method);
  if (cache && result) cache.set(key, result);
  return result;
}

async function runWaterfall(
  row: NormalizedRow,
  providers: Provider[],
  lookup: LookupContext,
  budget: Budget,
): Promise<{ result: Result | null; spend: number }> {
  let best: Result | null = null;
  let spend = 0;

  for (const provider of providers) {
    if (provider.cost > 0 && budget.spent + spend + provider.cost > budget.max) continue;

    const res = await provider.lookup(row, lookup);
    if (!res) continue;
    // Providers bill on an answer, not on a miss.
    spend += provider.cost;

    if (res.verified) return { result: { ...res, cost: spend }, spend };
    best ??= res;
  }

  return { result: best ? { ...best, cost: spend } : null, spend };
}

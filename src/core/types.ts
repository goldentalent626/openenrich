import type { PatternId } from "../providers/patterns.js";
import type { DomainMemory } from "./domains.js";

export interface Row {
  name?: string;
  first_name?: string;
  last_name?: string;
  domain?: string;
  company_url?: string;
}

export type VerifyMethod =
  | "smtp"
  | "pattern-only"
  | "api"
  | "cache"
  | "scrape";

export interface Result {
  email: string;
  source: string;
  /** Total spent on this row, not the winning provider's list price. */
  cost: number;
  verified: boolean;
  method: VerifyMethod;
  /** e.g. "catch-all" domain where deliverability can't be proven */
  unverifiable?: boolean;
  note?: string;
  pattern?: PatternId;
}

export interface LookupContext {
  domains: DomainMemory;
}

export interface Provider {
  name: string;
  cost: number;
  lookup(row: NormalizedRow, ctx: LookupContext): Promise<Result | null>;
}

/** A row after name/domain have been extracted and cleaned. */
export interface NormalizedRow {
  first: string;
  last: string;
  fullName: string;
  domain: string;
  raw: Row;
}

export interface Budget {
  max: number;
  spent: number;
}

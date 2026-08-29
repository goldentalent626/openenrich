import { inferPattern, type PatternId } from "../providers/patterns.js";
import type { NormalizedRow } from "./types.js";

/**
 * What we know about a domain, independent of any person. Persisted between runs:
 * the second lead at a company costs less than the first.
 */
export interface DomainFact {
  pattern?: PatternId;
  patternSource?: string;
  catchAll?: boolean;
  noMx?: boolean;
  mx?: string[];
  roleEmails?: string[];
  title?: string;
  description?: string;
  socials?: string[];
  scrapedAt?: number;
  /** Disallow prefixes from robots.txt for user-agent *, cached per domain. */
  robots?: string[];
}

const STRENGTH: Record<string, number> = { scrape: 3, smtp: 3, api: 2, structural: 1 };

export class DomainMemory {
  constructor(private data: Record<string, DomainFact> = {}) {}

  get(domain: string): DomainFact {
    return this.data[domain] ?? {};
  }

  patch(domain: string, fact: DomainFact): void {
    this.data[domain] = { ...this.get(domain), ...fact };
  }

  pattern(domain: string): PatternId | undefined {
    return this.get(domain).pattern;
  }

  learn(domain: string, pattern: PatternId, source: string): void {
    const current = this.get(domain);
    const better = (STRENGTH[source] ?? 0) > (STRENGTH[current.patternSource ?? ""] ?? 0);
    if (current.pattern && !better) return;
    this.patch(domain, { pattern, patternSource: source });
  }

  learnFromEmail(row: NormalizedRow, email: string, source: string): PatternId | undefined {
    const pattern = inferPattern(email, row.first, row.last);
    if (!pattern) return undefined;
    this.learn(row.domain, pattern, source);
    return pattern;
  }

  toJSON(): Record<string, DomainFact> {
    return this.data;
  }

  get known(): number {
    return Object.values(this.data).filter((f) => f.pattern).length;
  }
}

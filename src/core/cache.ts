import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DomainMemory, type DomainFact } from "./domains.js";
import type { Result } from "./types.js";

interface CacheFile {
  version?: number;
  rows?: Record<string, Result>;
  domains?: Record<string, DomainFact>;
}

/**
 * JSON file cache. Rows are keyed by name+domain and a hit costs $0. Domain facts
 * (email pattern, catch-all, MX) are keyed by domain and outlive any single row.
 */
export class Cache {
  private path: string;
  private rows: Record<string, Result> = {};
  readonly domains: DomainMemory;

  constructor(path = ".openenrich-cache.json") {
    this.path = path;
    let file: CacheFile = {};
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        file = parsed?.version ? parsed : { rows: parsed };
      } catch {
        file = {};
      }
    }
    this.rows = file.rows ?? {};
    this.domains = new DomainMemory(file.domains ?? {});
  }

  get(key: string): Result | undefined {
    return this.rows[key];
  }

  set(key: string, result: Result): void {
    this.rows[key] = result;
  }

  flush(): void {
    const file: CacheFile = { version: 2, rows: this.rows, domains: this.domains.toJSON() };
    writeFileSync(this.path, JSON.stringify(file, null, 2));
  }
}

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { Result } from "./types.js";

/** Minimal JSON file cache keyed by name+domain. A cached hit costs $0. */
export class Cache {
  private path: string;
  private data: Record<string, Result> = {};

  constructor(path = ".openenrich-cache.json") {
    this.path = path;
    if (existsSync(path)) {
      try {
        this.data = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        this.data = {};
      }
    }
  }

  get(key: string): Result | undefined {
    return this.data[key];
  }

  set(key: string, result: Result): void {
    this.data[key] = result;
  }

  flush(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}

import type { NormalizedRow } from "../core/types.js";

/**
 * Candidate email patterns, ordered by real-world prevalence.
 * The first entry is the "top guess" used when SMTP is unavailable.
 */
export function candidateEmails(row: NormalizedRow): string[] {
  const { first, last, domain } = row;
  const f = first;
  const l = last;
  const candidates: string[] = [];

  if (f && l) {
    candidates.push(`${f}.${l}@${domain}`); // first.last
    candidates.push(`${f[0]}${l}@${domain}`); // flast
    candidates.push(`${f}@${domain}`); // first
    candidates.push(`${f[0]}.${l}@${domain}`); // f.last
    candidates.push(`${f}${l}@${domain}`); // firstlast
  } else if (f) {
    candidates.push(`${f}@${domain}`);
  }

  // Dedup while preserving order.
  return [...new Set(candidates)];
}

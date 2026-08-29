import type { NormalizedRow } from "../core/types.js";

export type PatternId =
  | "first.last"
  | "flast"
  | "first"
  | "f.last"
  | "firstlast"
  | "first_last"
  | "first-last"
  | "last.first"
  | "lastf"
  | "firstl"
  | "last";

type Template = (first: string, last: string) => string | null;

const both = (fn: Template): Template => (f, l) => (f && l ? fn(f, l) : null);

const TEMPLATES: Record<PatternId, Template> = {
  "first.last": both((f, l) => `${f}.${l}`),
  flast: both((f, l) => `${f[0]}${l}`),
  first: (f) => f || null,
  "f.last": both((f, l) => `${f[0]}.${l}`),
  firstlast: both((f, l) => `${f}${l}`),
  first_last: both((f, l) => `${f}_${l}`),
  "first-last": both((f, l) => `${f}-${l}`),
  "last.first": both((f, l) => `${l}.${f}`),
  lastf: both((f, l) => `${l}${f[0]}`),
  firstl: both((f, l) => `${f}${l[0]}`),
  last: (_f, l) => l || null,
};

/** Probed over SMTP, most prevalent first. Kept short: MTAs tarpit after a few RCPTs. */
const PROBE_ORDER: PatternId[] = ["first.last", "flast", "first", "f.last", "firstlast"];

export const PATTERN_IDS = Object.keys(TEMPLATES) as PatternId[];

export function applyPattern(id: PatternId, row: NormalizedRow): string | null {
  const local = TEMPLATES[id]?.(row.first, row.last);
  return local ? `${local}@${row.domain}` : null;
}

export function candidateEmails(row: NormalizedRow, learned?: PatternId): string[] {
  const ids = learned ? [learned, ...PROBE_ORDER] : PROBE_ORDER;
  const emails = ids
    .map((id) => applyPattern(id, row))
    .filter((e): e is string => e !== null);
  return [...new Set(emails)];
}

/** Which template produced this email for this person, if any. */
export function inferPattern(email: string, first: string, last: string): PatternId | null {
  const local = email.split("@")[0]?.toLowerCase();
  if (!local) return null;
  for (const id of PATTERN_IDS) {
    if (TEMPLATES[id](first, last) === local) return id;
  }
  return null;
}

/**
 * Guess a domain's pattern from a published email whose owner is unknown, using
 * only the separator shape.
 * ponytail: no name attribution, so single-token locals stay unknown. Upgrade path
 * is pairing each email with the nearest name in the page text.
 */
export function structuralPattern(email: string): PatternId | null {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  const pair = /^([a-z]{2,})([._-])([a-z]{2,})$/.exec(local);
  if (pair) {
    return pair[2] === "." ? "first.last" : pair[2] === "_" ? "first_last" : "first-last";
  }
  const initial = /^([a-z])([._])([a-z]{2,})$/.exec(local);
  if (initial) return initial[2] === "." ? "f.last" : null;
  return null;
}

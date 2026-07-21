import type { NormalizedRow, Row } from "./types.js";

function stripDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  d = d.split("?")[0];
  d = d.split(":")[0];
  return d;
}

export function normalizeRow(row: Row): NormalizedRow | null {
  let first = (row.first_name ?? "").trim();
  let last = (row.last_name ?? "").trim();

  if ((!first || !last) && row.name) {
    const parts = row.name.trim().split(/\s+/);
    if (!first) first = parts[0] ?? "";
    if (!last && parts.length > 1) last = parts[parts.length - 1];
  }

  const domainSource = row.domain || row.company_url;
  if (!domainSource || !first) return null;

  const domain = stripDomain(domainSource);
  if (!domain || !domain.includes(".")) return null;

  const fullName = [first, last].filter(Boolean).join(" ");
  return {
    first: first.toLowerCase().replace(/[^a-z]/g, ""),
    last: last.toLowerCase().replace(/[^a-z]/g, ""),
    fullName,
    domain,
    raw: row,
  };
}

export function cacheKey(row: NormalizedRow): string {
  return `${row.fullName.toLowerCase()}|${row.domain}`;
}

import { mailProvider, mxHosts } from "./mx.js";
import { DomainMemory } from "./domains.js";
import { isSmtpBlocked, noteSmtpBlocked, probe, withHostLock } from "../providers/local.js";
import { ROLE_LOCALS } from "../providers/scrape.js";

export type VerifyStatus = "valid" | "invalid" | "risky" | "unknown";

export interface VerifiedEmail {
  [column: string]: unknown;
  email: string;
  status: VerifyStatus;
  reason: string;
  role: boolean;
  disposable: boolean;
  provider?: string;
}

export interface VerifyOptions {
  smtp?: boolean;
  smtpTimeoutMs?: number;
  mailFrom?: string;
  concurrency?: number;
  domains?: DomainMemory;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; row: VerifiedEmail }) => void;
}

export interface VerifySummary {
  total: number;
  valid: number;
  invalid: number;
  risky: number;
  unknown: number;
}

const SYNTAX = /^[^\s@,;:<>()[\]\\"]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "sharklasers.com", "10minutemail.com",
  "tempmail.com", "temp-mail.org", "yopmail.com", "throwawaymail.com", "getnada.com",
  "trashmail.com", "dispostable.com", "maildrop.cc", "fakeinbox.com", "mailnesia.com",
  "spamgourmet.com", "mytemp.email", "moakt.com", "emailondeck.com", "tempr.email",
  "mohmal.com", "burnermail.io", "inboxkitten.com", "mailsac.com", "1secmail.com",
]);

export function verifySummary(rows: VerifiedEmail[]): VerifySummary {
  return {
    total: rows.length,
    valid: rows.filter((r) => r.status === "valid").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
    risky: rows.filter((r) => r.status === "risky").length,
    unknown: rows.filter((r) => r.status === "unknown").length,
  };
}

const HEADERS = new Set(["email", "emails", "e-mail", "email_address", "address", "mail"]);

/**
 * A lone word on its own line is kept so it can be reported invalid: a list that comes
 * back shorter than it went in is how a verifier loses someone's trust.
 */
export function extractEmails(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const fields = line
      .split(/[\s,;"']+/)
      .map((f) => f.trim().replace(/^<|>$/g, "").toLowerCase())
      .filter(Boolean);
    const addresses = fields.filter((f) => f.includes("@"));
    if (addresses.length) addresses.forEach((a) => seen.add(a));
    else if (fields.length === 1 && !HEADERS.has(fields[0])) seen.add(fields[0]);
  }
  return [...seen];
}

async function verifyOne(
  email: string,
  domains: DomainMemory,
  opts: VerifyOptions,
): Promise<VerifiedEmail> {
  const local = email.slice(0, email.lastIndexOf("@")).toLowerCase();
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const base: VerifiedEmail = {
    email,
    status: "unknown",
    reason: "",
    role: ROLE_LOCALS.has(local),
    disposable: DISPOSABLE.has(domain),
  };

  if (!SYNTAX.test(email)) {
    return { ...base, status: "invalid", reason: "not a valid address" };
  }
  if (base.disposable) {
    return { ...base, status: "risky", reason: "disposable inbox, it will be gone soon" };
  }

  const fact = domains.get(domain);
  let mx = fact.mx;
  if (fact.noMx) mx = [];
  if (!mx) {
    mx = await mxHosts(domain);
    domains.patch(domain, mx.length ? { mx } : { noMx: true });
  }
  base.provider = mailProvider(mx);

  if (!mx.length) {
    return { ...base, status: "invalid", reason: "domain accepts no mail at all" };
  }
  if (!opts.smtp) {
    return { ...base, status: "unknown", reason: "domain is real, mailbox not probed" };
  }
  const host = mx[0];
  if (isSmtpBlocked(host)) {
    return {
      ...base,
      status: "unknown",
      reason: `${base.provider ?? host} refuses this IP; run it from a VPS`,
    };
  }
  if (fact.catchAll) {
    return { ...base, status: "risky", reason: "catch-all domain, every address is accepted" };
  }

  const verdict = await withHostLock(host, () =>
    probe(host, [email], domain, opts.smtpTimeoutMs ?? 5000, opts.mailFrom ?? "verify@openenrich.dev"),
  );

  switch (verdict.kind) {
    case "deliverable":
      return { ...base, status: "valid", reason: "the mail server accepted this mailbox" };
    case "rejected":
      return { ...base, status: "invalid", reason: "the mail server says no such mailbox" };
    case "catch-all":
      domains.patch(domain, { catchAll: true });
      return { ...base, status: "risky", reason: "catch-all domain, every address is accepted" };
    case "blocked":
      noteSmtpBlocked(host);
      return { ...base, status: "unknown", reason: `${host} refused our IP, not this address` };
    case "unreachable":
      return { ...base, status: "unknown", reason: "mail server did not answer in time" };
  }
}

/**
 * Grouped by domain so one MX lookup and one catch-all probe serve every address there,
 * and probes stay serialized per mail host by the same lock the finder uses.
 */
export async function verifyEmails(
  emails: string[],
  opts: VerifyOptions = {},
): Promise<VerifiedEmail[]> {
  const domains = opts.domains ?? new DomainMemory();
  const out = new Array<VerifiedEmail>(emails.length);

  const buckets = new Map<string, number[]>();
  emails.forEach((email, i) => {
    const key = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  });

  const queue = [...buckets.values()];
  const workers = Math.max(1, Math.min(opts.concurrency ?? 8, queue.length));
  let cursor = 0;
  let done = 0;

  const run = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (opts.signal?.aborted) return;
      for (const i of queue[cursor++]) {
        out[i] = await verifyOne(emails[i], domains, opts);
        done++;
        opts.onProgress?.({ done, total: emails.length, row: out[i] });
      }
    }
  };

  await Promise.all(Array.from({ length: workers }, run));
  return out;
}

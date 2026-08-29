import net from "node:net";
import type { LookupContext, NormalizedRow, Provider, Result } from "../core/types.js";
import { mxHosts } from "../core/mx.js";
import { candidateEmails } from "./patterns.js";

export interface LocalOptions {
  /** Skip the SMTP step entirely (pattern + MX only). */
  noSmtp?: boolean;
  /** Per-connection SMTP timeout, ms. */
  smtpTimeoutMs?: number;
  /** MAIL FROM address used in the probe. */
  mailFrom?: string;
}

export type Verdict =
  | { kind: "deliverable"; email: string }
  | { kind: "rejected" }
  | { kind: "catch-all" }
  | { kind: "blocked" }
  | { kind: "unreachable" };

const HELO_HOST = "openenrich.dev";
const MAX_PROBES = 3;
/** Consecutive host-policy rejections before we stop probing for the rest of the process. */
const BLOCKED_LIMIT = 3;

/**
 * A residential or cloud IP gets refused by strict MTAs, which looks identical to
 * "no such user" unless the reply is classified. Refusal is a property of the receiving
 * provider, not of this network: Microsoft blocks residential IPs while Google answers
 * normally. A global latch let three Microsoft domains strand every Google one behind
 * them, so count refusals per provider and only give up on that provider.
 */
const blockedBy = new Map<string, number>();

const providerKey = (host: string): string => {
  const h = host.toLowerCase();
  if (/protection\.outlook|outlook|microsoft/.test(h)) return "microsoft";
  if (/google|aspmx/.test(h)) return "google";
  if (/pphosted|proofpoint/.test(h)) return "proofpoint";
  if (/mimecast/.test(h)) return "mimecast";
  if (/zoho/.test(h)) return "zoho";
  if (/secureserver/.test(h)) return "godaddy";
  return h.split(".").slice(-2).join(".");
};

export const isSmtpBlocked = (host?: string): boolean => {
  if (!host) return false;
  return (blockedBy.get(providerKey(host)) ?? 0) >= BLOCKED_LIMIT;
};
export const noteSmtpBlocked = (host?: string): void => {
  if (!host) return;
  const key = providerKey(host);
  blockedBy.set(key, (blockedBy.get(key) ?? 0) + 1);
};

/**
 * Millions of domains share one MX, so batching by domain still points parallel probes
 * at the same host and earns a tarpit. Probes are serialized per MX host instead.
 * ponytail: no global cap, so N distinct MX hosts means N sockets. Add one if that bites.
 */
const hostLocks = new Map<string, Promise<unknown>>();

export function withHostLock<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previous = hostLocks.get(host) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.then(
    () => {},
    () => {},
  );
  hostLocks.set(host, settled);
  settled.then(() => {
    if (hostLocks.get(host) === settled) hostLocks.delete(host);
  });
  return next;
}

interface Reply {
  code: number;
  text: string;
}

interface Session {
  reply(): Promise<Reply>;
  cmd(line: string): Promise<Reply>;
  close(): void;
}

const DEAD: Reply = { code: 0, text: "" };

/** Resolves null when the host is unreachable. A dead socket answers every await with code 0. */
function open(host: string, timeoutMs: number): Promise<Session | null> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    const received: Reply[] = [];
    const waiting: ((reply: Reply) => void)[] = [];
    let buf = "";
    let parts: string[] = [];
    let dead = false;

    const die = () => {
      if (dead) return;
      dead = true;
      while (waiting.length) waiting.shift()!(DEAD);
      socket.destroy();
      resolve(null);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", die);
    socket.on("error", die);
    socket.on("close", die);

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        parts.push(line);
        if (line.length >= 4 && line[3] === "-") continue;
        const reply: Reply = {
          code: parseInt(line.slice(0, 3), 10) || 0,
          text: parts.join(" "),
        };
        parts = [];
        const next = waiting.shift();
        if (next) next(reply);
        else received.push(reply);
      }
    });

    const reply = (): Promise<Reply> => {
      const queued = received.shift();
      if (queued) return Promise.resolve(queued);
      if (dead) return Promise.resolve(DEAD);
      return new Promise<Reply>((res) => waiting.push(res));
    };

    socket.on("connect", () => {
      resolve({
        reply,
        cmd(line) {
          if (dead) return Promise.resolve(DEAD);
          socket.write(`${line}\r\n`);
          return reply();
        },
        close() {
          if (dead) return;
          dead = true;
          try {
            socket.write("QUIT\r\n");
            socket.end();
          } catch {
            /* already gone */
          }
          socket.destroy();
        },
      });
    });
  });
}

type RcptVerdict = "accepted" | "no-such-user" | "policy" | "temporary" | "dead";

const POLICY_TEXT =
  /client host|dynamic|blocked|blacklist|blocklist|spamhaus|relay (access )?denied|not permitted|reverse dns|rdns|ptr record|policy|reputation|authentication required|banned|unverified/i;

/**
 * 5.7.x is policy or security: the server is refusing us, not denying the recipient.
 * Reading a 554 5.7.1 as "no such user" is how a verifier invents nonexistent people.
 */
function classify({ code, text }: Reply): RcptVerdict {
  if (code === 0) return "dead";
  if (code >= 200 && code < 300) return "accepted";
  const subject = Number(/\b[245]\.(\d+)\.\d+\b/.exec(text)?.[1] ?? -1);
  if (subject === 7 || POLICY_TEXT.test(text)) return "policy";
  if (code >= 500) return "no-such-user";
  return "temporary";
}

/**
 * One connection, one HELO, a catch-all probe then each candidate. Never reaches DATA,
 * so no mail is ever sent.
 */
export async function probe(
  mx: string,
  candidates: string[],
  domain: string,
  timeoutMs: number,
  mailFrom: string,
): Promise<Verdict> {
  const session = await open(mx, timeoutMs);
  if (!session) return { kind: "unreachable" };
  try {
    if ((await session.reply()).code !== 220) return { kind: "unreachable" };

    let hello = await session.cmd(`EHLO ${HELO_HOST}`);
    if (hello.code < 200 || hello.code >= 400) hello = await session.cmd(`HELO ${HELO_HOST}`);
    if (hello.code < 200 || hello.code >= 400) return { kind: "unreachable" };

    const rcpt = async (email: string): Promise<RcptVerdict> => {
      const from = await session.cmd(`MAIL FROM:<${mailFrom}>`);
      if (from.code < 200 || from.code >= 400) return classify(from);
      const to = await session.cmd(`RCPT TO:<${email}>`);
      await session.cmd("RSET");
      return classify(to);
    };

    const control = await rcpt(`oe-probe-${Date.now().toString(36)}@${domain}`);
    if (control === "accepted") return { kind: "catch-all" };
    if (control === "policy") return { kind: "blocked" };
    if (control !== "no-such-user") return { kind: "unreachable" };

    for (const email of candidates) {
      const verdict = await rcpt(email);
      if (verdict === "accepted") return { kind: "deliverable", email };
      if (verdict === "policy") return { kind: "blocked" };
      if (verdict !== "no-such-user") return { kind: "unreachable" };
    }
    return { kind: "rejected" };
  } finally {
    session.close();
  }
}

export function createLocalProvider(opts: LocalOptions = {}): Provider {
  const timeoutMs = opts.smtpTimeoutMs ?? 5000;
  // Receiving MTAs check that the sender domain resolves, so this has to be a real one.
  const mailFrom = opts.mailFrom ?? process.env.OPENENRICH_MAIL_FROM ?? "verify@openenrich.dev";

  return {
    name: "local",
    cost: 0,
    async lookup(row: NormalizedRow, ctx: LookupContext): Promise<Result | null> {
      const fact = ctx.domains.get(row.domain);
      if (fact.noMx) return null;

      const learned = fact.pattern;
      const candidates = candidateEmails(row, learned);
      if (!candidates.length) return null;

      let known = fact.mx;
      if (!known) {
        known = await mxHosts(row.domain);
        ctx.domains.patch(row.domain, known.length ? { mx: known } : { noMx: true });
      }
      const mx = known[0];
      if (!mx) return null;

      const guess = (note: string, unverifiable?: boolean): Result => ({
        email: candidates[0],
        source: "local",
        cost: 0,
        verified: false,
        method: "pattern-only",
        pattern: learned,
        note,
        unverifiable,
      });

      if (opts.noSmtp) {
        return guess(learned ? `learned pattern ${learned}, smtp disabled` : "smtp disabled");
      }
      if (isSmtpBlocked(mx)) {
        return guess("smtp verification unavailable for this mail provider; use a VPS or a paid provider");
      }
      if (fact.catchAll) {
        return guess("catch-all domain; deliverability unprovable", true);
      }

      const verdict = await withHostLock(mx, () =>
        probe(mx, candidates.slice(0, MAX_PROBES), row.domain, timeoutMs, mailFrom),
      );

      switch (verdict.kind) {
        case "deliverable": {
          const pattern = ctx.domains.learnFromEmail(row, verdict.email, "smtp");
          return {
            email: verdict.email,
            source: "local",
            cost: 0,
            verified: true,
            method: "smtp",
            pattern,
          };
        }
        case "catch-all":
          ctx.domains.patch(row.domain, { catchAll: true });
          return guess("catch-all domain; deliverability unprovable", true);
        case "blocked":
          noteSmtpBlocked(mx);
          return guess(`${mx} refused this IP, not the address; result is a pattern guess`);
        case "unreachable":
          return guess("smtp unreachable (port 25 blocked, timeout, or rate limited)");
        case "rejected":
          // The server does real recipient checks and denied every candidate, so a
          // guess here would be known-bad data.
          return null;
      }
    },
  };
}

export const __test = { classify, probe };

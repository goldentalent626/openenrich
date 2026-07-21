import { resolveMx } from "node:dns/promises";
import net from "node:net";
import type { NormalizedRow, Provider, Result } from "../core/types.js";
import { candidateEmails } from "./patterns.js";

export interface LocalOptions {
  /** Skip the SMTP step entirely (pattern + MX only). */
  noSmtp?: boolean;
  /** Per-connection SMTP timeout, ms. */
  smtpTimeoutMs?: number;
  /** MAIL FROM address used in the probe. */
  mailFrom?: string;
}

type SmtpVerdict = "deliverable" | "rejected" | "catch-all" | "unreachable";

async function mxHosts(domain: string): Promise<string[]> {
  try {
    const records = await resolveMx(domain);
    if (!records.length) return [];
    return records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange);
  } catch {
    return [];
  }
}

/** Read one full SMTP reply line, returning its 3-digit code. */
function code(line: string): number {
  return parseInt(line.slice(0, 3), 10);
}

/**
 * Probe a single recipient over SMTP. Connects to the MX host on port 25 and
 * runs HELO / MAIL FROM / RCPT TO, closing before DATA. Never sends mail.
 * Any connection/port failure resolves to "unreachable" (never throws).
 */
function smtpProbe(
  mx: string,
  email: string,
  catchAllProbe: string,
  timeoutMs: number,
  mailFrom: string,
): Promise<SmtpVerdict> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: mx, port: 25 });
    let stage = 0;
    let rcptCode = 0;
    let catchAllCode = 0;
    let settled = false;

    const done = (v: SmtpVerdict) => {
      if (settled) return;
      settled = true;
      try {
        socket.write("QUIT\r\n");
        socket.end();
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(v);
    };

    socket.setTimeout(timeoutMs);
    socket.on("timeout", () => done("unreachable"));
    socket.on("error", () => done("unreachable"));

    let buf = "";
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      // SMTP replies end with "\r\n"; multiline uses "250-" continuation.
      let idx: number;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        // Ignore continuation lines (4th char is '-').
        if (line.length >= 4 && line[3] === "-") continue;
        handle(line);
      }
    });

    function handle(line: string) {
      const c = code(line);
      switch (stage) {
        case 0: // greeting
          if (c !== 220) return done("unreachable");
          socket.write("HELO openenrich.local\r\n");
          stage = 1;
          break;
        case 1: // HELO ack
          socket.write(`MAIL FROM:<${mailFrom}>\r\n`);
          stage = 2;
          break;
        case 2: // MAIL FROM ack
          socket.write(`RCPT TO:<${email}>\r\n`);
          stage = 3;
          break;
        case 3: // RCPT TO for the real address
          rcptCode = c;
          // Now test a definitely-nonexistent address to detect catch-all.
          socket.write(`RCPT TO:<${catchAllProbe}>\r\n`);
          stage = 4;
          break;
        case 4: // RCPT TO for the catch-all probe
          catchAllCode = c;
          if (rcptCode >= 200 && rcptCode < 300) {
            if (catchAllCode >= 200 && catchAllCode < 300) {
              return done("catch-all");
            }
            return done("deliverable");
          }
          if (rcptCode >= 500 && rcptCode < 600) return done("rejected");
          // 4xx greylisting / temporary — treat as unreachable, degrade.
          return done("unreachable");
      }
    }
  });
}

export function createLocalProvider(opts: LocalOptions = {}): Provider {
  const timeoutMs = opts.smtpTimeoutMs ?? 5000;
  const mailFrom = opts.mailFrom ?? "verify@openenrich.local";

  return {
    name: "local",
    cost: 0,
    async lookup(row: NormalizedRow): Promise<Result | null> {
      const candidates = candidateEmails(row);
      if (!candidates.length) return null;
      const top = candidates[0];

      const hosts = await mxHosts(row.domain);
      if (!hosts.length) {
        // No MX = domain can't receive mail. Skip (waterfall moves on).
        return null;
      }

      if (opts.noSmtp) {
        return {
          email: top,
          source: "local",
          cost: 0,
          verified: false,
          method: "pattern-only",
          note: "smtp disabled (--no-smtp)",
        };
      }

      const mx = hosts[0];
      const catchAllProbe = `no-such-user-${Date.now()}@${row.domain}`;

      for (const email of candidates) {
        const verdict = await smtpProbe(
          mx,
          email,
          catchAllProbe,
          timeoutMs,
          mailFrom,
        );
        if (verdict === "deliverable") {
          return {
            email,
            source: "local",
            cost: 0,
            verified: true,
            method: "smtp",
          };
        }
        if (verdict === "catch-all") {
          return {
            email: top,
            source: "local",
            cost: 0,
            verified: false,
            method: "pattern-only",
            unverifiable: true,
            note: "catch-all domain; deliverability unprovable",
          };
        }
        if (verdict === "unreachable") {
          // Port 25 blocked / timeout / greylist. DEGRADE, do not crash.
          return {
            email: top,
            source: "local",
            cost: 0,
            verified: false,
            method: "pattern-only",
            note: "smtp unreachable (port 25 blocked or timeout)",
          };
        }
        // "rejected" — try the next candidate pattern.
      }

      // Every candidate was rejected by SMTP. Fall back to top pattern guess.
      return {
        email: top,
        source: "local",
        cost: 0,
        verified: false,
        method: "pattern-only",
        note: "all candidates rejected; returning top guess",
      };
    },
  };
}

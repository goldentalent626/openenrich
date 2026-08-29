import { test } from "node:test";
import assert from "node:assert/strict";
import { DomainMemory } from "../src/core/domains.js";
import { extractEmails, verifyEmails, verifySummary } from "../src/core/verify.js";

test("extractEmails pulls addresses out of any paste and dedupes", () => {
  const found = extractEmails(`jane@acme.com, bob@acme.com\n"jane@acme.com"; <x@b.co>`);
  assert.deepEqual(found, ["jane@acme.com", "bob@acme.com", "x@b.co"]);
});

test("extractEmails keeps junk rows so they can be reported, but drops CSV noise", () => {
  assert.deepEqual(extractEmails("email\nnot-an-email\njane@acme.com"), [
    "not-an-email",
    "jane@acme.com",
  ]);
  assert.deepEqual(extractEmails("name,company,email\nJane Smith,Acme,jane@acme.com"), [
    "jane@acme.com",
  ]);
});

test("syntax, disposable and dead domains are judged without touching the network", async () => {
  const domains = new DomainMemory({ "no-mail.test": { noMx: true } });
  const rows = await verifyEmails(
    ["bad address", "temp@mailinator.com", "info@no-mail.test", "jane@no-mail.test"],
    { smtp: false, domains },
  );

  assert.equal(rows[0].status, "invalid");
  assert.equal(rows[1].status, "risky");
  assert.equal(rows[1].disposable, true);
  assert.equal(rows[2].status, "invalid");
  assert.equal(rows[2].role, true, "info@ is a role address");
  assert.equal(rows[3].status, "invalid");

  assert.deepEqual(verifySummary(rows), { total: 4, valid: 0, invalid: 3, risky: 1, unknown: 0 });
});

test("a known catch-all domain is risky, never valid", async () => {
  const domains = new DomainMemory({ "catchall.test": { mx: ["mx.catchall.test"], catchAll: true } });
  const [row] = await verifyEmails(["anyone@catchall.test"], { smtp: true, domains });

  assert.equal(row.status, "risky");
  assert.match(row.reason, /catch-all/);
});

test("without SMTP a real domain is unknown, not valid", async () => {
  const domains = new DomainMemory({ "acme.test": { mx: ["mx.acme.test"] } });
  const [row] = await verifyEmails(["jane@acme.test"], { smtp: false, domains });

  assert.equal(row.status, "unknown");
});

import { createServer, type ServerResponse } from "node:http";
import { buildProviders, DEFAULT_PROVIDERS } from "./core/providers.js";
import { enrichBatch } from "./core/batch.js";
import { enrichCompany } from "./core/company.js";
import { parseCsv } from "./core/csv.js";
import { extractEmails, verifyEmails, verifySummary } from "./core/verify.js";
import { Cache } from "./core/cache.js";
import type { Row } from "./core/types.js";

const PORT = Number(process.env.PORT) || 8790;
// Loopback by default: the lists people paste in here never leave their machine,
// and node's default bind would put this UI on every interface. Verifying from a
// VPS (which is what a blocked SMTP probe tells you to do) needs HOST=0.0.0.0.
const HOST = process.env.HOST || "127.0.0.1";

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenEnrich</title>
<style>
:root{--bg:#0a0a0a;--panel:#111;--field:#161616;--ink:#f2f2f2;--dim:#9a9a9a;--faint:#5c5c5c;--line:#262626;--line2:#333}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:13px/1.65 "IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;padding:28px 24px 64px;max-width:1080px;margin:0 auto}
header{display:flex;align-items:baseline;gap:12px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:18px;flex-wrap:wrap}
h1{font-size:16px;font-weight:600;letter-spacing:.06em;display:flex;align-items:center;gap:9px}
h1 svg{width:17px;height:17px}
.tag{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);border:1px solid var(--line2);padding:2px 7px}
h2{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:500;margin:0 0 10px}
nav{display:flex;gap:0;margin-bottom:22px;border:1px solid var(--line2);width:fit-content}
nav button{background:transparent;color:var(--dim);border:0;border-right:1px solid var(--line2);padding:9px 18px;font:inherit;cursor:pointer;letter-spacing:.04em}
nav button:last-child{border-right:0}
nav button.on{background:var(--ink);color:#000;font-weight:600}
.grid{display:grid;grid-template-columns:1fr 300px;gap:24px;align-items:start}
@media(max-width:820px){.grid{grid-template-columns:1fr}}
textarea,input{width:100%;background:var(--field);color:var(--ink);border:1px solid var(--line2);padding:11px 12px;font:inherit;outline:none}
textarea{height:158px;resize:vertical}
textarea:focus,input:focus{border-color:#555}
.drop{border:1px dashed var(--line2);padding:9px 12px;color:var(--faint);font-size:11.5px;margin-top:8px;cursor:pointer;display:flex;justify-content:space-between;gap:12px}
.drop.over{border-color:var(--ink);color:var(--ink)}
.hint{color:var(--faint);font-size:11px;margin:8px 0 0}
.row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
label.ck{color:var(--dim);display:flex;gap:7px;align-items:center;cursor:pointer;font-size:12px;white-space:nowrap}
button{background:var(--ink);color:#000;border:1px solid var(--ink);font:inherit;font-weight:600;padding:10px 20px;cursor:pointer;letter-spacing:.05em}
button:disabled{opacity:.4;cursor:default}
button.ghost{background:transparent;color:var(--dim);border-color:var(--line2);font-weight:400;padding:9px 14px}
aside{background:var(--panel);border:1px solid var(--line);padding:16px}
aside dl{display:grid;grid-template-columns:1fr auto;gap:5px 10px;font-size:12px}
aside dt{color:var(--faint)}
aside dd{text-align:right;color:var(--ink)}
.bar{height:2px;background:var(--line2);margin:16px 0 4px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--ink);width:0;transition:width .18s}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--faint);font-size:10px;letter-spacing:.11em;text-transform:uppercase;font-weight:500}
td.email{color:#fff}
td.none{color:var(--faint)}
.badge{font-size:10px;letter-spacing:.06em;padding:2px 6px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap}
.badge.ok{color:#000;background:var(--ink);border-color:var(--ink)}
.badge.warn{color:#ddd;border-color:#666}
.badge.no{color:var(--faint);border-color:var(--line)}
.note{color:var(--faint);font-size:11px}
pre{background:var(--panel);border:1px solid var(--line);padding:14px;overflow:auto;font-size:11.5px;color:var(--dim);max-height:340px}
section{margin-top:34px}
.provs{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
.privacy{color:var(--faint);font-size:11px;border-left:1px solid var(--line2);padding-left:10px}
</style></head><body>
<header>
<h1><svg viewBox="0 0 512 512" fill="none"><path fill="#8a8a8a" d="M88 108h336v48H88z"/><path fill="#a8a8a8" d="M136 188h288v48H136z"/><path fill="#c9c9c9" d="M184 268h240v48H184z"/><path fill="#e6e6e6" d="M232 348h192v48H232z"/><path fill="#fff" d="M280 428h144v48H280z"/></svg> OpenEnrich</h1>
<span class="tag" id="mode">running on your machine</span>
<span class="privacy">Nothing is uploaded. Your list stays on this computer.</span>
</header>

<nav>
  <button class="on" data-tab="check">Check my list</button>
  <button data-tab="find">Find emails</button>
  <button data-tab="company">Look up a company</button>
</nav>

<div id="tab-check">
<div class="grid">
<div>
  <h2>Emails to check</h2>
  <textarea id="vin" placeholder="jane@acme.com
bob@acme.com"></textarea>
  <div class="drop" id="vdrop"><span>Drop a CSV or text file here, or click to pick one</span><span id="vfile"></span></div>
  <p class="hint">Any file with addresses in it works. Columns you don't need are ignored.</p>
  <div class="row">
    <button id="vgo">Check them</button>
    <label class="ck"><input type="checkbox" id="vsmtp" checked> ask each mail server</label>
    <button class="ghost" id="vdl" style="display:none">Download results</button>
    <button class="ghost" id="vcopy" style="display:none">Copy the safe ones</button>
  </div>
  <p class="hint">Asking the mail server proves a mailbox exists without sending anything. Some networks block it, and then rows come back as "not sure" rather than a guess dressed up as a fact.</p>
</div>

<aside>
  <h2>Result</h2>
  <dl>
    <dt>checked</dt><dd id="v-done">0 / 0</dd>
    <dt>safe to send</dt><dd id="v-valid">0</dd>
    <dt>will bounce</dt><dd id="v-invalid">0</dd>
    <dt>risky</dt><dd id="v-risky">0</dd>
    <dt>not sure</dt><dd id="v-unknown">0</dd>
  </dl>
  <div class="bar"><i id="vbar"></i></div>
  <p class="hint" id="vstat">idle</p>
</aside>
</div>

<section id="vresults" style="display:none">
  <h2>Rows</h2>
  <table><thead><tr><th>Email</th><th>Verdict</th><th>Why</th><th>Mail host</th></tr></thead><tbody id="vtb"></tbody></table>
</section>
</div>

<div id="tab-find" style="display:none">
<div class="grid">
<div>
  <h2>People to find</h2>
  <textarea id="in">Patrick Collison,stripe.com
Jane Smith,stripe.com
Steve Sloan,gitlab.com</textarea>
  <div class="drop" id="fdrop"><span>Drop a CSV here, or click to pick one</span><span id="ffile"></span></div>
  <p class="hint">One per line as <b>name,domain</b>, or a CSV with <b>name</b> and <b>domain</b> columns. People at the same company share one crawl.</p>
  <div class="row">
    <button id="go">Find emails</button>
    <label class="ck"><input type="checkbox" id="smtp" checked> ask each mail server</label>
    <label class="ck">max spend $<input type="text" id="cap" value="0" style="width:58px;padding:5px 7px"></label>
    <button class="ghost" id="fdl" style="display:none">Download results</button>
  </div>
  <p class="hint">Free by default: the site crawl, the pattern engine and the mail-server check never cost anything. Paid providers only run if you set their API keys, and only on rows the free rungs missed.</p>
  <div class="provs" id="provs"></div>
</div>

<aside>
  <h2>Run</h2>
  <dl>
    <dt>rows</dt><dd id="s-rows">0 / 0</dd>
    <dt>found</dt><dd id="s-res">0</dd>
    <dt>proven real</dt><dd id="s-ver">0</dd>
    <dt>free from cache</dt><dd id="s-cache">0</dd>
    <dt>patterns learned</dt><dd id="s-pat">0</dd>
    <dt>spend</dt><dd id="s-cost">$0.00</dd>
  </dl>
  <div class="bar"><i id="bar"></i></div>
  <p class="hint" id="stat">idle</p>
</aside>
</div>

<section id="results" style="display:none">
  <h2>Rows</h2>
  <table><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Verdict</th><th>Source</th><th>Pattern</th><th>Cost</th></tr></thead><tbody id="tb"></tbody></table>
  <p class="hint" id="why"></p>
</section>
</div>

<div id="tab-company" style="display:none">
  <h2>Company lookup</h2>
  <div class="row" style="margin-top:0">
    <input id="dom" placeholder="acme.com" style="max-width:280px">
    <button class="ghost" id="golook">Look up</button>
  </div>
  <p class="hint">Free facts from bytes the crawl already fetched: description, socials, mail provider, published team addresses, the email pattern this company uses.</p>
  <pre id="co" style="display:none"></pre>
</div>

<script>
const $ = (id) => document.getElementById(id);
const money = (n) => "$" + n.toFixed(2);
const esc = (s) => String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

document.querySelectorAll("nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("on", x === b));
    ["check", "find", "company"].forEach((t) => {
      $("tab-" + t).style.display = t === b.dataset.tab ? "block" : "none";
    });
  };
});

function wireDrop(dropId, labelId, target) {
  const drop = $(dropId);
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".csv,.txt,.tsv,text/*";
  picker.style.display = "none";
  document.body.append(picker);

  const load = async (file) => {
    if (!file) return;
    $(labelId).textContent = file.name;
    $(target).value = await file.text();
  };
  drop.onclick = () => picker.click();
  picker.onchange = () => load(picker.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); load(e.dataTransfer.files[0]); };
}
wireDrop("vdrop", "vfile", "vin");
wireDrop("fdrop", "ffile", "in");

function download(name, rows) {
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = String(v ?? "");
    return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function stream(url, body, handle) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\\n\\n")) !== -1) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\\n").find((l) => l.startsWith("data:"));
      if (line) handle(JSON.parse(line.slice(5)));
    }
  }
}

const VERDICT = {
  valid: '<span class="badge ok">safe to send</span>',
  invalid: '<span class="badge no">will bounce</span>',
  risky: '<span class="badge warn">risky</span>',
  unknown: '<span class="badge warn">not sure</span>',
};

let checked = [];

async function check() {
  const btn = $("vgo");
  btn.disabled = true;
  btn.textContent = "Checking...";
  checked = [];
  $("vtb").innerHTML = "";
  $("vresults").style.display = "block";
  $("vdl").style.display = $("vcopy").style.display = "none";
  $("vbar").style.width = "0";
  $("vstat").textContent = "starting";

  try {
    await stream("/api/verify", { text: $("vin").value, smtp: $("vsmtp").checked }, (m) => {
      if (m.type === "progress") {
        checked.push(m.row);
        const tr = document.createElement("tr");
        tr.innerHTML =
          '<td class="email">' + esc(m.row.email) + "</td><td>" + VERDICT[m.row.status] + "</td>" +
          '<td class="note">' + esc(m.row.reason) + (m.row.role ? " · shared inbox, not a person" : "") + "</td>" +
          "<td>" + esc(m.row.provider || "") + "</td>";
        $("vtb").append(tr);
        $("v-done").textContent = m.done + " / " + m.total;
        $("vbar").style.width = (100 * m.done) / m.total + "%";
        $("vstat").textContent = "checking " + m.row.email;
      } else if (m.type === "done") {
        $("v-valid").textContent = m.summary.valid;
        $("v-invalid").textContent = m.summary.invalid;
        $("v-risky").textContent = m.summary.risky;
        $("v-unknown").textContent = m.summary.unknown;
        $("vbar").style.width = "100%";
        $("vstat").textContent =
          m.summary.unknown === m.summary.total && m.summary.total
            ? "nothing could be proven from this network. Mail servers refuse home and cloud IPs; run this from a VPS or add a provider key."
            : "done in " + m.ms + "ms";
        $("vdl").style.display = $("vcopy").style.display = checked.length ? "inline-block" : "none";
      } else if (m.type === "error") {
        $("vstat").textContent = "error: " + m.message;
      }
    });
  } catch (e) {
    $("vstat").textContent = "error: " + e;
  }
  btn.disabled = false;
  btn.textContent = "Check them";
}

$("vdl").onclick = () => checked.length && download("checked.csv", checked);
$("vcopy").onclick = async () => {
  const safe = checked.filter((r) => r.status === "valid").map((r) => r.email);
  await navigator.clipboard.writeText(safe.join("\\n"));
  $("vcopy").textContent = safe.length + " copied";
  setTimeout(() => ($("vcopy").textContent = "Copy the safe ones"), 1600);
};
$("vgo").onclick = check;

function badge(r) {
  if (!r.email) return '<span class="badge no">not found</span>';
  if (r.verified) return '<span class="badge ok">proven real</span>';
  if (r.method === "cache") return '<span class="badge warn">from cache</span>';
  if ((r.note || "").includes("catch-all")) return '<span class="badge warn">catch-all</span>';
  if ((r.note || "").includes("refused this IP")) return '<span class="badge warn">host refused us</span>';
  if ((r.note || "").includes("unavailable from this network")) return '<span class="badge warn">check blocked</span>';
  return '<span class="badge warn">best guess</span>';
}

let found = [];

async function status() {
  const d = await (await fetch("/api/status")).json();
  $("provs").innerHTML = d.providers
    .map((p) => '<span class="badge' + (p.cost ? "" : " warn") + '">' + p.name + (p.cost ? " " + money(p.cost) + "/row" : " free") + "</span>")
    .join("");
  if (!d.providers.some((p) => p.cost > 0)) {
    $("provs").innerHTML += '<span class="badge">no paid keys set, free rungs only</span>';
  }
}

async function enrich() {
  const btn = $("go");
  btn.disabled = true;
  btn.textContent = "Finding...";
  found = [];
  $("tb").innerHTML = "";
  $("results").style.display = "block";
  $("fdl").style.display = "none";
  $("why").textContent = "";
  $("bar").style.width = "0";
  $("stat").textContent = "starting";

  try {
    await stream("/api/enrich", { csv: $("in").value, smtp: $("smtp").checked, maxCost: parseFloat($("cap").value) || 0 }, (m) => {
      if (m.type === "progress") {
        found.push(m.row);
        const r = m.row;
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + esc(r.name) + "</td><td>" + esc(r.domain) + "</td>" +
          (r.email ? '<td class="email">' + esc(r.email) + "</td>" : '<td class="none">no email</td>') +
          "<td>" + badge(r) + "</td><td>" + esc(r.source || "") + "</td>" +
          "<td>" + esc(r.pattern || "") + "</td><td>" + money(r.cost) + "</td>";
        $("tb").append(tr);
        if (r.note) {
          const note = document.createElement("tr");
          note.innerHTML = '<td colspan="7" class="note" style="padding-top:0">' + esc(r.note) + "</td>";
          $("tb").append(note);
        }
        $("s-rows").textContent = m.done + " / " + m.total;
        $("s-res").textContent = m.resolved;
        $("s-ver").textContent = m.verified;
        $("s-cost").textContent = money(m.cost);
        $("bar").style.width = (100 * m.done) / m.total + "%";
        $("stat").textContent = "working through " + r.domain;
      } else if (m.type === "done") {
        const t = m.ledger.totals;
        $("s-cache").textContent = t.cached;
        $("s-pat").textContent = t.patternsKnown;
        $("s-cost").textContent = money(t.cost);
        $("bar").style.width = "100%";
        $("stat").textContent = "done in " + m.ms + "ms";
        $("fdl").style.display = found.length ? "inline-block" : "none";
        const bits = [];
        if (t.cached) bits.push(t.cached + " rows came free from cache");
        if (t.patternsKnown) bits.push(t.patternsKnown + " company patterns are now known and reused free");
        if (m.ledger.capped) bits.push("spend cap reached, paid rungs skipped");
        $("why").textContent = bits.join(". ");
      } else if (m.type === "error") {
        $("stat").textContent = "error: " + m.message;
      }
    });
  } catch (e) {
    $("stat").textContent = "error: " + e;
  }
  btn.disabled = false;
  btn.textContent = "Find emails";
}

$("fdl").onclick = () => found.length && download("found.csv", found);
$("go").onclick = enrich;

async function look() {
  const domain = $("dom").value.trim();
  if (!domain) return;
  $("co").style.display = "block";
  $("co").textContent = "looking up " + domain + "...";
  const res = await fetch("/api/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
  $("co").textContent = JSON.stringify(await res.json(), null, 2);
}

$("golook").onclick = look;
$("dom").addEventListener("keydown", (e) => e.key === "Enter" && look());
status();
</script></body></html>`;

function parseLeads(text: string): Row[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const hasHeader = /^\s*(name|first_name)\s*,/i.test(trimmed);
  const records: Record<string, string>[] = hasHeader
    ? parseCsv(trimmed)
    : trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const i = l.indexOf(",");
          return i === -1
            ? { name: l, domain: "" }
            : { name: l.slice(0, i).trim(), domain: l.slice(i + 1).trim() };
        });
  return records.map((r) => ({
    name: r.name,
    first_name: r.first_name,
    last_name: r.last_name,
    domain: r.domain,
    company_url: r.company_url,
  }));
}

async function readJson(req: import("node:http").IncomingMessage): Promise<any> {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw);
}

function sse(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  return (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  if (req.method === "GET" && url === "/api/status") {
    const providers = buildProviders({ providers: DEFAULT_PROVIDERS }).map((p) => ({
      name: p.name,
      cost: p.cost,
    }));
    const paid = buildProviders({ providers: ["prospeo", "leadmagic"] }).map((p) => ({
      name: p.name,
      cost: p.cost,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ providers: [...providers, ...paid] }));
    return;
  }

  if (req.method === "POST" && url === "/api/company") {
    try {
      const { domain } = await readJson(req);
      const cache = new Cache();
      const facts = await enrichCompany(String(domain ?? ""), cache.domains);
      cache.flush();
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(facts));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (req.method === "POST" && url === "/api/verify") {
    let body: { text?: string; smtp?: boolean };
    try {
      body = await readJson(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"bad request"}');
      return;
    }

    const send = sse(res);
    const started = Date.now();
    try {
      const emails = extractEmails(body.text ?? "");
      const cache = new Cache();
      const rows = await verifyEmails(emails, {
        smtp: body.smtp !== false,
        domains: cache.domains,
        onProgress: (p) => send({ type: "progress", ...p }),
      });
      cache.flush();
      send({ type: "done", summary: verifySummary(rows), ms: Date.now() - started });
    } catch (err) {
      send({ type: "error", message: String(err) });
    }
    res.end();
    return;
  }

  if (req.method === "POST" && url === "/api/enrich") {
    let body: { csv?: string; smtp?: boolean; maxCost?: number };
    try {
      body = await readJson(req);
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"bad request"}');
      return;
    }

    const send = sse(res);
    const started = Date.now();
    try {
      const inputs = parseLeads(body.csv ?? "");
      const names = [...DEFAULT_PROVIDERS, "prospeo", "leadmagic"];
      const providers = buildProviders({ providers: names, noSmtp: !body.smtp });
      const cache = new Cache();
      const { ledger } = await enrichBatch(inputs, providers, {
        cache,
        maxCost: body.maxCost && body.maxCost > 0 ? body.maxCost : undefined,
        onProgress: (p) => send({ type: "progress", ...p }),
      });
      cache.flush();
      send({ type: "done", ledger, ms: Date.now() - started });
    } catch (err) {
      send({ type: "error", message: String(err) });
    }
    res.end();
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}`;
  console.log(`OpenEnrich is running at ${url}`);
  if (process.env.OPENENRICH_NO_OPEN) return;
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  import("node:child_process").then(({ spawn }) =>
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref(),
  );
});

import { createServer } from "node:http";
import { buildProviders } from "./core/providers.js";
import { enrichRow } from "./core/enrich.js";
import { parseCsv } from "./core/csv.js";
import { Cache } from "./core/cache.js";
import type { Row } from "./core/types.js";

const PORT = Number(process.env.PORT) || 8790;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenEnrich — local</title>
<style>
:root{--bg:#0a0a0a;--ink:#ececec;--dim:#9a9a9a;--faint:#5c5c5c;--line:#2e2e2e;--panel:#111}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:14px/1.6 "IBM Plex Mono",ui-monospace,Menlo,monospace;padding:32px;max-width:900px;margin:0 auto}
h1{font-size:18px;font-weight:600;letter-spacing:.04em;display:flex;align-items:center;gap:10px}
h1 svg{width:20px;height:20px}
.sub{color:var(--faint);font-size:12px;margin:6px 0 24px}
textarea{width:100%;height:120px;background:var(--panel);color:var(--ink);border:1px solid var(--line);padding:12px;font:inherit;resize:vertical}
.opts{display:flex;gap:16px;align-items:center;margin:12px 0}
label{color:var(--dim);font-size:13px;display:flex;gap:6px;align-items:center}
button{background:var(--ink);color:var(--bg);border:0;font:inherit;font-weight:600;padding:11px 20px;cursor:pointer;letter-spacing:.05em}
button:disabled{opacity:.5}
table{width:100%;border-collapse:collapse;margin-top:24px;font-size:13px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{color:var(--faint);font-size:11px;letter-spacing:.1em;text-transform:uppercase}
td.email{color:#fff}
td.none{color:var(--faint)}
.tag{font-size:11px;padding:2px 7px;border:1px solid var(--line);color:var(--dim)}
.tag.ok{color:#fff;border-color:#fff}
.summary{margin-top:18px;color:var(--dim);font-size:13px}
.summary b{color:#fff}
</style></head><body>
<h1><svg viewBox="0 0 512 512" fill="none"><path fill="#b8b8b8" d="M88 108h336v48H88z"/><path fill="#cfcfcf" d="M136 188h288v48H136z"/><path fill="#e4e4e4" d="M184 268h240v48H184z"/><path fill="#f2f2f2" d="M232 348h192v48H232z"/><path fill="#fff" d="M280 428h144v48H280z"/></svg> OpenEnrich <span style="color:var(--faint);font-weight:400">local</span></h1>
<p class="sub">Paste leads as <code>name,domain</code> (one per line). This runs the free local engine on your machine. No keys, no cost.</p>
<textarea id="in">Patrick Collison,stripe.com
Tobi Lutke,shopify.com
Dylan Field,figma.com
Jane Doe,acmesaas.io</textarea>
<div class="opts">
  <label><input type="checkbox" id="smtp"> verify over SMTP (slow; usually blocked on home networks)</label>
</div>
<button id="go" onclick="run()">Enrich</button>
<div id="out"></div>
<script>
async function run(){
  const btn=document.getElementById('go'); btn.disabled=true; btn.textContent='Enriching...';
  const csv=document.getElementById('in').value;
  const smtp=document.getElementById('smtp').checked;
  const out=document.getElementById('out'); out.innerHTML='';
  try{
    const r=await fetch('/api/enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv,smtp})});
    const d=await r.json();
    if(!d.rows){out.innerHTML='<p class="summary">error</p>';return;}
    let spend=0,resolved=0;
    const body=d.rows.map(x=>{
      if(x.email){spend+=x.cost;resolved++;
        return \`<tr><td>\${x.name}</td><td>\${x.domain}</td><td class="email">\${x.email}</td><td><span class="tag \${x.verified?'ok':''}">\${x.verified?'verified':x.method||'—'}</span></td><td>$\${x.cost.toFixed(2)}</td></tr>\`;}
      return \`<tr><td>\${x.name}</td><td>\${x.domain}</td><td class="none">no mail server — skipped</td><td></td><td>$0.00</td></tr>\`;
    }).join('');
    out.innerHTML='<table><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th><th>Cost</th></tr></thead><tbody>'+body+'</tbody></table>'
      +\`<p class="summary"><b>\${resolved}/\${d.rows.length}</b> resolved · total spend <b>$\${spend.toFixed(2)}</b> · engine: free local (no keys)</p>\`;
  }catch(e){out.innerHTML='<p class="summary">error: '+e+'</p>';}
  btn.disabled=false; btn.textContent='Enrich';
}
</script></body></html>`;

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/enrich") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: { csv?: string; smtp?: boolean };
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400).end('{"error":"bad request"}');
      return;
    }
    const providers = buildProviders({ providers: ["local"], noSmtp: !body.smtp });
    const cache = new Cache();
    const text = (body.csv || "").trim();
    const hasHeader = /^name\s*,\s*(domain|company)/i.test(text);
    const records = hasHeader
      ? parseCsv(text)
      : text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => {
            const i = l.indexOf(",");
            return { name: l.slice(0, i).trim(), domain: l.slice(i + 1).trim() };
          });
    const rows = [];
    for (const rec of records) {
      const input: Row = { name: rec.name, domain: rec.domain || rec.company_url };
      const r = await enrichRow(input, providers, { cache });
      rows.push({
        name: rec.name,
        domain: rec.domain || rec.company_url || "",
        email: r?.email ?? "",
        verified: r?.verified ?? false,
        method: r?.method ?? "",
        cost: r?.cost ?? 0,
      });
    }
    cache.flush();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ rows }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" }).end(PAGE);
});

server.listen(PORT, () => console.log(`OpenEnrich UI on http://localhost:${PORT}`));

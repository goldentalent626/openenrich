const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/waitlist" && req.method === "POST") {
      let body;
      try {
        body = await req.json();
      } catch {
        return json({ error: "bad request" }, 400);
      }
      if (body.hp) return json({ ok: true });
      const email = String(body.email || "").trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        return json({ error: "invalid email" }, 400);
      }
      await env.WAITLIST.put(
        email,
        JSON.stringify({
          at: new Date().toISOString(),
          ua: req.headers.get("user-agent") || "",
          country: req.cf?.country || "",
        })
      );
      return json({ ok: true });
    }
    return env.ASSETS.fetch(req);
  },
};

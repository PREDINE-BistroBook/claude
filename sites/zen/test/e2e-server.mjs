/* Zen Recovery — real end-to-end host. Run: node test/e2e-server.mjs (from sites/zen), then node test/e2e.mjs.
   Real end-to-end host: serves sites/zen/public as static files and routes /api/* to the actual Worker code
   with an in-memory SQLite standing in for D1 (same shim as smoke.mjs). Port 8766. Seeds a realistic team. */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs"; import http from "node:http"; import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), PUB = ROOT + "/public";
const db = new DatabaseSync(":memory:"); db.exec(fs.readFileSync(ROOT + "/schema.sql", "utf8"));
const D1 = { prepare: (sql) => { let args = []; const st = { bind: (...a) => { args = a; return st; }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; } }; return st; }, batch: async (sts) => Promise.all(sts.map((s) => s.run())), exec: async (sql) => db.exec(sql) };
const env = { DB: D1, ASSETS: { fetch: async () => new Response("asset") }, SESSION_SECRET: "e2e-secret", SITE_URL: "http://localhost:8766", FROM_EMAIL: "x", DEV_MAGIC_LINK: "1", ADMIN_BOOTSTRAP_EMAIL: "owner@x.com", ADMIN_BOOTSTRAP_PASSWORD: "Owner-pass-12345", ZEN_STRIPE_ACCOUNT: "", STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", AI: null };
globalThis.ZEN_LANGS_OPEN = ["en", "it", "ar"];   // the English checks in the suites; the site itself is Italian only (see i18n.js / lib.js)
const { default: worker } = await import(ROOT + "/src/worker.js");
const mails = []; globalThis.__mails = mails;
{ const { hashPassword } = await import(ROOT + "/src/auth.js"); const o = await hashPassword("Owner-pass-12345"), pf = await hashPassword("Ash-pass-12345");   // the owner (else bootstrapped from env) and Ash's platform account
  db.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt, level, notify) VALUES ('own1','owner@x.com','Owner','all',?,?,'owner',1)").run(o.hash, o.salt);
  db.prepare("INSERT INTO admins (id, email, name, role, pass_hash, salt, level, notify) VALUES ('ash1','ash@x.com','Ash','platform',?,?,NULL,0)").run(pf.hash, pf.salt); }
// seed: the live team, in the owner's order
const team = [["Mazen Emad","cairo",0,"Founder · Sports recovery specialist",30.0389,30.9762,0],["Shaarawy","dahab",1,"Cupping & manual therapy · Dahab",28.5091,34.5136,10],["Hesham khaled","cairo",2,"Recovery specialist · Gold's Gym Beverly Hills",30.0389,30.9762,15],["Adham","cairo",3,"Recovery specialist · Hansa Medica",30.0193,31.4310,0],["Anas Hany","cairo",4,"Recovery & cupping · Gold's Gym Beverly Hills",30.0389,30.9762,0],["Shika","florence",5,"",43.7696,11.2558,0]];
team.forEach(([name, city, sort, title, lat, lng, radius], i) => db.prepare("INSERT INTO therapists (id, city, name, bio, languages, active, sort, title, area, lat, lng, radius_km) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run("th" + i, city, name, "Cupping and recovery", "Arabic, English", 1, sort, title, city === "cairo" ? (name === "Adham" ? "New Cairo" : "Sheikh Zayed") : city, lat, lng, radius));
db.prepare("INSERT INTO therapist_prices (therapist_id, service_id, amount) VALUES ('th3', 'cai-man', 120000)").run();   // Adham charges more for manual therapy
const types = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8766");
  if (url.pathname === "/api/e2e/feature-review" && req.method === "POST") {   // test-only: a done session with a 5-star rating, featured by the owner
    const id = "rv" + Date.now().toString(36); db.prepare("INSERT INTO bookings (id, name, email, city, service_name, date, slot, amount, currency, status, rating, feedback, featured, done_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "Sara Tester", "sara@x.com", "cairo", "Dry cupping · 45 min · Cairo", "2026-09-01", "morning", 90000, "egp", "done", 5, "Best sleep in weeks.", 1, "2026-09-01 12:00:00");
    res.writeHead(200, { "content-type": "application/json" }); res.end("{\"ok\":true}"); return; }
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const wreq = new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body, redirect: "manual" });
    if (req.headers["x-e2e-country"]) Object.defineProperty(wreq, "cf", { value: { country: req.headers["x-e2e-country"], city: null } });   // stands in for Cloudflare's geo on production
    const r = await worker.fetch(wreq, env, { waitUntil() {} });
    const h = {}; r.headers.forEach((v, k) => { h[k] = k === "set-cookie" ? r.headers.getSetCookie?.() || v : v; });
    res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = url.pathname === "/" ? "/index.html" : url.pathname; if (!path.extname(p)) p += ".html";
  const f = path.join(PUB, p); if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.writeHead(404, { "content-type": "text/html" }); res.end(fs.readFileSync(PUB + "/404.html")); return; }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" }); res.end(fs.readFileSync(f));
}).listen(8766, () => console.log("e2e server on 8766"));

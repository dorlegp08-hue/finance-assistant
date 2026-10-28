// Fathom server. Run: node server.js  (Node 24, no npm packages)
// Serves the app on this machine, stores accounts and data in SQLite (fathom.db), and proxies chat
// to the provider in config.json. The API key never reaches the browser; FATHOM_API_KEY overrides it.
const http = require("http");
const fs = require("fs");
const path = require("path");
const E = require("./engine.js");
const { openDb, getDoc, setDoc, delDoc } = require("./db.js");
const A = require("./auth.js");
const V = require("./validate.js");
const { importCsv } = require("./csv.js");
const { summarize } = require("./analytics.js");
const { HttpError } = A;

const PORT = process.env.PORT || 3000;
const STATIC = { "/": "index.html", "/index.html": "index.html", "/style.css": "style.css", "/motion.css": "motion.css", "/app.js": "app.js", "/engine.js": "engine.js", "/motion.js": "motion.js", "/data.json": "data.json" };
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", ...String(process.env.FATHOM_ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
const TIMEOUT_MS = 30000;
const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");
const DEFAULTS = () => JSON.parse(read("data.json"));
const SECURITY = {
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};

function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(read("config.json")); } catch (e) {}
  if (process.env.FATHOM_API_KEY) cfg.apiKey = process.env.FATHOM_API_KEY;
  return cfg;
}
const todayStr = () => { const t = new Date(); return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`; };
const trimGain = (p) => p.subs.filter((s) => s.unused).reduce((a, s) => a + s.amt, 0);

// ---------- AI ----------
function factsFrom(p) {
  return { today: todayStr(), balance: p.balance, safetyLine: p.safety, savedPerMonth: p.saving, netWorth: p.netWorth, bills: p.bills, subscriptions: p.subs, leaks: p.leaks, goals: p.goals };
}
function systemPrompt(cfg, profile) {
  return `${cfg.systemPrompt || "You are Fathom, a calm personal-finance assistant."}
All money is in Indian rupees. Use ONLY the figures in this JSON; never invent numbers and never do arithmetic: ${JSON.stringify(factsFrom(profile))}
Reply with ONE JSON object and nothing else.
If the user asks whether they can afford a specific purchase or trip, reply:
{"kind":"scenario","label":"<1-3 word name>","cost":<rupees as a number>,"months":<whole months from today, default 5>,"lead":"<one friendly sentence under 14 words>"}
Otherwise reply: {"kind":"text","text":"<short plain answer, 1-3 sentences, using only the figures above>"}
You are not a licensed financial advisor; keep it informational.`;
}
// Whatever the model sent, return a safe {kind:"scenario"|"text"} object.
function normalize(obj, raw) {
  if (obj && obj.kind === "scenario") {
    const cost = E.parseAmount(obj.cost);
    let months = Math.round(Number(obj.months));
    if (!isFinite(months)) months = 5;
    if (cost > 0) return { kind: "scenario", label: String(obj.label || "That").slice(0, 30), cost: Math.round(cost), months: Math.min(24, Math.max(1, months)), lead: obj.lead ? String(obj.lead).slice(0, 160) : undefined };
  }
  if (obj && obj.kind === "text" && obj.text) return { kind: "text", text: String(obj.text).slice(0, 1500) };
  return { kind: "text", text: String(raw || "").trim().slice(0, 1500) || "I couldn’t work that out. Try asking in other words." };
}
function providerError(status, data) {
  if (status === 401 || status === 403) return "The provider rejected the API key. Check config.json.";
  if (status === 429) return "The provider is rate-limiting you. Try again in a moment.";
  return data.error?.message || data.message || "Provider error " + status;
}
async function askModel(cfg, question, history, profile) {
  if (!cfg.apiKey || cfg.apiKey === "PASTE_KEY_HERE") throw new Error("Add your API key to config.json.");
  const messages = [...(Array.isArray(history) ? history : []).slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) })), { role: "user", content: question.slice(0, 1000) }];
  const sys = systemPrompt(cfg, profile);
  let url, headers, body;
  if (cfg.provider === "anthropic") {
    url = (cfg.baseUrl || "https://api.anthropic.com") + "/v1/messages";
    headers = { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" };
    body = { model: cfg.model, max_tokens: 600, system: sys, messages };
  } else {
    url = String(cfg.baseUrl).replace(/\/$/, "") + "/chat/completions";
    headers = { Authorization: "Bearer " + cfg.apiKey };
    body = { model: cfg.model, messages: [{ role: "system", content: sys }, ...messages] };
  }
  let res;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new Error(e.name === "TimeoutError" ? "The model took too long to answer." : "Could not reach the provider.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(providerError(res.status, data));
  const raw = cfg.provider === "anthropic" ? data.content.map((b) => b.text || "").join("") : data.choices[0].message.content;
  const m = raw.match(/\{[\s\S]*\}/);
  let obj = null;
  if (m) { try { obj = JSON.parse(m[0]); } catch (e) {} }
  return normalize(obj, raw);
}

// ---------- http helpers ----------
function send(res, code, obj, extra) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store", ...SECURITY, ...(extra || {}) });
  res.end(JSON.stringify(obj));
}
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let raw = "", done = false;
    req.on("data", (c) => {
      if (done) return; // keep draining, but stop buffering
      raw += c;
      if (raw.length > limit) { done = true; raw = ""; reject(new HttpError(413, "That request is too large.")); }
    });
    req.on("end", () => {
      if (done) return;
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(new HttpError(400, "Invalid JSON.")); }
    });
    req.on("error", () => {});
  });
}

function createServer(opts) {
  opts = opts || {};
  const db = openDb(opts.dbPath || process.env.FATHOM_DB || path.join(__dirname, "fathom.db"));
  A.purgeExpired(db);
  const loginByIp = A.limiter(20, 15 * 60e3), loginByEmail = A.limiter(8, 15 * 60e3), signups = A.limiter(10, 3600e3);
  const chatLimit = A.limiter(30, 60e3), importLimit = A.limiter(10, 3600e3);

  const profileOf = (uid) => getDoc(db, uid, "profile") || (({ today, ...d }) => d)(DEFAULTS());
  const prefsOf = (uid) => getDoc(db, uid, "prefs") || V.cleanPrefs({});
  const withToday = (p) => ({ ...p, today: todayStr(), trimGain: trimGain(p) });

  async function handle(req, res) {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    if (!LOCAL_HOSTS.has(host)) { res.writeHead(403, SECURITY); return res.end("Local access only"); }
    const url = new URL(req.url, "http://local");
    const p = url.pathname, method = req.method;

    if (method === "GET" && STATIC[p]) {
      res.writeHead(200, { "content-type": TYPES[path.extname(STATIC[p])], "cache-control": "no-store", ...SECURITY });
      return res.end(fs.readFileSync(path.join(__dirname, STATIC[p])));
    }
    if (!p.startsWith("/api/")) { res.writeHead(404, SECURITY); return res.end(); }

    if (method !== "GET") {
      // Browsers always send Origin on cross-site posts; it must be this very site. JSON only.
      const origin = req.headers.origin;
      if (origin) { let oh = ""; try { oh = new URL(origin).host; } catch (e) {} if (oh !== req.headers.host) throw new HttpError(403, "Cross-site request blocked."); }
      if (method !== "DELETE" && !String(req.headers["content-type"] || "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
    }
    const ip = req.socket.remoteAddress || "?";
    const secure = req.headers["x-forwarded-proto"] === "https" || process.env.FATHOM_SECURE_COOKIE === "1";

    // ----- accounts -----
    if (method === "POST" && p === "/api/auth/signup") {
      if (!signups(ip)) throw new HttpError(429, "Too many sign-ups from here. Try again later.");
      const user = await A.signup(db, await readJson(req, 4000));
      return send(res, 201, { user }, { "set-cookie": A.cookieHeader(A.createSession(db, user.id), secure) });
    }
    if (method === "POST" && p === "/api/auth/login") {
      const b = await readJson(req, 4000);
      if (!loginByIp(ip) || !loginByEmail(String(b.email || "").toLowerCase())) throw new HttpError(429, "Too many attempts. Wait a few minutes and try again.");
      const user = await A.login(db, b);
      return send(res, 200, { user }, { "set-cookie": A.cookieHeader(A.createSession(db, user.id), secure) });
    }
    if (method === "POST" && p === "/api/auth/logout") {
      A.destroySession(db, A.tokenOf(req));
      return send(res, 200, { ok: true }, { "set-cookie": A.clearCookieHeader() });
    }

    // ----- everything below needs a signed-in user -----
    const user = A.userFrom(db, req);
    if (!user) throw new HttpError(401, "Please sign in.");
    const uid = user.id;

    if (method === "GET" && p === "/api/session") {
      const n = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ?").get(uid).n;
      return send(res, 200, { user, profile: profileOf(uid), custom: !!getDoc(db, uid, "profile"), prefs: prefsOf(uid), chat: getDoc(db, uid, "chat"), transactions: n });
    }
    if (method === "PUT" && p === "/api/profile") {
      const clean = V.cleanProfile((await readJson(req, 64000)).profile, DEFAULTS());
      setDoc(db, uid, "profile", clean);
      return send(res, 200, { profile: clean });
    }
    if (method === "DELETE" && p === "/api/profile") { delDoc(db, uid, "profile"); return send(res, 200, { profile: profileOf(uid) }); }
    if (method === "PUT" && p === "/api/prefs") {
      const clean = V.cleanPrefs((await readJson(req, 4000)).prefs);
      setDoc(db, uid, "prefs", clean);
      return send(res, 200, { prefs: clean });
    }
    if (method === "PUT" && p === "/api/chat/history") {
      setDoc(db, uid, "chat", V.cleanChat((await readJson(req, 256000)).messages));
      return send(res, 200, { ok: true });
    }
    if (method === "DELETE" && p === "/api/chat/history") { delDoc(db, uid, "chat"); return send(res, 200, { ok: true }); }

    // ----- AI chat: the server uses the stored profile, never numbers sent by the browser -----
    if (method === "POST" && p === "/api/chat") {
      if (!chatLimit("u" + uid)) throw new HttpError(429, "Too many questions this minute. Slow down a little.");
      const b = await readJson(req, 20000);
      let r;
      try { r = await askModel(loadConfig(), String(b.question || ""), b.history, profileOf(uid)); }
      catch (e) { return send(res, 200, { error: e.message }); }
      if (r.kind === "scenario") {
        const s = E.scenario(withToday(profileOf(uid)), { cost: r.cost, months: r.months, trim: prefsOf(uid).trim });
        r.result = { after: Math.round(s.after), verdict: s.verdict, say: s.say };
      }
      return send(res, 200, r);
    }

    // ----- money maths on the server (same engine as the browser) -----
    if (method === "POST" && p === "/api/scenario") {
      const b = await readJson(req, 2000);
      const cost = Number(b.cost), months = Math.round(Number(b.months || 5));
      if (!(cost > 0 && cost <= 1e10) || !(months >= 1 && months <= 24)) throw new HttpError(400, "cost must be above 0 and months between 1 and 24.");
      const s = E.scenario(withToday(profileOf(uid)), { cost, months, delay: !!b.delay, trim: !!b.trim });
      return send(res, 200, { scenario: s });
    }

    // ----- transactions -----
    if (method === "POST" && p === "/api/transactions/import") {
      if (!importLimit("u" + uid)) throw new HttpError(429, "Too many imports this hour.");
      const b = await readJson(req, 2000000);
      const r = importCsv(String(b.csv || ""));
      if (r.error) throw new HttpError(400, r.error);
      if (!r.rows.length) throw new HttpError(400, "No spending rows found in that file.");
      db.exec("BEGIN");
      try {
        if (b.replace !== false) db.prepare("DELETE FROM transactions WHERE user_id = ?").run(uid);
        const ins = db.prepare("INSERT INTO transactions (user_id, day, amount, category, note) VALUES (?, ?, ?, ?, ?)");
        for (const t of r.rows) ins.run(uid, t.day, t.amount, t.category, t.note);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      const rows = db.prepare("SELECT day, amount, category FROM transactions WHERE user_id = ?").all(uid);
      return send(res, 200, { imported: r.rows.length, skipped: r.skipped, summary: summarize(rows, todayStr()) });
    }
    if (method === "GET" && p === "/api/transactions/summary") {
      return send(res, 200, summarize(db.prepare("SELECT day, amount, category FROM transactions WHERE user_id = ?").all(uid), todayStr()));
    }
    if (method === "DELETE" && p === "/api/transactions") {
      const n = db.prepare("DELETE FROM transactions WHERE user_id = ?").run(uid).changes;
      return send(res, 200, { deleted: Number(n) });
    }

    // ----- delete the account and everything in it (asks for the password) -----
    if (method === "POST" && p === "/api/account/delete") {
      const b = await readJson(req, 2000);
      if (!loginByEmail("del" + uid)) throw new HttpError(429, "Too many attempts. Try again later.");
      if (!(await A.verifyPassword(db, uid, b.password))) throw new HttpError(401, "Wrong password.");
      db.prepare("DELETE FROM users WHERE id = ?").run(uid);
      return send(res, 200, { ok: true }, { "set-cookie": A.clearCookieHeader() });
    }
    throw new HttpError(404, "Not found.");
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (res.headersSent) return res.end();
      if (e instanceof HttpError) {
        send(res, e.status, { error: e.message, ...{} }, e.status === 413 ? { connection: "close" } : undefined);
        if (e.status === 413) setTimeout(() => req.socket.destroy(), 5000).unref(); // let the reply land, then drop a slow oversized upload
      }
      else { console.error(e); send(res, 500, { error: "Something went wrong." }); }
    });
  });
  server.db = db;
  server.on("close", () => { try { db.close(); } catch (e) {} });
  return server;
}

module.exports = { createServer, normalize };
if (require.main === module) {
  createServer().listen(PORT, "127.0.0.1", () => console.log("Fathom running at http://localhost:" + PORT));
}

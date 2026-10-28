const assert = require("assert");
const http = require("http");
const { createServer, normalize } = require("./server.js");
const { parseCsv, parseDate, parseMoney, importCsv } = require("./csv.js");

// ---------- pure helpers ----------
assert.strictEqual(normalize({ kind: "scenario", label: "Goa", cost: "₹80,000", months: "7" }, "").cost, 80000);
assert.strictEqual(normalize({ kind: "scenario", cost: 5000, months: 99 }, "").months, 24);
assert.strictEqual(normalize({ kind: "scenario", cost: "lots" }, "plain words").kind, "text");
assert.strictEqual(normalize(null, "hello").text, "hello");

assert.deepStrictEqual(parseCsv('a,"b, c","say ""hi"""\n1,2,3\r\n'), [["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
assert.strictEqual(parseDate("2026-10-27"), "2026-10-27");
assert.strictEqual(parseDate("27/10/2026"), "2026-10-27");
assert.strictEqual(parseDate("27 Oct 2026"), "2026-10-27");
assert.strictEqual(parseDate("31/02/2026"), null);
assert.strictEqual(parseMoney("₹1,234.50"), 1234.5);
assert.strictEqual(parseMoney("(500)"), -500);
assert.strictEqual(parseMoney("abc"), null);
let imp = importCsv("Date,Description,Debit,Credit\n01/10/2026,Swiggy order,450,\n02/10/2026,Salary,,50000\n03/10/2026,Uber ride,200,\nbad,row,x,\n");
assert.strictEqual(imp.rows.length, 2, "debit rows only");
assert.strictEqual(imp.rows[0].category, "Food delivery");
imp = importCsv("2026-10-01,Netflix,-649\n2026-10-02,Refund,300\n");
assert.deepStrictEqual(imp.rows.map((r) => [r.amount, r.category]), [[649, "Subscriptions"]]);
assert.ok(importCsv("Date,Description\n2026-10-01,Tea").error, "a header with no amount column is reported");
assert.strictEqual(importCsv("foo,bar\n1,2").rows.length, 0, "unreadable rows import nothing");

// ---------- http ----------
const call = (port, o, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const headers = { host: "localhost:" + port, ...(o.headers || {}) };
  if (data !== undefined && !headers["content-type"]) headers["content-type"] = "application/json";
  const r = http.request({ host: "127.0.0.1", port, method: o.method || "GET", path: o.path, headers }, (res) => {
    let d = ""; res.on("data", (c) => (d += c));
    res.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (e) {} resolve({ status: res.statusCode, headers: res.headers, json: j, text: d }); });
  });
  r.on("error", reject); if (data !== undefined) r.write(data); r.end();
});
const cookieOf = (r) => (r.headers["set-cookie"] || [""])[0].split(";")[0];

const server = createServer({ dbPath: ":memory:", config: { provider: "openai", apiKey: "" } });
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const api = (method, path, body, cookie, headers) => call(port, { method, path, headers: { ...(cookie ? { cookie } : {}), ...(headers || {}) } }, body);
  try {
    // static files and security headers
    const home = await call(port, { path: "/" });
    assert.strictEqual(home.status, 200);
    assert.ok(home.headers["content-security-policy"].includes("default-src 'self'"));
    for (const secret of ["/config.json", "/fathom.db", "/server.js", "/auth.js"]) assert.strictEqual((await call(port, { path: secret })).status, 404, secret + " must not be served");
    assert.strictEqual((await call(port, { path: "/", headers: { host: "evil.example" } })).status, 403);
    assert.strictEqual(server.address().address, "127.0.0.1");

    // signed out
    assert.strictEqual((await api("GET", "/api/session")).status, 401);
    assert.strictEqual((await api("POST", "/api/chat", { question: "hi" })).status, 401);

    // sign-up validation
    assert.strictEqual((await api("POST", "/api/auth/signup", { name: "A", email: "nope", password: "longenough" })).status, 400);
    assert.strictEqual((await api("POST", "/api/auth/signup", { name: "A", email: "a@x.com", password: "short" })).status, 400);
    const su = await api("POST", "/api/auth/signup", { name: "Asha", email: "Asha@Example.com", password: "correct horse" });
    assert.strictEqual(su.status, 201);
    const setCookie = su.headers["set-cookie"][0];
    assert.ok(/HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), "session cookie flags");
    const ck = cookieOf(su);
    assert.strictEqual((await api("POST", "/api/auth/signup", { name: "B", email: "asha@example.com", password: "another pass" })).status, 409);

    // login: wrong password and unknown email look the same
    const bad1 = await api("POST", "/api/auth/login", { email: "asha@example.com", password: "wrong password" });
    const bad2 = await api("POST", "/api/auth/login", { email: "nobody@example.com", password: "wrong password" });
    assert.strictEqual(bad1.status, 401); assert.strictEqual(bad2.json.error, bad1.json.error);
    assert.strictEqual((await api("POST", "/api/auth/login", { email: "asha@example.com", password: "correct horse" })).status, 200);

    // session carries the default profile
    const sess = await api("GET", "/api/session", undefined, ck);
    assert.strictEqual(sess.json.user.name, "Asha");
    assert.strictEqual(sess.json.profile.balance, 142000);
    assert.strictEqual(sess.json.transactions, 0);

    // csrf-style protections
    assert.strictEqual((await api("PUT", "/api/prefs", { prefs: {} }, ck, { origin: "http://evil.example" })).status, 403);
    assert.strictEqual((await api("PUT", "/api/prefs", "x=1", ck, { "content-type": "text/plain" })).status, 415);
    assert.strictEqual((await api("PUT", "/api/profile", { profile: { balance: 1, junk: "x".repeat(70000) } }, ck)).status, 413);

    // profile: stored, clamped, trimmed
    const pr = await api("PUT", "/api/profile", { profile: { balance: 250000, saving: -5, safety: "50000", growth: 7, subs: Array.from({ length: 80 }, (_, i) => ({ name: "S" + i, amt: 10, unused: i === 0 })) } }, ck);
    assert.strictEqual(pr.status, 200);
    assert.strictEqual(pr.json.profile.balance, 250000);
    assert.strictEqual(pr.json.profile.saving, 0, "negative clamps to 0");
    assert.strictEqual(pr.json.profile.growth, 1, "growth clamps to 100%");
    assert.strictEqual(pr.json.profile.subs.length, 60);
    assert.strictEqual((await api("GET", "/api/session", undefined, ck)).json.profile.balance, 250000);

    // prefs and chat history are validated
    assert.strictEqual((await api("PUT", "/api/prefs", { prefs: { theme: "<script>", trim: 1, rng: 99 } }, ck)).json.prefs.theme, "pine");
    await api("PUT", "/api/chat/history", { messages: [{ id: 1, type: "user", text: "hi" }, { id: 2, type: "evil", text: "x" }, { id: 3, type: "scn", label: "Goa", cost: 80000, months: 5 }] }, ck);
    assert.deepStrictEqual((await api("GET", "/api/session", undefined, ck)).json.chat.map((m) => m.type), ["user", "scn"]);

    // users cannot see each other's data
    const su2 = await api("POST", "/api/auth/signup", { name: "Ben", email: "ben@example.com", password: "battery staple" });
    const ck2 = cookieOf(su2);
    const s2 = (await api("GET", "/api/session", undefined, ck2)).json;
    assert.strictEqual(s2.profile.balance, 142000); assert.strictEqual(s2.chat, null);

    // chat without a key is a readable error, not a crash
    assert.ok((await api("POST", "/api/chat", { question: "hi" }, ck)).json.error);

    // server-side maths matches the engine
    const sc = await api("POST", "/api/scenario", { cost: 80000, months: 5 }, ck2);
    assert.strictEqual(sc.json.scenario.after, 154500);
    assert.strictEqual(sc.json.scenario.verdict, "calm");
    assert.strictEqual((await api("POST", "/api/scenario", { cost: -1, months: 5 }, ck2)).status, 400);

    // transactions: import, summary, isolation, delete
    const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const csv = `Date,Description,Amount\n${ym}-01,Swiggy dinner,-500\n${ym}-01,Uber,-200\n${ym}-01,Salary,50000\n`;
    const im = await api("POST", "/api/transactions/import", { csv }, ck);
    assert.strictEqual(im.status, 200); assert.strictEqual(im.json.imported, 2);
    assert.strictEqual(im.json.summary.real, true);
    assert.strictEqual(im.json.summary.total, 700);
    assert.strictEqual(im.json.summary.categories[0].name, "Food delivery");
    assert.strictEqual((await api("GET", "/api/transactions/summary", undefined, ck2)).json.real, false, "other user sees nothing");
    assert.strictEqual((await api("POST", "/api/transactions/import", { csv: "nonsense" }, ck)).status, 400);
    // health check
    const health = await call(port, { path: "/api/health" });
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.json.status, "ok");

    // transactions: CRUD, pagination, export, recurring, forecast
    const txList = await api("GET", "/api/transactions?limit=10", undefined, ck);
    assert.strictEqual(txList.status, 200);
    assert.strictEqual(txList.json.total, 2);
    assert.strictEqual(txList.json.rows.length, 2);

    const newTx = await api("POST", "/api/transactions", { day: `${ym}-02`, amount: 1500, category: "Groceries", note: "Supermarket" }, ck);
    assert.strictEqual(newTx.status, 201);
    const createdId = newTx.json.transaction.id;
    assert.ok(createdId > 0);

    const updatedTx = await api("PUT", `/api/transactions/${createdId}`, { note: "Supermarket groceries" }, ck);
    assert.strictEqual(updatedTx.status, 200);
    assert.strictEqual(updatedTx.json.transaction.note, "Supermarket groceries");
    assert.strictEqual((await api("PUT", `/api/transactions/${createdId}`, { amount: -500 }, ck)).status, 400);

    const txExport = await call(port, { path: "/api/transactions/export", headers: { cookie: ck } });
    assert.strictEqual(txExport.status, 200);
    assert.ok(txExport.text.includes("Supermarket groceries"));

    const forecastRes = await api("GET", "/api/forecast", undefined, ck);
    assert.strictEqual(forecastRes.status, 200);
    assert.ok(forecastRes.json.forecast.days.length === 30);

    const recurringRes = await api("GET", "/api/transactions/recurring", undefined, ck);
    assert.strictEqual(recurringRes.status, 200);
    assert.ok(Array.isArray(recurringRes.json.recurring));

    const userExport = await api("GET", "/api/user/export", undefined, ck);
    assert.strictEqual(userExport.status, 200);
    assert.strictEqual(userExport.json.user.email, "asha@example.com");
    assert.ok(Array.isArray(userExport.json.transactions));

    const delSingle = await api("DELETE", `/api/transactions/${createdId}`, undefined, ck);
    assert.strictEqual(delSingle.status, 200);
    assert.strictEqual(delSingle.json.ok, true);

    // clear all transactions
    assert.strictEqual((await api("DELETE", "/api/transactions", undefined, ck)).json.deleted, 2);

    // change password
    assert.strictEqual((await api("POST", "/api/auth/change-password", { oldPassword: "wrong", newPassword: "new password 123" }, ck)).status, 401);
    assert.strictEqual((await api("POST", "/api/auth/change-password", { oldPassword: "correct horse", newPassword: "new password 123" }, ck)).status, 200);

    // logout kills the session
    await api("POST", "/api/auth/logout", {}, ck2);
    assert.strictEqual((await api("GET", "/api/session", undefined, ck2)).status, 401);

    // login with new password works
    const relogin = await api("POST", "/api/auth/login", { email: "asha@example.com", password: "new password 123" });
    assert.strictEqual(relogin.status, 200);
    const newCk = cookieOf(relogin);

    // logout all
    assert.strictEqual((await api("POST", "/api/auth/logout-all", {}, newCk)).status, 200);
    assert.strictEqual((await api("GET", "/api/session", undefined, newCk)).status, 401);

    // re-login to delete account
    const relogin2 = await api("POST", "/api/auth/login", { email: "asha@example.com", password: "new password 123" });
    const finalCk = cookieOf(relogin2);

    // deleting an account needs the password and removes everything
    assert.strictEqual((await api("POST", "/api/account/delete", { password: "nope nope" }, finalCk)).status, 401);
    assert.strictEqual((await api("POST", "/api/account/delete", { password: "new password 123" }, finalCk)).status, 200);
    assert.strictEqual((await api("GET", "/api/session", undefined, finalCk)).status, 401);
    assert.strictEqual((await api("POST", "/api/auth/login", { email: "asha@example.com", password: "new password 123" })).status, 401);
    assert.strictEqual(server.db.prepare("SELECT COUNT(*) AS n FROM docs WHERE user_id = 1").get().n, 0, "docs removed with the account");

    // login throttling
    let last;
    for (let i = 0; i < 10; i++) last = await api("POST", "/api/auth/login", { email: "ben@example.com", password: "wrong " + i });
    assert.strictEqual(last.status, 429);

    console.log("server tests passed");
  } catch (e) { console.error(e); process.exitCode = 1; }
  server.close();
});

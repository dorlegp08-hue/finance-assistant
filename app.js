// Fathom front end: pages, chat, palette. All sums come from engine.js; the model only words things.
(function () {
  const E = window.Engine, fmt = E.fmt;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const f1 = (n) => n.toFixed(1);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ico = (d, st) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"${st ? ` style="${st}"` : ""}><path d="${d}"/></svg>`;
  const ARROW = "M5 12h14M13 6l6 6-6 6", SEND = "M12 19V5M5 12l7-7 7 7", CHEV = "M6 9l6 6 6-6", CHECK = "M5 12l5 5 9-10";
  const CHAT = "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z";
  const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const THEMES = [
    { key: "pine", name: "Pine and saffron", fill: "linear-gradient(135deg,#0F3D2E 50%,#FFB400 50%)" },
    { key: "cobalt", name: "Cobalt and citron", fill: "linear-gradient(135deg,#1B34E8 50%,#D6F24A 50%)" },
    { key: "graphite", name: "Graphite and coral", fill: "linear-gradient(135deg,#181B22 50%,#FF6B4A 50%)" }
  ];
  const TABS = [["home", "Home"], ["chat", "Chat"], ["spend", "Spending"], ["futures", "Futures"], ["settings", "Settings"]];

  // ---------- state ----------
  const darkOS = !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const S = { theme: darkOS ? "graphite" : "pine", trim: false, g1: false, rng: 1, day: 17, sav: null };
  const saveT = {};
  // api(): JSON to the server. A 401 while signed in sends you back to the sign-in screen.
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && USER) { USER = null; showAuth("Your session ended. Please sign in again."); }
    if (!res.ok) throw Object.assign(new Error(data.error || "Request failed."), { status: res.status });
    return data;
  }
  // Saves are debounced; a failure shows one quiet toast.
  const save = (key, ms, fn) => { clearTimeout(saveT[key]); saveT[key] = setTimeout(() => { if (USER) fn().catch((e) => { if (e.status !== 401) toast("Could not save. Is the server still running?"); }); }, ms); };
  const persist = () => save("prefs", 400, () => api("PUT", "/api/prefs", { prefs: { theme: S.theme, trim: S.trim, g1: S.g1, rng: S.rng, day: S.day, sav: S.sav } }));
  let D, DEFAULTS, page = "", palOpen = false, palQ = "", palIdx = 0, palList = [], palPrev = null, msgs = [], mid = 0, busy = false, toastT, futT = 24, rafQ = {}, palOutT, lastLeak, sStep, USER = null, SUM = null, delOpen = false, authMode = "login";
  let FORECAST = null, RECURRING = null, TX_LIST = { rows: [], total: 0 }, txQ = "", addTxOpen = false, pwOpen = false, healthInfo = null;
  const later = (k, fn) => { if (rafQ[k]) return; rafQ[k] = requestAnimationFrame(() => { rafQ[k] = 0; fn(); }); };

  async function loadSpendData() {
    try {
      const [fc, rec, txs] = await Promise.all([
        api("GET", "/api/forecast").catch(() => null),
        api("GET", "/api/transactions/recurring").catch(() => null),
        api("GET", "/api/transactions?limit=30" + (txQ ? "&q=" + encodeURIComponent(txQ) : "")).catch(() => null)
      ]);
      if (fc && fc.forecast) FORECAST = fc.forecast;
      if (rec && rec.recurring) RECURRING = rec.recurring;
      if (txs) TX_LIST = txs;
      if (page === "spend") draw(false);
    } catch (e) {}
  }

  async function addManualTx(tx) {
    try {
      await api("POST", "/api/transactions", tx);
      addTxOpen = false;
      toast("Transaction added");
      SUM = await api("GET", "/api/transactions/summary");
      await loadSpendData();
      draw(false);
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteSingleTx(id) {
    try {
      await api("DELETE", `/api/transactions/${id}`);
      toast("Transaction removed");
      SUM = await api("GET", "/api/transactions/summary");
      await loadSpendData();
      draw(false);
    } catch (e) {
      toast(e.message);
    }
  }

  async function exportUserData() {
    try {
      const pkg = await api("GET", "/api/user/export");
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: "application/json" });
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `fathom-export-${(USER && USER.email ? USER.email : "user").replace(/[^a-zA-Z0-9]/g, "_")}.json`;
      a.click();
      URL.revokeObjectURL(u);
      toast("Data export downloaded");
    } catch (e) {
      toast("Export failed: " + (e.message || e));
    }
  }

  // The user's numbers come from the server: their saved profile, or the demo defaults.
  function finalize(d) {
    if (!d.today || d.today === "auto") { const t = new Date(); d.today = `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`; }
    d.trimGain = d.subs.filter((s) => s.unused).reduce((a, s) => a + s.amt, 0);
    return d;
  }
  const loadProfile = (profile, custom) => finalize({ ...profile, custom: !!custom });
  function persistData() {
    D.custom = true;
    const { today, trimGain, custom, ...rest } = D;
    save("profile", 500, () => api("PUT", "/api/profile", { profile: rest }));
  }
  function persistChat() { save("chat", 400, () => api("PUT", "/api/chat/history", { messages: msgs.filter((m) => m.type !== "think").slice(-60) })); }
  // Real categories from imported transactions win over the sample ones.
  const leaksNow = () => (SUM && SUM.real && SUM.categories.length ? SUM.categories : D.leaks);
  const guardAmt = () => { const l = leaksNow()[0]; return l ? Math.ceil((l.amt * 0.7) / 1000) * 1000 : 0; };
  const nUnused = () => D.subs.filter((s) => s.unused).length;

  const short = (n) => (n >= 100000 ? +(n / 100000).toFixed(1) + "L" : Math.round(n / 1000) + "k");
  const setPath = (el, d) => { el.setAttribute("d", d); el.style.d = `path('${d}')`; };
  const trimOn = () => S.trim;
  const sliderFill = (v, min, max) => `calc(15px + (100% - 30px) * ${((v - min) / (max - min)).toFixed(4)})`;

  function toast(msg) {
    clearTimeout(toastT);
    $("#toast").innerHTML = `<div class="toast" role="status">${ico(CHECK)}${esc(msg)}</div>`;
    const ic = $("#toast svg"); if (ic) { const [x, y] = Motion.at(ic); Motion.ripple(x, y, { small: true }); }
    toastT = setTimeout(() => ($("#toast").innerHTML = ""), 2800);
  }

  // ---------- shared actions ----------
  function toggleTrim() {
    S.trim = !S.trim; persist(); if (S.trim) Motion.chime();
    toast(S.trim ? `Paused ${nUnused()} subscriptions · +${fmt(D.trimGain)} a month` : "Subscriptions restored");
    refresh();
  }
  function refresh() {
    if (page === "chat") $$(".scn").forEach((el) => updateCard(el));
    else if (page === "futures") updateFut();
    else draw(false);
  }
  function go(p) { location.hash = "#/" + p; route(); }
  function setTheme(k) {
    S.theme = k; persist();
    const rt = $("#dx-root"); rt.className = rt.className.replace(/\bth-\w+/g, "").trim() + " th-" + k;
    $("#themes").innerHTML = THEMES.map((t) => `<button type="button" class="swb ${t.key === k ? "on" : ""}" aria-label="${t.name} theme" aria-pressed="${t.key === k}" data-theme="${t.key}"><i style="background:${t.fill}"></i></button>`).join("");
  }

  // ---------- HOME ----------
  function homeChart() {
    const ys = E.netWorthSeries(D, S.rng), W = 720, H = 230, PAD = 26;
    const lo = Math.min(...ys), hi = Math.max(...ys);
    const px = (i) => (i / (ys.length - 1)) * W, py = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2.4);
    const line = "M" + ys.map((v, i) => f1(px(i)) + " " + f1(py(v))).join(" L");
    return { line, area: line + ` L${W} ${H} L0 ${H} Z`, endY: f1(py(ys[ys.length - 1])), W };
  }
  function homeHtml() {
    const dt = E.parseDay(D.today), R = D.ranges[S.rng], ch = homeChart();
    const unused = D.subs.filter((s) => s.unused), leak = unused.reduce((a, s) => a + s.amt, 0);
    const dueTotal = D.bills.reduce((a, b) => a + b.amt, 0), big = D.bills.reduce((a, b) => (b.amt > a.amt ? b : a), D.bills[0]);
    const runway = D.runway || 4.1, covMon = E.MFULL[E.monthAt(D, Math.ceil(runway)).getMonth()];
    const wk = dt.toLocaleDateString("en-GB", { weekday: "long" });
    const d = D.netWorth - R.start;
    const L0 = leaksNow()[0], idle = Math.floor((D.balance - 2 * D.safety) / 1000) * 1000;
    const insights = [
      unused.length
        ? { t: `${WORDS[unused.length] || unused.length} app${unused.length > 1 ? "s" : ""} you haven’t opened in 60 days`, b: `${unused.map((s) => s.name).join(" and ")} cost${unused.length > 1 ? "" : "s"} ${fmt(leak)} a month${unused.length > 1 ? " together" : ""}.`, label: S.trim ? "Paused" : "Pause", done: S.trim, act: "trim" }
        : { t: "No unused subscriptions", b: "Everything you pay for looks in use. Edit your list in Settings.", label: "Review", act: "go:spend" },
      L0
        ? { t: `${L0.name}: ${L0.delta}`, b: `A ${fmt(guardAmt())} guardrail would warn you in Spending before you cross it.`, label: S.g1 ? "Guardrail on" : "Set guardrail", done: S.g1, act: "g1" }
        : { t: "No flagged categories", b: "Nothing stands out against your usual month.", label: "Review", act: "go:spend" },
      idle > 0
        ? { t: `${fmt(idle)} is sitting above your two-month safety buffer`, b: "It could be working harder. See what saving more does to your five-year picture.", label: "See options", act: "go:futures" }
        : { t: "Your balance is close to your safety line", b: "Saving a little more would help. Try the Futures sliders.", label: "See options", act: "go:futures" }
    ];
    return `<div class="wrap">
    <section class="hero"><div>
      <span class="eb">${wk} briefing · ${dt.getDate()} ${E.MN[dt.getMonth()]}</span>
      <h1>${unused.length ? `You’re ${runway >= 3 ? "on track" : "watching the line"}. <em>One thing</em> is quietly costing you <span class="hl" id="leakNum">${S.trim ? "₹0" : fmt(leak)}</span> a month.` : `You’re <em>on track.</em> Nothing is quietly costing you money.`}</h1>
      <p class="sub">${unused.length ? `${WORDS[unused.length] || unused.length} subscription${unused.length > 1 ? "s haven’t" : " hasn’t"} been opened in sixty days. Pause ${unused.length > 1 ? "them" : "it"} and keep ${fmt(leak)} a month.` : "No unused subscriptions found. Add or edit yours in Settings."}</p>
      <div class="acts">${unused.length ? `<button type="button" class="btn ${S.trim ? "done" : ""}" data-act="trim">${S.trim ? "Paused ✓" : "Pause them"}</button>` : ""}
      <button type="button" class="lnk" data-act="go:chat">Ask about this${ico(ARROW)}</button></div>
    </div>
    <div class="hp" aria-hidden="true"><div class="tape2"></div><div class="tape"></div>
      <div class="tk"><div class="row"><span class="eb">Runway</span><span class="pill v-calm"><i></i>Calm</span></div>
        <div class="big" style="font-size:58px;margin-top:12px">${runway} <span class="ser" style="font-size:26px;letter-spacing:0">months</span></div>
        <div class="ladder"><span class="safe" style="bottom:22px"></span>
          ${[22, 38, 54, 70].map((h, i) => `<span class="b" style="height:${h}%;animation-delay:${0.1 + i * 0.08}s"></span>`).join("")}<span class="b o" style="height:86%"></span><span class="b o" style="height:100%"></span></div>
        <div class="ladlab"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span></div></div></div></section>
    <section class="stats">
      <div class="stat"><span class="eb">Net worth</span><div class="big" id="nw">${fmt(D.netWorth)}</div><p><span class="delta" data-k="delta">+${fmt(d)} (+${((d / R.start) * 100).toFixed(1)}%)</span> over the last <span data-k="rword">${R.word}</span>.</p></div>
      <div class="stat"><span class="eb">Cover</span><div class="big">${runway}<span class="ser" style="font-size:28px;letter-spacing:0"> months</span></div><p>Everyday spending is covered into ${covMon}. Your safety line is ${fmt(D.safety)}.</p></div>
      <div class="stat"><span class="eb">Due in 10 days</span><div class="big">${fmt(dueTotal)}</div><p>${WORDS[D.bills.length] || D.bills.length} payments, the biggest on ${big.when}. All covered.</p></div>
    </section>
    <section class="sec"><div><span class="eb">Net worth</span><h2 data-k="head">Up ${fmt(d)} this ${R.word}.</h2><p class="lede">Everything you’ve connected, in one line. Switch the range to see how the picture changes.</p>
      <div class="rng" role="group" aria-label="Range" style="margin-top:22px">${D.ranges.map((r, i) => `<button type="button" class="rb ${i === S.rng ? "on" : ""}" aria-pressed="${i === S.rng}" data-range="${i}">${r.k}</button>`).join("")}</div></div>
      <div class="cd"><svg class="chart" viewBox="0 0 720 230" role="img" aria-label="Net worth over the selected range">
        <line class="gl" x1="0" y1="50" x2="720" y2="50"/><line class="gl" x1="0" y1="110" x2="720" y2="110"/><line class="gl" x1="0" y1="170" x2="720" y2="170"/>
        <path class="ar" data-k="area" d="${ch.area}" style="d:path('${ch.area}')"/><path class="ln" data-k="line" d="${ch.line}" style="d:path('${ch.line}')"/>
        <g class="mk v-calm" data-k="end" style="transform:translate(${ch.W}px,${ch.endY}px)"><circle class="mk-core" r="7" cx="0" cy="0"/></g></svg></div></section>
    <section class="sec"><div><span class="eb">Coming up</span><h2>${fmt(dueTotal)} leaves in ten days.</h2><p class="lede">Bills and automatic investments, in the order they hit.</p></div>
      <div class="cd" style="padding-top:20px;padding-bottom:20px">${D.bills.map((b) => `<div class="li"><span class="when">${esc(b.when)}</span><span class="nm">${esc(b.name)}<small>${esc(b.sub)}</small></span><span class="am">${fmt(b.amt)}</span></div>`).join("")}</div></section>
    <section class="sec"><div><span class="eb">Fathom noticed</span><h2>Three things worth a minute.</h2><p class="lede">Each one comes with a button, and nothing happens until you press it.</p></div>
      <div>${insights.map((n, i) => `<div class="note"><span class="n">${i + 1}</span><div style="flex:1"><h4>${esc(n.t)}</h4><p>${esc(n.b)}</p></div><button type="button" class="ghost ${n.done ? "done" : ""}" data-act="${n.act}">${n.label}</button></div>`).join("")}</div></section>
    <section class="sec"><div><span class="eb">Goals</span><h2>Where your savings are heading.</h2><button type="button" class="lnk" style="margin-top:14px;padding:0" data-act="go:futures">Open Futures${ico(ARROW)}</button></div>
      <div class="cd" style="padding-top:20px;padding-bottom:20px">${D.goals.map((g) => `<div class="goal"><div class="row"><span style="font-size:17px;font-weight:600">${esc(g.name)}</span><span class="mono" style="font-size:13px;color:var(--ink2)">${g.unit ? `${g.have} of ${g.need} ${g.unit}` : `${fmt(g.have)} of ${fmt(g.need)}`}</span></div><div class="gbar"><i style="width:${Math.min(100, (g.have / g.need) * 100).toFixed(0)}%"></i></div></div>`).join("")}</div></section>
    <div class="foot"><div class="accts"><span><b>Balance</b> · ${fmt(D.balance)}</span><span><b>Saving</b> · ${fmt(D.saving)} a month</span><span><b>Source</b> · ${D.custom ? "your numbers" : "demo data"} (edit in Settings)</span></div><span>Fathom looks, it never moves money. Informational, not financial advice.</span></div></div>`;
  }
  function homeBind(root, nav) {
    Motion.num($("#nw", root), D.netWorth, fmt, { from: nav ? D.netWorth * 0.7 : undefined, tau: 420 });
    const lk = $("#leakNum", root);
    if (lk) {
      const to = S.trim ? 0 : D.subs.filter((s) => s.unused).reduce((a, s) => a + s.amt, 0);
      Motion.num(lk, to, fmt, { from: lastLeak, tau: 260 }); lastLeak = to;
    }
  }
  function homeRange(i) {
    S.rng = i; persist();
    const root = $("#page"), R = D.ranges[i], ch = homeChart(), d = D.netWorth - R.start;
    $$("[data-range]", root).forEach((b, j) => { b.classList.toggle("on", j === i); b.setAttribute("aria-pressed", j === i); });
    $("[data-k=delta]", root).textContent = `+${fmt(d)} (+${((d / R.start) * 100).toFixed(1)}%)`;
    $("[data-k=rword]", root).textContent = R.word;
    $("[data-k=head]", root).textContent = `Up ${fmt(d)} this ${R.word}.`;
    setPath($("[data-k=area]", root), ch.area); setPath($("[data-k=line]", root), ch.line);
    $("[data-k=end]", root).style.transform = `translate(${ch.W}px,${ch.endY}px)`;
  }

  // ---------- SPENDING ----------
  function spendHtml() {
    const dt = E.parseDay(D.today), real = !!(SUM && SUM.real);
    const today = real ? SUM.upTo : dt.getDate(), y = real ? SUM.y : dt.getFullYear(), mo = real ? SUM.m : dt.getMonth();
    const dim = new Date(y, mo + 1, 0).getDate(), lead = (new Date(y, mo, 1).getDay() + 6) % 7, mname = E.MFULL[mo];
    const daySpend = (k) => (real ? SUM.daily[k] || 0 : E.daySpend(k, (lead + k - 1) % 7));
    let total = 0, mx = 0;
    for (let k = 1; k <= today; k++) { total += daySpend(k); mx = Math.max(mx, daySpend(k)); }
    const avg = total / today, sel = Math.min(S.day, today), sv = daySpend(sel), diff = Math.round((sv / avg - 1) * 100);
    let cells = "<span></span>".repeat(0);
    for (let k = 0; k < lead; k++) cells += `<span class="hc emp"></span>`;
    for (let k = 1; k <= dim; k++) {
      if (k > today) { cells += `<span class="hc fut" aria-label="${k} ${mname}, upcoming">${k}</span>`; continue; }
      cells += `<button type="button" class="hc ${E.heatLevel(daySpend(k), mx)}${sel === k ? " sel" : ""}" aria-label="${k} ${mname}, ${fmt(daySpend(k))}" aria-pressed="${sel === k}" data-day="${k}">${k}</button>`;
    }
    const subTotal = D.subs.reduce((a, s) => a + s.amt, 0), LK = leaksNow(), maxLeak = LK.length ? LK[0].amt || 1 : 1, nu = nUnused();
    
    const fcHtml = FORECAST ? `
    <section class="sec">
      <div>
        <span class="eb">Cash Flow Projection</span>
        <h2>30-day forecast.</h2>
        <p class="lede">Simulates your daily spend and scheduled bill dates against your ${fmt(D.safety)} safety buffer.</p>
      </div>
      <div class="cd forecast-box">
        <div class="grid3">
          <div><span class="eb">Daily burn rate</span><div class="big" style="font-size:36px;margin-top:6px">~${fmt(FORECAST.dailyBurnRate)}</div><span class="muted" style="font-size:12px">estimated/day</span></div>
          <div><span class="eb">In 30 days</span><div class="big" style="font-size:36px;margin-top:6px">${fmt(FORECAST.projectedEndBalance)}</div><span class="muted" style="font-size:12px">projected balance</span></div>
          <div><span class="eb">Lowest point</span><div class="big" style="font-size:36px;margin-top:6px">${fmt(FORECAST.minProjectedBalance)}</div><span class="muted" style="font-size:12px">safety line is ${fmt(D.safety)}</span></div>
        </div>
        ${FORECAST.breachesSafety
          ? `<div class="forecast-warn">${ico("M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z")} Heads up: Cash flow is projected to dip below your safety line (${fmt(D.safety)}).</div>`
          : `<div class="forecast-ok">${ico(CHECK)} 30-day projection stays safely above your ${fmt(D.safety)} safety buffer.</div>`
        }
      </div>
    </section>` : "";

    const recList = Array.isArray(RECURRING) ? RECURRING : [];
    const recHtml = recList.length ? `
    <section class="sec">
      <div>
        <span class="eb">Detected recurring</span>
        <h2>${recList.length} regular charge${recList.length > 1 ? "s" : ""}.</h2>
        <p class="lede">Automatically discovered from cadence and descriptions in your transactions.</p>
      </div>
      <div class="cd" style="padding-top:20px;padding-bottom:20px">
        ${recList.map((r) => `
          <div class="rec-item">
            <div>
              <div style="font-size:16px;font-weight:600">${esc(r.merchant)}</div>
              <div class="tx-cat">${esc(r.category)} · <span style="text-transform:capitalize">${esc(r.cadence)}</span> (${r.occurrences}x seen, latest ${esc(r.lastDate)})</div>
            </div>
            <div class="tx-amt" style="font-size:16px">~${fmt(r.estimatedAmount)}</div>
          </div>
        `).join("")}
      </div>
    </section>` : "";

    const txRows = (TX_LIST && Array.isArray(TX_LIST.rows)) ? TX_LIST.rows : [];
    const txHtml = `
    <section class="sec">
      <div>
        <span class="eb">Transactions Ledger</span>
        <h2>${TX_LIST.total || txRows.length} recorded.</h2>
        <p class="lede">Search, review individual transactions, or manually log an expense.</p>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <button type="button" class="ghost" data-act="toggleAddTx">${addTxOpen ? "Cancel" : "+ Add transaction"}</button>
          <a href="/api/transactions/export" download class="ghost" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">Export CSV</a>
        </div>
      </div>
      <div class="cd">
        ${addTxOpen ? `
          <form id="addTxForm" class="drawer" style="margin-top:0;margin-bottom:20px">
            <span class="eb">Log single transaction</span>
            <div class="grid2">
              <label class="fld"><span class="eb">Date</span><input class="inp" type="date" id="txDay" value="${D.today}" required></label>
              <label class="fld"><span class="eb">Amount (₹)</span><input class="inp" type="number" step="any" min="0.01" id="txAmt" placeholder="e.g. 450" required></label>
              <label class="fld"><span class="eb">Category</span><input class="inp" type="text" id="txCat" placeholder="e.g. Groceries, Dining" maxlength="40"></label>
              <label class="fld"><span class="eb">Description</span><input class="inp" type="text" id="txNote" placeholder="e.g. Supermarket snacks" maxlength="80"></label>
            </div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <button type="button" class="ghost" data-act="toggleAddTx">Cancel</button>
              <button type="submit" class="btn">Save transaction</button>
            </div>
          </form>
        ` : ""}
        <div class="tx-tools">
          <input type="search" class="tx-search" id="txSearch" placeholder="Search notes or descriptions…" value="${esc(txQ)}">
          <span class="muted mono" style="font-size:12px">${txRows.length} shown</span>
        </div>
        <div class="tx-list">
          ${txRows.length ? txRows.map((t) => `
            <div class="tx-row">
              <span class="tx-date">${esc(t.day)}</span>
              <div class="tx-info">
                <div class="tx-note">${esc(t.note || t.category)}</div>
                <span class="tx-cat">${esc(t.category)}</span>
              </div>
              <div class="tx-amt">${fmt(t.amount)}</div>
              <button type="button" class="tx-del" data-act="delSingleTx:${t.id}" aria-label="Delete transaction" title="Delete transaction">${ico("M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16")}</button>
            </div>
          `).join("") : `<div class="muted say" style="padding:24px 0">No transactions match your search.</div>`}
        </div>
      </div>
    </section>`;

    return `<div class="wrap">
    <div class="ph"><div><span class="eb">${mname} · so far</span><h1>Where it <em>went</em></h1></div><div class="big" style="font-size:72px">${fmt(total)}</div></div>
    ${fcHtml}
    <section class="sec"><div><span class="eb">Every day</span><h2>${real ? "Your month, day by day." : "The pattern is weekends."}</h2><p class="lede">Darker days cost more. Tap one for the detail. ${real ? "From your imported transactions." : "This is a sample pattern until you import your transactions in Settings."}</p>
      <div class="legend" style="margin-top:20px"><span>less</span><i style="background:var(--bg);border:1px solid var(--line)"></i><i style="background:color-mix(in srgb,var(--accent) 16%,var(--card))"></i><i style="background:color-mix(in srgb,var(--accent) 36%,var(--card))"></i><i style="background:color-mix(in srgb,var(--accent) 62%,var(--card))"></i><i style="background:var(--accent)"></i><span>more</span></div></div>
      <div class="cd"><div class="heat">${E.DOW.map((d) => `<span class="hd">${d.toUpperCase()}</span>`).join("")}${cells}</div>
        <div class="row" style="margin-top:22px;padding-top:20px;border-top:1px solid var(--line);align-items:flex-start"><div><div class="mono muted" style="font-size:12px">${E.DOW[(lead + sel - 1) % 7]} ${sel} ${E.MN[mo]}</div><div class="big" style="font-size:48px;margin-top:8px">${fmt(sv)}</div></div>
        <p class="say muted" style="max-width:260px;text-align:right">${diff >= 0 ? diff + "% above" : Math.abs(diff) + "% below"} your daily average of ${fmt(avg)}.</p></div></div></section>
    <section class="sec"><div><span class="eb">Flagged categories</span><h2>${LK.length ? (WORDS[LK.length] || LK.length) + " small leak" + (LK.length > 1 ? "s" : "") : "No leaks"}.</h2><p class="lede">Compared with your own usual month, not a made-up average.</p></div>
      <div class="cd" style="padding-top:20px;padding-bottom:20px">${LK.map((l, i) =>`<div class="lk"><div class="row"><span style="font-size:16.5px;font-weight:600">${esc(l.name)}</span><span class="mono" style="font-size:14px">${fmt(l.amt)}</span></div><div class="mono muted" style="font-size:12px;margin-top:4px">${esc(l.delta)} · worth ${fmt(l.plug)} a month${i === 0 && S.g1 && l.amt > guardAmt() ? ` · <span style="color:var(--neg)">over your ${fmt(guardAmt())} guardrail by ${fmt(l.amt - guardAmt())}</span>` : ""}</div><div class="bt"><div class="bf" style="width:${((l.amt / maxLeak) * 100).toFixed(1)}%;animation-delay:${200 + i * 110}ms"></div></div></div>`).join("")}</div></section>
    ${recHtml}
    <section class="sec"><div><span class="eb">Subscriptions</span><h2>${fmt(subTotal)} a month.</h2><p class="lede">${S.trim ? `Pausing ${nu} of them saves ${fmt(D.trimGain)} a month` : `${nu} of ${D.subs.length} look unused`}.</p></div>
      <div class="cd" style="padding-top:18px;padding-bottom:18px">${D.subs.map((s) => `<div class="subr"><span class="ic2">${esc(s.glyph || (s.name || "?")[0].toUpperCase())}</span><span style="flex:1;font-size:15.5px;font-weight:600">${esc(s.name)}${s.unused ? `<span class="tag">unopened 60 days</span>` : ""}</span><span class="mono" style="font-size:14px;width:90px;text-align:right">${fmt(s.amt)}</span>${s.unused ? `<button type="button" class="ghost ${S.trim ? "done" : ""}" aria-pressed="${S.trim}" data-act="trim" style="width:100px;justify-content:center">${S.trim ? "Paused" : "Pause"}</button>` : `<span class="muted mono" style="font-size:12px;width:100px;text-align:center">in use</span>`}</div>`).join("")}</div></section>
    ${txHtml}</div>`;
  }

  // ---------- SETTINGS ----------
  const fld = (label, path, val, o) => { o = o || {}; return `<label class="fld"${o.grow ? ` style="flex:${o.grow} 1 160px"` : ""}><span class="eb">${label}</span><input class="inp" type="${o.type || "number"}"${o.type ? "" : ' min="0" step="any"'} data-set="${path}"${o.scale ? ` data-scale="${o.scale}"` : ""} value="${esc(val)}"></label>`; };
  function settingsHtml() {
    const rows = (key, cols) => D[key].map((it, i) => `<div class="edit">${cols(it, i)}<button type="button" class="ghost" data-act="del:${key}:${i}" aria-label="Remove ${esc(it.name || "row")}">Remove</button></div>`).join("");
    const sec = (eb, h, lede, body) => `<section class="sec"><div><span class="eb">${eb}</span><h2>${h}</h2><p class="lede">${lede}</p></div><div class="cd">${body}</div></section>`;
    return `<div class="wrap"><div class="ph"><div><span class="eb">Your numbers</span><h1>Make it <em>yours</em></h1></div><button type="button" class="ghost" data-act="resetData">Reset to demo</button></div>
    ${sec("Basics", "Where you start.", "Every page and the chat use these. They stay in this browser.", `<div class="grid2">${fld("In the bank (₹)", "balance", D.balance)}${fld("Saved each month (₹)", "saving", D.saving)}${fld("Safety line (₹)", "safety", D.safety)}${fld("Net worth (₹)", "netWorth", D.netWorth)}${fld("Months of cover", "runway", D.runway)}${fld("Yearly growth (%)", "growth", +(D.growth * 100).toFixed(2), { scale: 0.01 })}</div>`)}
    ${sec("Subscriptions", "What you pay for.", "Tick “unopened” for ones you don’t use. Fathom offers to pause those.", rows("subs", (s, i) => `${fld("Name", `subs.${i}.name`, s.name, { type: "text", grow: 3 })}${fld("₹ a month", `subs.${i}.amt`, s.amt)}<label class="chk"><input type="checkbox" data-set="subs.${i}.unused" data-type="bool" ${s.unused ? "checked" : ""}> unopened 60 days</label>`) + `<button type="button" class="ghost" style="margin-top:14px" data-act="add:subs">Add subscription</button>`)}
    ${sec("Bills", "What leaves soon.", "Bills and automatic investments shown under Coming up.", rows("bills", (b, i) => `${fld("Date", `bills.${i}.when`, b.when, { type: "text" })}${fld("Name", `bills.${i}.name`, b.name, { type: "text", grow: 2 })}${fld("Note", `bills.${i}.sub`, b.sub, { type: "text" })}${fld("₹", `bills.${i}.amt`, b.amt)}`) + `<button type="button" class="ghost" style="margin-top:14px" data-act="add:bills">Add bill</button>`)}
    ${sec("Goals", "What you’re saving for.", "Leave unit empty for rupees, or write “months”.", rows("goals", (g, i) => `${fld("Name", `goals.${i}.name`, g.name, { type: "text", grow: 2 })}${fld("Saved so far", `goals.${i}.have`, g.have)}${fld("Target", `goals.${i}.need`, g.need)}${fld("Unit", `goals.${i}.unit`, g.unit || "", { type: "text" })}`) + `<button type="button" class="ghost" style="margin-top:14px" data-act="add:goals">Add goal</button>`)}
    ${sec("Transactions", "Your real spending.", "Import a bank statement CSV (date, description, amount; negative amounts are spending). You can also export your history as CSV.", `
      <p class="say muted" style="margin-bottom:14px">${SUM && SUM.real ? `${SUM.count} transactions loaded.` : "No transactions yet. The Spending page shows a sample pattern."}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <label class="ghost" for="csvFile" style="cursor:pointer">Choose CSV file</label>
        <input type="file" id="csvFile" accept=".csv,text/csv,text/plain" class="sr">
        <a href="/api/transactions/export" download class="ghost" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">Export CSV</a>
        ${SUM && SUM.real ? `<button type="button" class="ghost" data-act="delTx">Delete all transactions</button>` : ""}
      </div>
    `)}
    ${sec("Account & Security", "Signed in.", "Your credentials, sessions, and data portability.", `
      <p class="say" style="margin-bottom:14px"><b>${esc(USER ? USER.name : "")}</b> · ${esc(USER ? USER.email : "")}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button type="button" class="ghost" data-act="togglePw" aria-expanded="${pwOpen}">Change password</button>
        <button type="button" class="ghost" data-act="exportUser">Export all data (JSON)</button>
        <button type="button" class="ghost" data-act="signout">Sign out</button>
        <button type="button" class="ghost" data-act="signoutAll">Sign out all devices</button>
        <button type="button" class="ghost" data-act="delAccount" aria-expanded="${delOpen}" style="color:var(--neg)">Delete account</button>
      </div>
      ${pwOpen ? `
        <form id="pwForm" class="drawer">
          <span class="eb">Change Password</span>
          <div class="grid2">
            <label class="fld"><span class="eb">Current Password</span><input class="inp" type="password" id="pwOld" required autocomplete="current-password"></label>
            <label class="fld"><span class="eb">New Password (8+ chars)</span><input class="inp" type="password" id="pwNew" minlength="8" required autocomplete="new-password"></label>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" class="ghost" data-act="togglePw">Cancel</button>
            <button type="submit" class="btn">Update password</button>
          </div>
        </form>
      ` : ""}
      ${delOpen ? `
        <div class="drawer" style="border-color:var(--neg)">
          <span class="eb" style="color:var(--neg)">Delete Account</span>
          <p class="muted say">This permanently removes your account, chat history, transactions, and preferences from this server.</p>
          <label class="fld"><span class="eb">Confirm with your password</span><input class="inp" type="password" id="delPw" autocomplete="current-password"></label>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" class="ghost" data-act="delAccount">Cancel</button>
            <button type="button" class="btn" data-act="delAccountGo" style="background:var(--neg)">Delete everything</button>
          </div>
        </div>
      ` : ""}
    `)}
    ${sec("Motion", "How it moves.", "Full is the whole experience. Calm keeps soft fades and rolling numbers. Off stops all animation. First visit follows your system’s reduced-motion setting.", `<div class="rng" role="group" aria-label="Motion">${["full", "calm", "off"].map((m) => `<button type="button" class="rb ${Motion.cfg.mode === m ? "on" : ""}" aria-pressed="${Motion.cfg.mode === m}" data-act="motion:${m}">${m[0].toUpperCase() + m.slice(1)}</button>`).join("")}</div><label class="chk" style="margin-top:14px"><input type="checkbox" data-motion="sound" ${Motion.cfg.sound ? "checked" : ""}> Soft sounds (off by default)</label>`)}
    ${sec("System & AI", "Who answers & system status.", "The provider and API key are set in config.json on the machine running the server. The key never reaches this page.", `
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        <span class="health-pill">${ico(CHECK)} Server: ${healthInfo ? esc(healthInfo.status) : "online"}</span>
        <span class="health-pill">AI: ${healthInfo ? esc(healthInfo.provider) : "configured"}</span>
        ${healthInfo && healthInfo.uptime ? `<span class="health-pill">Uptime: ${Math.round(healthInfo.uptime)}s</span>` : ""}
      </div>
      <p class="say muted">Supports Google Gemini, OpenAI, Anthropic, Groq, and offline local Ollama. Without an API key, Chat uses local smart calculations.</p>
    `)}</div>`;
  }

  // ---------- FUTURES ----------
  function futHtml() {
    return `<div class="wrap">
    <div class="ph"><div><span class="eb">Five-year view</span><h1>Your <em>futures</em></h1></div></div>
    <section class="cd" style="padding:36px">
      <div class="row" style="align-items:flex-start;flex-wrap:wrap;gap:32px">
        <div class="col" style="gap:12px"><span class="eb" data-k="date"></span><div class="big" style="font-size:88px" data-k="nw"></div><span class="pill v-calm"><i></i><span data-k="vs"></span></span></div>
        <div style="flex:0 1 380px;min-width:260px;width:100%"><span class="eb">Saved each month</span><div class="big" style="font-size:40px;margin:10px 0 4px" data-k="sav"></div>
          <div class="rw"><div class="rt"></div><div class="rf" data-k="savFill"></div><input class="fx-range" type="range" min="5000" max="60000" step="500" value="${S.sav}" aria-label="Monthly saving" data-slider="sav"></div>
          <div class="minmax"><span>₹5k</span><span>₹60k</span></div></div>
      </div>
      <div style="margin-top:26px"><svg class="chart" viewBox="0 0 1000 260" role="img" aria-label="Projected net worth over five years">
        <line class="gl" x1="0" y1="50" x2="1000" y2="50"/><line class="gl" x1="0" y1="110" x2="1000" y2="110"/><line class="gl" x1="0" y1="170" x2="1000" y2="170"/>
        <path class="ar" data-k="area"/><path class="ln0" data-k="base"/><path class="ln" data-k="line"/>
        <g class="mk v-calm" data-k="mk"><circle class="mk-core" r="8" cx="0" cy="0"/></g></svg>
        <div class="tkrow" style="margin-top:6px" data-k="ticks"></div></div>
      <div style="margin-top:16px"><div class="rw"><div class="rt"></div><div class="rf" data-k="tFill"></div><input class="fx-range" type="range" min="0" max="60" step="1" value="${futT}" aria-label="Drag through time" data-slider="t"></div>
        <div class="minmax"><span>Now</span><span>Drag through time</span><span>5 years</span></div></div>
    </section>
    <div class="ms" data-k="ms"></div></div>`;
  }
  function updateFut() {
    const root = $("#page"), k = (n) => $(`[data-k=${n}]`, root);
    const se = S.sav + (trimOn() ? D.trimGain : 0), tt = futT, P = (m, s) => E.project(D, m, s);
    const FW = 1000, FH = 260, FT = 24, FB = 236, fhi = Math.max(P(60, se), P(60, D.saving)) * 1.04;
    const fx = (m) => (m / 60) * FW, fy = (v) => FB - (v / fhi) * (FB - FT);
    const lp = [], bp = [];
    for (let m = 0; m <= 60; m++) { lp.push(f1(fx(m)) + " " + f1(fy(P(m, se)))); bp.push(f1(fx(m)) + " " + f1(fy(P(m, D.saving)))); }
    const line = "M" + lp.join(" L"), nowAt = P(tt, se), dv = nowAt - P(tt, D.saving);
    k("date").textContent = tt === 0 ? "Today" : E.whenLabel(D, tt);
    Motion.num(k("nw"), nowAt, fmt, { tau: 80 });
    k("vs").textContent = Math.abs(dv) < 50 ? "on your current pace" : (dv > 0 ? "+" : "−") + fmt(Math.abs(dv)) + " vs " + fmt(D.saving) + " a month";
    Motion.num(k("sav"), se, fmt, { tau: 70 });
    $("[data-slider=sav]", root).setAttribute("aria-valuetext", fmt(S.sav) + " a month");
    $("[data-slider=t]", root).setAttribute("aria-valuetext", tt === 0 ? "today" : E.whenLabel(D, tt));
    k("savFill").style.width = sliderFill(S.sav, 5000, 60000);
    k("tFill").style.width = sliderFill(tt, 0, 60);
    setPath(k("line"), line); setPath(k("base"), "M" + bp.join(" L")); setPath(k("area"), line + ` L${FW} ${FH} L0 ${FH} Z`);
    k("mk").style.transform = `translate(${f1(fx(tt))}px,${f1(fy(nowAt))}px)`;
    k("ticks").innerHTML = [0, 12, 24, 36, 48, 60].map((m) => `<span style="left:${((m / 60) * 100).toFixed(2)}%;transform:translateX(${m === 0 ? "0" : m === 60 ? "-100%" : "-50%"})">${m === 0 ? "Now" : E.whenLabel(D, m)}</span>`).join("");
    const mst = [1000000, 1500000, 2000000].map((th) => ({ th, m: E.monthsToReach(D, th, se) })), msBox = k("ms"), msKey = mst.map((x) => x.m).join(",");
    if (msBox.dataset.key !== msKey) msBox.innerHTML = mst.map(({ th, m }) => {
      return `<div data-m="${m}"><span class="eb">₹${th / 100000} lakh net worth</span><div class="big" style="font-size:44px;margin-top:14px">${m < 0 ? "Beyond 5 years" : m === 0 ? "Already here" : E.whenLabel(D, m)}</div><div class="muted mono" style="font-size:12.5px;margin-top:10px">${m < 0 ? "Try saving a little more" : "in " + (m >= 12 ? Math.floor(m / 12) + " yr " + (m % 12) + " mo" : m + " months")}</div></div>`;
    }).join("");
    msBox.dataset.key = msKey;
    $$("[data-m]", msBox).forEach((d) => d.classList.toggle("hit", +d.dataset.m >= 0 && +d.dataset.m <= tt));
  }

  // ---------- CHAT ----------
  function cardHtml(m, i) {
    return `<section class="cd scn" data-i="${i}" style="display:flex;flex-direction:column;gap:20px;padding:32px">
      <div class="row"><span class="eb" data-k="eyebrow"></span><span class="pill"><i></i><span data-k="verdict"></span></span></div>
      <div class="big costbig" data-k="costLabel"></div>
      <div><div class="rw"><div class="rt"></div><div class="rf" data-k="fill"></div><input class="fx-range" type="range" step="500" aria-label="Budget" data-slider="cost"></div><div class="minmax"><span data-k="min"></span><span data-k="max"></span></div></div>
      <p class="say" data-k="say"></p>
      <div><svg class="chart" viewBox="0 0 680 150" role="img" data-k="alt"><g class="bl" data-k="buf"><line x1="0" y1="0" x2="680" y2="0"/></g><text class="cl" x="0" data-k="bufLabel">one month of cover</text>
        <path class="ar" data-k="area"/><path class="ln0" data-k="without"/><path class="ln" data-k="with"/><g class="mk" data-k="mk"><circle class="mk-core" r="7" cx="0" cy="0"/></g></svg><div class="tkrow" data-k="ticks"></div></div>
      <div class="levers"><button type="button" class="lev" data-act="delay" data-k="lev1"></button><button type="button" class="lev" data-act="trim" data-k="lev2"></button></div>
      <div><button type="button" class="mathbtn" aria-expanded="false" data-act="math"><span>Show the math</span>${ico(CHEV)}</button><div class="mathwrap" data-k="mathwrap"><div class="mathin" data-k="math"></div></div></div></section>`;
  }
  function updateCard(root) {
    const m = msgs.find((x) => x.id === +root.dataset.i), k = (n) => $(`[data-k=${n}]`, root);
    if (!m) return;
    const s = E.scenario(D, { cost: m.cost, months: m.months, delay: m.delay, trim: S.trim });
    const max = Math.max(200000, Math.ceil((m.cost * 2) / 50000) * 50000), min = 5000, slider = $("[data-slider=cost]", root);
    slider.min = min; slider.max = max; if (+slider.value !== m.cost) slider.value = m.cost;
    slider.setAttribute("aria-valuetext", fmt(m.cost));
    const prevV = root.dataset.v; root.dataset.v = s.verdict;
    root.classList.remove("v-calm", "v-steady", "v-stretched"); root.classList.add("v-" + s.verdict);
    if (prevV && prevV !== s.verdict) Motion.verdict(root, k("mk"));
    k("eyebrow").textContent = `${m.label} · ${s.mon} · drag the number`;
    k("verdict").textContent = { calm: "Comfortable", steady: "Tight, but fine", stretched: "Stretching it" }[s.verdict];
    Motion.num(k("costLabel"), m.cost, fmt, { tau: 70 });
    k("fill").style.width = sliderFill(m.cost, min, max);
    k("min").textContent = "₹" + short(min); k("max").textContent = "₹" + short(max);
    k("say").textContent = s.say;
    const CW = 680, XS = (CW - 12) / s.H, X0 = 6, BASE = 126, TOP = 14, xm = (i) => X0 + i * XS;
    const clo = Math.min(D.balance, s.after, D.safety) - 12000, chi = Math.max(...s.without) + 8000, yv = (v) => BASE - ((v - clo) / (chi - clo)) * (BASE - TOP);
    const pts = [];
    for (let i = 0; i <= s.H; i++) { if (i === s.tm) pts.push([xm(i), yv(s.without[i])]); pts.push([xm(i), yv(s.withSpend[i])]); }
    const dWith = "M" + pts.map((p) => f1(p[0]) + " " + f1(p[1])).join(" L"), bufY = yv(D.safety);
    setPath(k("with"), dWith); setPath(k("without"), "M" + s.without.map((v, i) => f1(xm(i)) + " " + f1(yv(v))).join(" L"));
    setPath(k("area"), dWith + ` L${f1(xm(s.H))} ${BASE} L${f1(xm(0))} ${BASE} Z`);
    k("buf").style.transform = `translateY(${f1(bufY)}px)`; k("bufLabel").setAttribute("y", f1(bufY + 16));
    k("mk").style.transform = `translate(${f1(xm(s.tm))}px,${f1(yv(s.after))}px)`;
    k("alt").setAttribute("aria-label", `Projected balance. With the spend in ${s.mon} you land with ${fmt(s.after)}.`);
    k("ticks").innerHTML = s.labels.map((l, i) => `<span class="${i === s.tm ? "tk-on" : ""}" style="left:${((xm(i) / CW) * 100).toFixed(2)}%;transform:translateX(${i === 0 ? "0" : i === s.H ? "-100%" : "-50%"})">${l}</span>`).join("");
    const nextMon = E.MFULL[E.monthAt(D, m.months + 1).getMonth()];
    const lev = (b, on, label, sub) => { b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); b.innerHTML = `<span>${label}<small>${sub}</small></span><span class="tg"></span>`; };
    lev(k("lev1"), m.delay, `Go in ${nextMon} instead`, "one more month of saving");
    lev(k("lev2"), S.trim, `Pause ${nUnused()} unused subscription${nUnused() === 1 ? "" : "s"}`, `+${fmt(D.trimGain)} a month`);
    k("math").innerHTML = s.math.map((l) => `<div class="ml ${l.sum ? "sum" : ""}"><span class="l">${esc(l.label)}<b>${esc(l.sub)}</b></span><span class="v">${l.val}</span></div>`).join("");
    if (m.mathOpen !== undefined) { k("mathwrap").classList.toggle("open", !!m.mathOpen); $(".mathbtn", root).setAttribute("aria-expanded", !!m.mathOpen); }
    const h1 = $("#chatTitle"); if (h1 && m === lastScn()) h1.innerHTML = `${esc(m.label)} <em>in ${s.mon}</em>`;
  }
  const lastScn = () => [...msgs].reverse().find((x) => x.type === "scn");
  function msgHtml(m) {
    if (m.type === "user") return `<div class="u" data-mid="${m.id}">${esc(m.text)}</div>`;
    const fresh = !m.seen; m.seen = true; // each message animates once, not on every visit
    if (m.type === "lead") return `<div class="lead ${m.text.length > 90 ? "sm" : ""}" data-mid="${m.id}">${m.text.split(" ").map((t, i) => `<span class="w" style="animation-delay:${100 + i * 50}ms${fresh ? "" : ";animation:none"}">${esc(t)}</span>`).join("")}</div>`;
    if (m.type === "scn") return cardHtml(m, m.id).replace('data-i="' + m.id + '"', `data-i="${m.id}" data-mid="${m.id}"`).replace('class="cd scn"', `class="cd scn${fresh ? " unfold" : ""}"`);
    if (m.type === "think") return `<div class="think" data-mid="${m.id}"><span class="orb"><i></i><i></i></span>Reading your numbers</div>`;
    if (m.type === "hint") return `<div class="hint" data-mid="${m.id}">${esc(m.text)}</div>`;
    const words = (t) => { let i = 0; return t.split(/(\s+)/).map((p) => (!p || /^\s+$/.test(p) ? p : `<span class="w2" style="animation-delay:${Math.min(i++, 60) * 28}ms">${esc(p)}</span>`)).join(""); };
    return `<div class="ans ${m.err ? "err" : ""}" data-mid="${m.id}">${fresh && m.text.length < 600 ? words(m.text) : esc(m.text)}</div>`;
  }
  function pushMsg(m) {
    m.id = ++mid; msgs.push(m); persistChat();
    if (m.text && m.type !== "user" && m.type !== "think") { const lv = $("#live"); if (lv) lv.textContent = m.text; }
    if (m.type === "ans" || m.type === "scn") Motion.pop();
    if (page === "chat") {
      const em = $("#emptyChat"); if (em) em.remove();
      const box = $("#msgs"); box.insertAdjacentHTML("beforeend", msgHtml(m));
      if (m.type === "scn") { const c = box.lastElementChild; updateCard(c); Motion.drawChart($("svg.chart", c)); }
      const pg = $("#page"); pg.scrollTo({ top: pg.scrollHeight, behavior: "smooth" });
    }
    return m;
  }
  function dropMsg(m) { msgs = msgs.filter((x) => x !== m); persistChat(); const el = $(`[data-mid="${m.id}"]`); if (el) el.remove(); }
  function addScenario(label, cost, months, lead) {
    pushMsg({ type: "lead", text: lead || "Let’s test it. Drag the number and the picture bends with you." });
    pushMsg({ type: "scn", label, cost, months, delay: false, mathOpen: false });
  }
  function chatHtml() {
    const sc = lastScn(), s = sc && E.scenario(D, { cost: sc.cost, months: sc.months, delay: sc.delay, trim: S.trim });
    const ok = (t, s2, d) => `<div class="src"><span class="ico">${ico(d)}</span><span class="t">${t}<small>${s2}</small></span>${ico(CHECK).replace('class="ic"', 'class="ic ok"')}</div>`;
    return `<div class="wrap"><div class="ph"><div><span class="eb">Chat</span><h1 id="chatTitle">${sc ? `${esc(sc.label)} <em>in ${s.mon}</em>` : `Ask <em>anything</em>`}</h1></div>
      <div class="thr"><button type="button" class="thb on" data-act="newChat">New chat</button><button type="button" class="thb" data-act="go:spend">October leaks</button><button type="button" class="thb" data-act="go:futures">When do I hit ₹10 lakh?</button></div></div>
    <div class="chat"><div class="conv"><div id="msgs" style="display:contents">${msgs.length ? msgs.map(msgHtml).join("") : `<div id="emptyChat" class="col" style="gap:18px"><div class="lead">Ask me anything about your money.</div><div class="follow">${["Can I afford a ₹50,000 laptop in 3 months?", "Where did my money leak this month?", "How much do I save in a year?"].map((q) => `<button type="button" class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}</div></div>`}</div>
      <div class="follow"><button type="button" class="chip" data-act="go:spend">Where could I find the money?</button><button type="button" class="chip" data-act="go:futures">What does this do to my five-year picture?</button></div>
      <form class="comp" id="compose"><label class="sr" for="dx-q">Message Fathom</label><input id="dx-q" type="text" autocomplete="off" placeholder="Ask a follow-up… e.g. Can I afford a ₹50,000 laptop in 3 months?"><button class="send" id="sendBtn" type="submit" aria-label="Send">${ico(SEND, "stroke-width:2.4")}</button></form></div>
      <aside class="rcpt"><section class="cd" style="padding:26px"><span class="eb">Receipts</span><h3 class="dsp" style="margin:10px 0 6px;font-size:26px;font-weight:700;line-height:1.1">Check our working.</h3><p class="muted" style="margin:0 0 12px;font-size:14px;line-height:1.55">Every answer shows where it came from.</p>
        ${ok("Savings account", `${fmt(D.balance)} · ${D.custom ? "entered by you" : "demo balance"}`, "M3 10l9-6 9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 21h18")}${ok("Salary credits", `Saving ${fmt(D.saving)} a month`, "M3 17l6-6 4 4 8-9")}${ok("Fixed bills", `${D.bills.length} recurring payments`, "M4 6h16M4 12h16M4 18h10")}
        <div style="padding-top:18px;border-top:1px solid var(--line)"><span class="eb">Method</span><p class="say" style="font-size:14.5px;margin-top:8px">Plain arithmetic does the sums. The model explains them; it never calculates.</p></div>
        <div style="margin-top:18px;padding-top:18px;border-top:1px solid var(--line)"><div class="row"><span class="eb">Confidence</span><span class="mono" style="font-size:12px;color:var(--pos)">High</span></div><div class="conf"><i></i><i></i><i></i><i></i><i class="off"></i></div><p class="muted" style="margin:12px 0 0;font-size:13px;line-height:1.5">Six months of data. Assumes your salary and bills stay the same. Demo data.</p></div></section></aside></div></div>`;
  }
  function chatBind(root) {
    $$(".scn", root).forEach((c) => updateCard(c));
    $("#compose", root).addEventListener("submit", (e) => { e.preventDefault(); const i = $("#dx-q"); const v = i.value.trim(); if (v) { i.value = ""; ask(v); } });
  }
  function localAnswer() {
    return `Right now you have ${fmt(D.balance)} in the bank, you save about ${fmt(D.saving)} a month, and your safety line is ${fmt(D.safety)}. Ask me whether you can afford something, for example “Can I afford a ₹50,000 laptop in 3 months?”`;
  }
  async function ask(text) {
    if (busy || !text.trim()) return;
    if (page !== "chat") go("chat");
    busy = true; const sb = $("#sendBtn"); if (sb) sb.disabled = true;
    pushMsg({ type: "user", text });
    const th = pushMsg({ type: "think" });
    const history = msgs.filter((m) => m.type === "user" || m.type === "ans").slice(-7, -1).map((m) => ({ role: m.type === "user" ? "user" : "assistant", content: m.text }));
    let r;
    try { r = await api("POST", "/api/chat", { question: text, history }); }
    catch (e) { r = { error: e.status === 401 ? "Please sign in again." : e.message || "Could not reach the server." }; }
    dropMsg(th);
    if (r.kind === "scenario" && +r.cost > 0) addScenario(String(r.label || "That").slice(0, 30), Math.round(+r.cost), Math.min(24, Math.max(1, Math.round(+r.months || 5))), r.lead);
    else if (r.kind === "text" && r.text) pushMsg({ type: "ans", text: r.text });
    else {
      const p = E.parseAsk(text, D);
      if (p.cost) addScenario(p.label ? p.label[0].toUpperCase() + p.label.slice(1) : "That", p.cost, p.months || 5);
      else pushMsg({ type: "ans", text: localAnswer() });
      pushMsg({ type: "hint", text: (r.error || "No AI reply.") + " Showing built-in wording for now." });
    }
    busy = false; const sb2 = $("#sendBtn"); if (sb2) { sb2.disabled = false; $("#dx-q").focus(); }
  }

  // ---------- command palette ----------
  function palItems() {
    const q = palQ.trim().toLowerCase();
    const go2 = (p) => () => go(p);
    const askIt = (t) => () => ask(t);
    const ALL = [
      { g: "Ask", icon: CHAT, label: "Can I afford a ₹80,000 Goa trip in March?", hint: "Ask", run: askIt("Can I afford a ₹80,000 Goa trip in March?") },
      { g: "Ask", icon: CHAT, label: "Where did my money leak this month?", hint: "Ask", run: askIt("Where did my money leak this month?") },
      { g: "Ask", icon: CHAT, label: "When do I reach ₹10 lakh?", hint: "Ask", run: askIt("When do I reach ₹10 lakh?") },
      { g: "Go to", icon: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z", label: "Home", hint: "G H", run: go2("home") },
      { g: "Go to", icon: CHAT, label: "Chat", hint: "G C", run: go2("chat") },
      { g: "Go to", icon: "M5 20v-6M12 20V6M19 20v-9", label: "Spending", hint: "G S", run: go2("spend") },
      { g: "Go to", icon: "M3 17l6-6 4 4 8-9", label: "Futures", hint: "G F", run: go2("futures") },
      { g: "Go to", icon: "M4 6h16M4 12h16M4 18h16", label: "Settings (your numbers)", hint: "G E", run: go2("settings") },
      { g: "Do", icon: CHECK, label: S.trim ? `Restore the ${nUnused()} paused subscriptions` : `Pause ${nUnused()} unused subscriptions`, hint: "↵", run: toggleTrim },
      { g: "Do", icon: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9", label: "Sign out", hint: "↵", run: () => { api("POST", "/api/auth/logout", {}).catch(() => {}).then(() => { USER = null; showAuth(); }); } },
      ...THEMES.map((t) => ({ g: "Do", icon: "M12 3a9 9 0 1 0 9 9c0-1-1-1.5-2-1.5a3 3 0 0 1-3-3c0-1-.5-4.5-4-4.5z", label: "Theme: " + t.name, hint: "↵", run: () => Motion.themeReveal(innerWidth / 2, innerHeight / 3, () => setTheme(t.key)) }))
    ];
    let list = ALL.filter((x) => !q || x.label.toLowerCase().includes(q));
    if (q.length > 2 && !ALL.some((x) => x.label.toLowerCase() === q)) {
      const free = { g: "Ask", icon: CHAT, label: palQ.trim(), hint: "Ask", run: askIt(palQ.trim()) };
      if (list.length) list.push({ ...free, g: "Or ask" }); else list.push(free);
    }
    return list;
  }
  function palDraw(first) {
    palList = palItems(); palIdx = Math.min(palIdx, Math.max(0, palList.length - 1));
    let last = "";
    $("#palList").innerHTML = palList.map((x, i) => { const head = x.g !== last ? `<div class="gh eb">${x.g}</div>` : ""; last = x.g; return `<div>${head}<button type="button" role="option" aria-selected="${i === palIdx}" class="pi ${i === palIdx ? "first" : ""}${first ? " st" : ""}" style="--i:${Math.min(i, 8)}" data-pi="${i}">${ico(x.icon)}<span>${esc(x.label)}</span><span class="kbd">${x.hint}</span></button></div>`; }).join("") || `<div class="muted" style="padding:24px 14px;font-size:14.5px">Nothing matches that.</div>`;
  }
  function openPal() {
    palOpen = true; palQ = ""; palIdx = 0; palPrev = document.activeElement;
    clearTimeout(palOutT); $("#overlay").classList.remove("out");
    $("#overlay").innerHTML = `<button type="button" class="scrim" aria-label="Close" data-act="closePal"></button><div class="pal" role="dialog" aria-label="Command palette"><div class="in">${ico("M20 20l-3.5-3.5M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "color:var(--accent)")}<label class="sr" for="dx-pq">Ask or search</label><input id="dx-pq" type="text" role="combobox" aria-expanded="true" aria-controls="palList" autocomplete="off" placeholder="Ask anything, or jump to…"><span class="kbd">esc</span></div><div class="list" id="palList" role="listbox" aria-label="Results"></div><div class="ft"><span><span class="kbd">↵</span> select</span><span><span class="kbd">esc</span> close</span><span style="margin-left:auto">Fathom reads, it never moves money</span></div></div>`;
    palDraw(true);
    const pal = $(".pal"), ab = $("#openPal").getBoundingClientRect(), pr = pal.getBoundingClientRect();
    pal.style.setProperty("--ox", ab.left + ab.width / 2 - pr.left + "px"); pal.style.setProperty("--oy", ab.bottom - pr.top + "px");
    $("#dx-pq").focus();
  }
  function closePal() {
    if (!palOpen) return;
    palOpen = false;
    const ov = $("#overlay"); ov.classList.add("out");
    clearTimeout(palOutT); palOutT = setTimeout(() => { ov.innerHTML = ""; ov.classList.remove("out"); }, 180);
    if (palPrev && palPrev.isConnected && palPrev.focus) palPrev.focus();
  }
  function runPal(i) { const it = palList[i]; if (!it) return; closePal(); it.run(); }

  // ---------- router and events ----------
  function spendBind(root) {
    const f = $("#addTxForm", root);
    if (f) {
      f.addEventListener("submit", (e) => {
        e.preventDefault();
        const day = $("#txDay").value;
        const amount = Number($("#txAmt").value);
        const category = $("#txCat").value.trim() || "Other";
        const note = $("#txNote").value.trim() || category;
        addManualTx({ day, amount, category, note });
      });
    }
  }

  function settingsBind(root) {
    const pf = $("#pwForm", root);
    if (pf) {
      pf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const oldPassword = $("#pwOld").value;
        const newPassword = $("#pwNew").value;
        try {
          await api("POST", "/api/auth/change-password", { oldPassword, newPassword });
          pwOpen = false;
          toast("Password updated successfully");
          draw(false);
        } catch (err) {
          toast(err.message);
        }
      });
    }
    if (!healthInfo) {
      api("GET", "/api/health").then((h) => { healthInfo = h; draw(false); }).catch(() => {});
    }
  }

  const PAGES = {
    home: { html: homeHtml, bind: homeBind },
    chat: { html: chatHtml, bind: chatBind },
    spend: { html: spendHtml, bind: spendBind },
    futures: { html: futHtml, bind: () => { updateFut(); } },
    settings: { html: settingsHtml, bind: settingsBind }
  };
  function draw(top) {
    const el = $("#page"), st = el.scrollTop;
    el.innerHTML = PAGES[page].html(); PAGES[page].bind(el, top); el.scrollTop = top ? 0 : st; Motion.enter(el, !!top);
  }
  function route() {
    const p = location.hash.replace("#/", "") || "home", np = PAGES[p] ? p : "home";
    if (np === page) return;
    page = np; closePal();
    const tabs = TABS.map(([k, l]) => `<button type="button" class="tabb ${k === page ? "on" : ""}" data-go="${k}" ${k === page ? 'aria-current="page"' : ""}>${l}</button>`).join("");
    $("#tabs").innerHTML = tabs; $("#mobnav").innerHTML = tabs;
    if (page === "spend" && (!FORECAST || !RECURRING)) loadSpendData();
    draw(true);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-go],[data-act],[data-theme],[data-range],[data-day],[data-pi],[data-ask],[data-auth],#openPal"); if (!t) return;
    if (t.id === "openPal") return openPal();
    if (t.dataset.auth) { authMode = t.dataset.auth; return showAuth(); }
    if (t.dataset.ask) return ask(t.dataset.ask);
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.theme) return Motion.themeReveal(e.clientX || innerWidth - 120, e.clientY || 36, () => setTheme(t.dataset.theme));
    if (t.dataset.range) return homeRange(+t.dataset.range);
    if (t.dataset.day) { S.day = +t.dataset.day; persist(); return draw(false); }
    if (t.dataset.pi) return runPal(+t.dataset.pi);
    const a = t.dataset.act;
    if (a.startsWith("go:")) return go(a.slice(3));
    if (a === "closePal") return closePal();
    if (a.startsWith("motion:")) { Motion.set("mode", a.slice(7)); return draw(false); }
    if (a === "newChat") { msgs = []; persistChat(); return draw(false); }
    if (a === "resetData") {
      api("DELETE", "/api/profile").then((r) => { D = loadProfile(r.profile, false); S.sav = D.saving; persist(); toast("Back to the demo numbers"); draw(false); }).catch((x) => toast(x.message));
      return;
    }
    if (a === "signout") { api("POST", "/api/auth/logout", {}).catch(() => {}).then(() => { USER = null; showAuth(); }); return; }
    if (a === "signoutAll") { api("POST", "/api/auth/logout-all", {}).catch(() => {}).then(() => { USER = null; showAuth("Signed out of all devices."); }); return; }
    if (a === "exportUser") return exportUserData();
    if (a === "togglePw") { pwOpen = !pwOpen; return draw(false); }
    if (a === "toggleAddTx") { addTxOpen = !addTxOpen; return draw(false); }
    if (a.startsWith("delSingleTx:")) { const id = Number(a.split(":")[1]); return deleteSingleTx(id); }
    if (a === "delTx") {
      api("DELETE", "/api/transactions").then(() => {
        SUM = { real: false };
        FORECAST = null;
        RECURRING = null;
        TX_LIST = { rows: [], total: 0 };
        toast("Transactions deleted");
        draw(false);
      }).catch((x) => toast(x.message));
      return;
    }
    if (a === "delAccount") { delOpen = !delOpen; return draw(false); }
    if (a === "delAccountGo") {
      api("POST", "/api/account/delete", { password: $("#delPw").value }).then(() => { USER = null; delOpen = false; showAuth("Your account and data were deleted."); }).catch((x) => toast(x.message));
      return;
    }
    if (a.startsWith("add:")) {
      const k = a.slice(4);
      D[k].push({ subs: { name: "New subscription", amt: 0 }, bills: { when: "1st", name: "New bill", sub: "", amt: 0 }, goals: { name: "New goal", have: 0, need: 10000 } }[k]);
      finalize(D); persistData(); return draw(false);
    }
    if (a.startsWith("del:")) { const [, k, i] = a.split(":"); D[k].splice(+i, 1); finalize(D); persistData(); return draw(false); }
    if (a === "trim") return toggleTrim();
    if (a === "g1") { S.g1 = !S.g1; persist(); if (S.g1) Motion.chime(); toast(S.g1 ? `Guardrail set at ${fmt(guardAmt())} a month` : "Guardrail removed"); return draw(false); }
    const card = t.closest(".scn"), m = card && msgs.find((x) => x.id === +card.dataset.i);
    if (a === "delay" && m) { m.delay = !m.delay; updateCard(card); persistChat(); }
    if (a === "math" && m) { m.mathOpen = !m.mathOpen; updateCard(card); persistChat(); }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "dx-pq") { palQ = t.value; palIdx = 0; return palDraw(); }
    if (t.id === "txSearch") {
      clearTimeout(saveT["txSearch"]);
      saveT["txSearch"] = setTimeout(async () => {
        txQ = t.value.trim();
        const r = await api("GET", "/api/transactions?limit=50&q=" + encodeURIComponent(txQ)).catch(() => null);
        if (r) {
          TX_LIST = r;
          const box = $("#page .tx-list");
          if (box) {
            box.innerHTML = r.rows.length ? r.rows.map((txItem) => `
              <div class="tx-row">
                <span class="tx-date">${esc(txItem.day)}</span>
                <div class="tx-info">
                  <div class="tx-note">${esc(txItem.note || txItem.category)}</div>
                  <span class="tx-cat">${esc(txItem.category)}</span>
                </div>
                <div class="tx-amt">${fmt(txItem.amount)}</div>
                <button type="button" class="tx-del" data-act="delSingleTx:${txItem.id}" aria-label="Delete transaction" title="Delete transaction">${ico("M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v3M4 7h16")}</button>
              </div>
            `).join("") : `<div class="muted say" style="padding:24px 0">No transactions match your search.</div>`;
          }
        }
      }, 250);
      return;
    }
    const k = t.dataset && t.dataset.slider; if (!k) return;
    if (k === "cost") { const card = t.closest(".scn"), m = msgs.find((x) => x.id === +card.dataset.i); m.cost = +t.value; const st = Math.floor(m.cost / 5000); if (st !== m._st) { m._st = st; Motion.tick(); } later("c" + m.id, () => updateCard(card)); persistChat(); }
    else if (k === "sav") { S.sav = +t.value; persist(); const st = Math.floor(S.sav / 2500); if (st !== sStep) { sStep = st; Motion.tick(); } later("sav", updateFut); }
    else if (k === "t") { futT = +t.value; later("t", () => { updateFut(); Motion.trail($("[data-k=mk] circle")); }); }
  });
  // Settings fields: write straight into the data, no redraw so typing keeps focus.
  document.addEventListener("change", (e) => {
    const t = e.target, p = t.dataset && t.dataset.set;
    if (t.id === "csvFile") return importFile(t.files && t.files[0]);
    if (t.dataset && t.dataset.motion === "sound") { Motion.set("sound", t.checked); if (t.checked) Motion.chime(); return; }
    if (!p) return;
    let v = t.dataset.type === "bool" ? t.checked : t.type === "number" ? Number(t.value) : t.value.trim();
    if (t.type === "number") { if (!isFinite(v) || v < 0) return draw(false); v *= Number(t.dataset.scale || 1); }
    const parts = p.split("."), last = parts.pop(); let o = D;
    for (const k of parts) o = o[k];
    o[last] = v;
    if (p === "saving") { S.sav = v; persist(); }
    finalize(D); persistData();
  });
  let gFlag = 0;
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA/.test((e.target || {}).tagName || "");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); return palOpen ? closePal() : openPal(); }
    if (palOpen) {
      if (e.key === "Tab") e.preventDefault();
      else if (e.key === "Escape") closePal();
      else if (e.key === "ArrowDown") { e.preventDefault(); palIdx = Math.min(palIdx + 1, palList.length - 1); palDraw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); palIdx = Math.max(palIdx - 1, 0); palDraw(); }
      else if (e.key === "Enter") { e.preventDefault(); runPal(palIdx); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "g") { gFlag = Date.now(); return; }
    if (Date.now() - gFlag < 1000) { const p = { h: "home", c: "chat", s: "spend", f: "futures", e: "settings" }[e.key]; gFlag = 0; if (p) go(p); }
  });
  window.addEventListener("hashchange", route);

  // ---------- boot ----------
  function loadChat(chat) {
    if (Array.isArray(chat)) { msgs = chat.filter((m) => m && m.type && m.type !== "think"); mid = msgs.reduce((a, m) => Math.max(a, m.id || 0), 0); return; }
    msgs = []; mid = 0; // first visit: start with the Goa example
    pushMsg({ type: "user", text: "Can I afford a ₹80,000 Goa trip in 5 months?" });
    addScenario("Goa", 80000, 5);
  }
  async function importFile(file) {
    if (!file) return;
    if (file.size > 1800000) return toast("That file is too large (about 1.8 MB at most).");
    try {
      const r = await api("POST", "/api/transactions/import", { csv: await file.text() });
      SUM = r.summary;
      await loadSpendData();
      toast(`Imported ${r.imported} spending rows${r.skipped ? `, skipped ${r.skipped}` : ""}`);
      draw(false);
    } catch (e) { toast(e.message); }
  }

  // ---------- sign in ----------
  const authHtml = (mode, msg) => `<div class="auth-card">
    <div class="brand"><span class="logo">f</span>Fathom</div>
    <h1>${mode === "signup" ? "Make it <em>yours</em>" : "Welcome <em>back</em>"}</h1>
    <p class="muted" style="margin:0 0 20px">${mode === "signup" ? "Create an account to keep your numbers, chats and imported spending." : "Sign in to see your numbers."}</p>
    <div class="rng" role="group" aria-label="Sign in or create an account" style="margin-bottom:18px"><button type="button" class="rb ${mode === "login" ? "on" : ""}" data-auth="login" aria-pressed="${mode === "login"}">Sign in</button><button type="button" class="rb ${mode === "signup" ? "on" : ""}" data-auth="signup" aria-pressed="${mode === "signup"}">Create account</button></div>
    <form id="authForm" novalidate>
      ${mode === "signup" ? `<label class="fld"><span class="eb">Name</span><input class="inp" id="au-name" autocomplete="name" maxlength="60"></label>` : ""}
      <label class="fld"><span class="eb">Email</span><input class="inp" id="au-email" type="email" autocomplete="username" maxlength="254"></label>
      <label class="fld"><span class="eb">Password</span><input class="inp" id="au-pw" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" maxlength="200"></label>
      <p class="auth-err" id="au-err" role="alert">${esc(msg || "")}</p>
      <button class="btn" type="submit" id="au-go" style="justify-content:center">${mode === "signup" ? "Create account" : "Sign in"}</button>
    </form></div>`;
  function showAuth(msg) {
    page = ""; closePal();
    $("#dx-root").classList.add("locked");
    const el = $("#auth"); el.hidden = false; el.innerHTML = authHtml(authMode, msg);
    $("#authForm").addEventListener("submit", onAuth);
    (authMode === "signup" ? $("#au-name") : $("#au-email")).focus();
  }
  async function onAuth(e) {
    e.preventDefault();
    const body = { email: $("#au-email").value, password: $("#au-pw").value };
    if (authMode === "signup") body.name = $("#au-name").value;
    const btn = $("#au-go"); btn.disabled = true;
    try {
      await api("POST", authMode === "signup" ? "/api/auth/signup" : "/api/auth/login", body);
      startSession(await api("GET", "/api/session"));
    } catch (x) { $("#au-err").textContent = x.message; btn.disabled = false; }
  }
  function startSession(s) {
    USER = s.user; Object.assign(S, s.prefs);
    D = loadProfile(s.profile, s.custom); if (S.sav == null) S.sav = D.saving;
    SUM = null; FORECAST = null; RECURRING = null; TX_LIST = { rows: [], total: 0 };
    page = ""; lastLeak = undefined; futT = 24; delOpen = false; pwOpen = false; addTxOpen = false;
    setTheme(S.theme); loadChat(s.chat);
    $("#avatar").textContent = (USER.name || "?").trim()[0].toUpperCase();
    $("#dx-root").classList.remove("locked"); $("#auth").hidden = true; $("#auth").innerHTML = "";
    api("GET", "/api/transactions/summary").then((r) => { SUM = r; if (page === "spend" || page === "home") draw(false); }).catch(() => {});
    loadSpendData();
    api("GET", "/api/health").then((h) => { healthInfo = h; }).catch(() => {});
    route();
  }

  setTheme(S.theme);
  api("GET", "/api/session").then(startSession).catch((e) => {
    if (e.status === 401) showAuth();
    else $("#page").innerHTML = `<div class="wrap"><p class="say" style="padding:80px 0">Could not reach the Fathom server. Start it with <code>npm start</code>.</p></div>`;
  });
})();

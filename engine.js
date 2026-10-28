// Pure money maths: no DOM, runs in the browser and in Node. The model never does these sums.
(function (root) {
  const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MFULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const fmt = (n) => (n < 0 ? "−" : "") + "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
  const parseDay = (s) => { const p = String(s).split("-").map(Number); return new Date(p[0], p[1] - 1, p[2] || 1); };
  const monthAt = (d, m) => { const t = parseDay(d.today); return new Date(t.getFullYear(), t.getMonth() + m, 1); };
  // "80,000", "80k", "1.2 lakh", "₹2cr" or a plain number -> rupees (NaN if unreadable).
  function parseAmount(v) {
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    const m = String(v).replace(/,/g, "").toLowerCase().match(/(\d+(?:\.\d+)?)\s*(k|lakh|lac|l|crore|cr)?/);
    if (!m) return NaN;
    const u = m[2];
    return parseFloat(m[1]) * (u === "k" ? 1e3 : u === "lakh" || u === "lac" || u === "l" ? 1e5 : u === "crore" || u === "cr" ? 1e7 : 1);
  }

  // Can I afford `cost` after `months` of saving? `delay` pushes it a month, `trim` adds paused-subscription savings.
  function scenario(d, o) {
    const cost = o.cost, trim = !!o.trim, delay = !!o.delay;
    const tm = (o.months || 5) + (delay ? 1 : 0);
    const sv = d.saving + (trim ? d.trimGain : 0);
    const bal = (m) => d.balance + sv * m;
    const after = bal(tm) - cost;
    const verdict = after >= 2 * d.safety ? "calm" : after >= d.safety ? "steady" : "stretched";
    const cover = Math.max(0, after / d.safety).toFixed(1);
    const mon = MFULL[monthAt(d, tm).getMonth()];
    let say;
    if (verdict === "calm") say = `You’d land in ${mon} with ${fmt(after)} still in the bank, about ${cover} months of everyday cover.`;
    else if (verdict === "steady") say = `It works, but only just. You’d land in ${mon} with ${fmt(after)}, about ${cover} months of cover.`;
    else if (after >= 0) say = `That leaves ${fmt(after)} in ${mon}, under a month of cover. Try a later date or a smaller number.`;
    else say = `That’s ${fmt(-after)} more than you’d have by ${mon}. Move the date or bring the number down.`;
    const H = Math.max(7, tm + 2);
    const withSpend = [], without = [];
    for (let m = 0; m <= H; m++) { without.push(bal(m)); withSpend.push(m < tm ? bal(m) : bal(m) - cost); }
    const labels = [];
    for (let m = 0; m <= H; m++) labels.push(m === 0 ? "Now" : MN[monthAt(d, m).getMonth()]);
    return {
      cost, tm, sv, after, verdict, cover, mon, say, H, withSpend, without, labels,
      math: [
        { label: "In the bank today", sub: "", val: fmt(d.balance) },
        { label: "Saved by " + mon, sub: `${tm} months × ${fmt(sv)}`, val: "+" + fmt(sv * tm) },
        { label: "The spend", sub: "your number", val: "−" + fmt(cost) },
        { label: "Left in " + mon, sub: "safety line is " + fmt(d.safety), val: fmt(after), sum: true }
      ]
    };
  }

  // Net worth after m months, saving s a month, compounding monthly.
  function project(d, m, s) {
    const g = d.growth / 12;
    if (!g) return d.netWorth + s * m;
    return d.netWorth * Math.pow(1 + g, m) + (s * (Math.pow(1 + g, m) - 1)) / g;
  }
  function monthsToReach(d, target, s, cap) {
    for (let m = 0; m <= (cap || 60); m++) if (project(d, m, s) >= target) return m;
    return -1;
  }
  const whenLabel = (d, m) => { const t = monthAt(d, m); return MN[t.getMonth()] + " " + t.getFullYear(); };

  // Smooth-ish net-worth history ending at today's value (deterministic, so charts are stable).
  function netWorthSeries(d, rIdx, n) {
    n = n || 40;
    const R = d.ranges[rIdx], ys = [];
    for (let i = 0; i < n; i++) {
      const p = i / (n - 1), e = p * p * (3 - 2 * p);
      const wob = R.amp * (Math.sin(i * 1.3 + rIdx) * 0.6 + Math.sin(i * 0.37 + 1) * 0.4) * Math.sqrt(1 - p);
      ys.push(R.start + (d.netWorth - R.start) * (0.35 * p + 0.65 * e) + wob);
    }
    ys[n - 1] = d.netWorth;
    return ys;
  }

  // Sample daily spend for the heatmap (a pattern, not transactions). dow: Mon=0 .. Sun=6.
  const daySpend = (day, dow) => {
    if (dow === undefined) dow = (day + 2) % 7;
    return 520 + ((day * 37) % 11) * 190 + (dow >= 5 ? 1600 : 0) + (day === 17 ? 1900 : 0) + (day === 9 ? 2600 : 0);
  };
  const heatLevel = (v, max) => { const r = v / max; return r < 0.2 ? "" : r < 0.4 ? "l1" : r < 0.6 ? "l2" : r < 0.82 ? "l3" : "l4"; };

  // Pull a rupee amount and "in N months / in <month>" out of free text (used when no model is available).
  function parseAsk(text, d) {
    const t = text.replace(/,/g, "");
    let cost = null;
    const m1 = t.match(/(?:₹|rs\.?\s*|inr\s*)\s*(\d+(?:\.\d+)?)(?:\s*(k|lakh|lac|l)\b)?/i) || t.match(/(\d+(?:\.\d+)?)\s*(k|l|lakh|lac)\b/i);
    if (m1) cost = Math.round(parseAmount(m1[1] + (m1[2] || "")));
    let months = null;
    const m2 = t.match(/in\s+(\d+)\s+month/i);
    if (m2) months = +m2[1];
    else for (let i = 0; i < 12 && months === null; i++) if (new RegExp("\\b" + MFULL[i] + "\\b", "i").test(t)) {
      const cur = parseDay(d.today).getMonth(); months = ((i - cur + 12) % 12) || 12;
    }
    const noNums = t.replace(/(?:₹|rs\.?\s*|inr\s*)?\s*\d+(?:\.\d+)?\s*(?:k|lakh|lac|l)?\b/gi, " ");
    const lab = noNums.match(/\b(?:a|an|my|the)\s+([a-z ]{3,24}?)(?:\s+(?:in|for|by|next)\b|[?.!]|$)/i);
    return { cost, months, label: lab ? lab[1].trim() : null };
  }

  const api = { parseAmount, parseDay, fmt, scenario, project, monthsToReach, whenLabel, netWorthSeries, daySpend, heatLevel, parseAsk, monthAt, MN, MFULL, DOW };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.Engine = api;
})(typeof self !== "undefined" ? self : this);

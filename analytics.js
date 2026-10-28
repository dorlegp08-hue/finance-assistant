// Spending summary from a user's real transactions. Same idea as the sample pattern, computed on the server.
function summarize(rows, todayStr) {
  if (!rows.length) return { real: false };
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const ym = (r) => r.day.slice(0, 7);
  const todayYm = `${ty}-${String(tm).padStart(2, "0")}`;
  // Show the current month if it has data, otherwise the latest month that does.
  const months = [...new Set(rows.map(ym))].filter((m) => m <= todayYm).sort();
  if (!months.length) return { real: false };
  const cur = months.includes(todayYm) ? todayYm : months[months.length - 1];
  const [y, m] = cur.split("-").map(Number);
  const dim = new Date(y, m, 0).getDate();
  const upTo = cur === todayYm ? Math.min(td, dim) : dim;
  const daily = new Array(upTo + 1).fill(0);
  const catNow = {}, catPrior = {};
  const priorMonths = months.filter((x) => x < cur).slice(-3);
  let total = 0;
  for (const r of rows) {
    const k = ym(r);
    if (k === cur) {
      const d = +r.day.slice(8, 10);
      if (d <= upTo) { daily[d] += r.amount; total += r.amount; catNow[r.category] = (catNow[r.category] || 0) + r.amount; }
    } else if (priorMonths.includes(k)) catPrior[r.category] = (catPrior[r.category] || 0) + r.amount;
  }
  const categories = Object.entries(catNow).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, amt]) => {
    const usual = priorMonths.length ? (catPrior[name] || 0) / priorMonths.length : 0;
    const pct = usual > 0 ? Math.round((amt / usual - 1) * 100) : null;
    const delta = pct == null ? "no earlier months to compare" : pct >= 0 ? `+${pct}% vs your usual` : `${pct}% vs your usual`;
    const plug = Math.round((usual > 0 ? Math.max(0, amt - usual) : amt * 0.2) / 100) * 100;
    return { name, amt: Math.round(amt), delta, plug };
  });
  return { real: true, y, m: m - 1, upTo, total: Math.round(total), daily: daily.map((v) => Math.round(v)), categories, count: rows.length };
}

module.exports = { summarize };

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

// Detect recurring transactions from historical rows
function detectRecurring(rows) {
  if (!rows || rows.length < 2) return [];
  const groups = new Map();
  for (const r of rows) {
    const noteClean = String(r.note || "").toLowerCase().replace(/[^a-z]/g, " ").trim().slice(0, 30);
    const key = (r.category + "::" + (noteClean || "unknown")).slice(0, 50);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const recurring = [];
  for (const [, items] of groups) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.day.localeCompare(b.day));
    const intervals = [];
    for (let i = 1; i < items.length; i++) {
      const d1 = new Date(items[i - 1].day), d2 = new Date(items[i].day);
      const diffDays = Math.round((d2 - d1) / (1000 * 3600 * 24));
      intervals.push(diffDays);
    }
    const isMonthly = intervals.some((days) => days >= 26 && days <= 34);
    const avgAmt = Math.round(items.reduce((s, x) => s + x.amount, 0) / items.length);
    if (isMonthly || items.length >= 3) {
      recurring.push({
        merchant: items[0].note || items[0].category,
        category: items[0].category,
        estimatedAmount: avgAmt,
        cadence: isMonthly ? "monthly" : "frequent",
        occurrences: items.length,
        lastDate: items[items.length - 1].day
      });
    }
  }
  return recurring.sort((a, b) => b.estimatedAmount - a.estimatedAmount);
}

// 30-day cash flow forecast
function forecastCashFlow(profile, summary, todayStr) {
  const [ty, tm, td] = (todayStr || "2026-10-28").split("-").map(Number);
  const startBalance = Number(profile.balance) || 0;
  const safety = Number(profile.safety) || 0;
  
  let dailyBurn = 0;
  if (summary && summary.real && summary.upTo > 0 && summary.total > 0) {
    dailyBurn = summary.total / summary.upTo;
  } else {
    dailyBurn = Math.max(200, (Number(profile.saving) || 10000) / 30);
  }

  const days = [];
  let currentBal = startBalance;
  const now = new Date(ty, tm - 1, td || 1);

  for (let i = 1; i <= 30; i++) {
    const futureDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const fDay = futureDate.getDate();
    const fStr = `${futureDate.getFullYear()}-${String(futureDate.getMonth() + 1).padStart(2, "0")}-${String(fDay).padStart(2, "0")}`;
    
    currentBal -= dailyBurn;
    
    const dueBills = (profile.bills || []).filter((b) => {
      const whenDay = parseInt(b.when, 10);
      return !isNaN(whenDay) && whenDay === fDay;
    });
    const billsTotal = dueBills.reduce((s, b) => s + (Number(b.amt) || 0), 0);
    currentBal -= billsTotal;

    days.push({
      day: fStr,
      projectedBalance: Math.round(currentBal),
      dailyBurn: Math.round(dailyBurn),
      scheduledBills: billsTotal,
      belowSafety: currentBal < safety
    });
  }

  const minBalance = Math.min(...days.map((d) => d.projectedBalance));
  return {
    startBalance: Math.round(startBalance),
    projectedEndBalance: Math.round(currentBal),
    minProjectedBalance: Math.round(minBalance),
    dailyBurnRate: Math.round(dailyBurn),
    breachesSafety: minBalance < safety,
    days
  };
}

module.exports = { summarize, detectRecurring, forecastCashFlow };


// Bank statement CSV -> spending rows. Accepts: date, description, amount [, category] (header optional),
// or separate debit/credit columns. Negative amounts (or the debit column) are spending; income is ignored.
const MAX_ROWS = 5000;
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  text = String(text).replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === ";" || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function parseDate(s) {
  s = String(s || "").trim();
  let y, m, d, t;
  if ((t = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) { y = +t[1]; m = +t[2]; d = +t[3]; }
  else if ((t = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { d = +t[1]; m = +t[2]; y = +t[3]; if (y < 100) y += 2000; }
  else if ((t = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-,]*(\d{2,4})/))) { d = +t[1]; m = MON.indexOf(t[2].toLowerCase()) + 1; y = +t[3]; if (y < 100) y += 2000; }
  else return null;
  const dt = new Date(y, m - 1, d);
  if (m < 1 || dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parseMoney(s) {
  if (s == null) return null;
  let t = String(s).trim(); if (!t) return null;
  let neg = /^\(.*\)$/.test(t) || /dr\b/i.test(t) || t.startsWith("-");
  t = t.replace(/[₹,\s()]|rs\.?|inr|dr|cr|^-|^\+/gi, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = parseFloat(t);
  return neg ? -v : v;
}

const CATS = [
  ["Food delivery", /swiggy|zomato|food|restaurant|cafe|dominos|pizza|eats/i],
  ["Cabs", /uber|ola\b|cab|rapido|taxi|metro/i],
  ["Impulse shopping", /amazon|flipkart|myntra|ajio|shop|mall|store|nykaa/i],
  ["Subscriptions", /netflix|spotify|prime|hotstar|subscription|youtube|icloud|membership|gym/i],
  ["Rent", /rent|landlord/i],
  ["Bills", /electric|water|gas|broadband|airtel|jio|recharge|insurance|bill|emi/i],
  ["Groceries", /grocer|bigbasket|blinkit|zepto|dmart|market|supermarket/i]
];
const guessCategory = (note) => { for (const [c, re] of CATS) if (re.test(note)) return c; return "Other"; };

function importCsv(text) {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], skipped: 0, error: "The file is empty." };
  const head = all[0].map((h) => h.trim().toLowerCase());
  const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const hasHeader = find("date", "day") >= 0 || find("amount", "debit", "withdrawal") >= 0;
  const idx = hasHeader
    ? { date: find("date", "day"), desc: find("description", "narration", "details", "merchant", "note", "particulars"), amt: find("amount"), debit: find("debit", "withdrawal"), credit: find("credit", "deposit"), cat: find("category") }
    : { date: 0, desc: 1, amt: 2, debit: -1, credit: -1, cat: 3 };
  if (idx.date < 0 || (idx.amt < 0 && idx.debit < 0)) return { rows: [], skipped: 0, error: "Could not find date and amount columns." };
  const body = (hasHeader ? all.slice(1) : all).slice(0, MAX_ROWS);
  const raw = [];
  let skipped = 0;
  for (const r of body) {
    const day = parseDate(r[idx.date]);
    let amt = null;
    if (idx.debit >= 0) { const d = parseMoney(r[idx.debit]); if (d) amt = -Math.abs(d); }
    if (amt == null && idx.amt >= 0) amt = parseMoney(r[idx.amt]);
    if (!day || amt == null) { skipped++; continue; }
    const note = String(idx.desc >= 0 ? r[idx.desc] || "" : "").trim().slice(0, 80);
    const cat = idx.cat >= 0 && r[idx.cat] && r[idx.cat].trim() ? r[idx.cat].trim().slice(0, 40) : guessCategory(note);
    raw.push({ day, amt, note, cat });
  }
  // Single amount column: negatives are spending. If nothing is negative, every row is spending.
  const anyNeg = raw.some((x) => x.amt < 0);
  const rows = raw.filter((x) => (anyNeg ? x.amt < 0 : x.amt > 0)).map((x) => ({ day: x.day, amount: Math.abs(x.amt), category: x.cat, note: x.note }));
  return { rows, skipped: skipped + (raw.length - rows.length) };
}

module.exports = { parseCsv, parseDate, parseMoney, guessCategory, importCsv };

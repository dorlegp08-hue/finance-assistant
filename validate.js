// Everything the browser sends is checked and trimmed to a known shape before it is stored.
const { HttpError } = require("./auth.js");

const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === "object") : []);

function cleanProfile(p, base) {
  if (!p || typeof p !== "object") throw new HttpError(400, "Invalid profile.");
  return {
    balance: num(p.balance, 0, 1e10, base.balance),
    safety: num(p.safety, 0, 1e10, base.safety),
    saving: num(p.saving, 0, 1e10, base.saving),
    netWorth: num(p.netWorth, 0, 1e11, base.netWorth),
    runway: num(p.runway, 0, 600, base.runway),
    growth: num(p.growth, 0, 1, base.growth),
    ranges: base.ranges,
    leaks: arr(p.leaks, 12).map((l) => ({ name: str(l.name, 40), amt: num(l.amt, 0, 1e9, 0), delta: str(l.delta, 60), plug: num(l.plug, 0, 1e9, 0) })),
    subs: arr(p.subs, 60).map((s) => ({ glyph: str(s.glyph, 2) || undefined, name: str(s.name, 60), amt: num(s.amt, 0, 1e9, 0), unused: !!s.unused })),
    bills: arr(p.bills, 60).map((b) => ({ when: str(b.when, 12), name: str(b.name, 60), sub: str(b.sub, 60), amt: num(b.amt, 0, 1e9, 0) })),
    goals: arr(p.goals, 40).map((g) => ({ name: str(g.name, 60), have: num(g.have, 0, 1e10, 0), need: num(g.need, 0, 1e10, 1), unit: str(g.unit, 12) || undefined }))
  };
}

const THEMES = ["pine", "cobalt", "graphite"];
function cleanPrefs(p) {
  p = p && typeof p === "object" ? p : {};
  return {
    theme: THEMES.includes(p.theme) ? p.theme : "pine",
    trim: !!p.trim, g1: !!p.g1,
    rng: Math.round(num(p.rng, 0, 3, 1)),
    day: Math.round(num(p.day, 1, 31, 17)),
    sav: p.sav == null ? null : num(p.sav, 0, 1e10, null)
  };
}

const TYPES = ["user", "lead", "scn", "hint", "ans"];
function cleanChat(c) {
  if (!Array.isArray(c)) throw new HttpError(400, "Invalid chat.");
  return c.slice(-60).filter((m) => m && TYPES.includes(m.type)).map((m) => ({
    id: Math.round(num(m.id, 0, 1e9, 0)), type: m.type,
    text: m.text == null ? undefined : str(m.text, 1500),
    err: m.err ? true : undefined,
    label: m.label == null ? undefined : str(m.label, 30),
    cost: m.cost == null ? undefined : num(m.cost, 0, 1e10, 0),
    months: m.months == null ? undefined : Math.round(num(m.months, 1, 24, 5)),
    delay: m.delay ? true : undefined, mathOpen: m.mathOpen ? true : undefined, seen: m.seen ? true : undefined
  }));
}

module.exports = { cleanProfile, cleanPrefs, cleanChat };

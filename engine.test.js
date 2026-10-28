const assert = require("assert");
const E = require("./engine.js");
const d = { ...require("./data.json"), today: "2026-10-27" };

// Amount parsing used for model replies and typed questions
assert.strictEqual(E.parseAmount("₹80,000"), 80000);
assert.strictEqual(E.parseAmount("80k"), 80000);
assert.strictEqual(E.parseAmount("1.2 lakh"), 120000);
assert.strictEqual(E.parseAmount(55000), 55000);
assert.ok(Number.isNaN(E.parseAmount("soon")));
assert.strictEqual(E.parseDay("2026-10-27").getMonth(), 9);

// Weekends cost more than weekdays in the sample pattern
assert.ok(E.daySpend(10, 5) > E.daySpend(10, 2));

// Design default: ₹80,000 in March (5 months ahead)
let s = E.scenario(d, { cost: 80000, months: 5 });
assert.strictEqual(s.after, 142000 + 18500 * 5 - 80000);
assert.strictEqual(s.after, 154500);
assert.strictEqual(s.verdict, "calm");
assert.strictEqual(s.mon, "March");

// Delay lever: April, one more month saved
s = E.scenario(d, { cost: 80000, months: 5, delay: true });
assert.strictEqual(s.mon, "April");
assert.strictEqual(s.after, 142000 + 18500 * 6 - 80000);

// Trim lever adds the subscription savings
s = E.scenario(d, { cost: 80000, months: 5, trim: true });
assert.strictEqual(s.sv, 19900);

// Verdict boundaries and a stretched case
assert.strictEqual(E.scenario(d, { cost: 200000, months: 5 }).verdict, "stretched");
assert.strictEqual(E.scenario(d, { cost: 142000 + 92500 - 38000, months: 5 }).verdict, "steady");
assert.ok(E.scenario(d, { cost: 300000, months: 5 }).say.includes("more than you’d have"));

// Projection: month 0 equals today's net worth; more saving means more wealth
assert.strictEqual(Math.round(E.project(d, 0, 18500)), d.netWorth);
assert.ok(E.project(d, 24, 30000) > E.project(d, 24, 18500));
assert.ok(E.monthsToReach(d, 1000000, 18500) > 0);

// Zero growth must not divide by zero
assert.strictEqual(E.project({ ...d, growth: 0 }, 10, 1000), d.netWorth + 10000);

// Series ends on today's value
const ys = E.netWorthSeries(d, 1);
assert.strictEqual(ys[ys.length - 1], d.netWorth);

// Free-text parsing
let p = E.parseAsk("Can I afford a ₹80,000 Goa trip in March?", d);
assert.strictEqual(p.cost, 80000);
assert.strictEqual(p.months, 5);
p = E.parseAsk("Can I buy a laptop for 1.2 lakh in 3 months?", d);
assert.strictEqual(p.cost, 120000);
assert.strictEqual(p.months, 3);
assert.strictEqual(p.label, "laptop");
p = E.parseAsk("Can I afford a ₹50,000 laptop in 3 months?", d);
assert.strictEqual(p.cost, 50000, "the l in laptop is not a lakh");
assert.strictEqual(p.label, "laptop");
assert.strictEqual(p.months, 3);
assert.strictEqual(E.parseAsk("How am I doing?", d).cost, null);

console.log("engine tests passed");

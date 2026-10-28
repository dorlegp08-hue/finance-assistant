const assert = require("assert");
const AI = require("./ai.js");
const Analytics = require("./analytics.js");
const Validate = require("./validate.js");
const CSV = require("./csv.js");
const demoData = require("./data.json");

// ==========================================
// 1. AI MODULE (ai.js)
// ==========================================
console.log("Testing ai.js...");

// Normalize scenario responses
const sc1 = AI.normalize({ kind: "scenario", cost: "50,000", months: 4, label: "MacBook Air", lead: "Fits well" });
assert.strictEqual(sc1.kind, "scenario");
assert.strictEqual(sc1.cost, 50000);
assert.strictEqual(sc1.months, 4);
assert.strictEqual(sc1.label, "MacBook Air");
assert.strictEqual(sc1.lead, "Fits well");

// Normalize months boundary clamping (1 to 24)
const sc2 = AI.normalize({ kind: "scenario", cost: 20000, months: 99 });
assert.strictEqual(sc2.months, 24);
const sc3 = AI.normalize({ kind: "scenario", cost: 20000, months: -5 });
assert.strictEqual(sc3.months, 1);

// Normalize text replies
const txt1 = AI.normalize({ kind: "text", text: "You have ₹1,42,000 in your account." });
assert.strictEqual(txt1.kind, "text");
assert.strictEqual(txt1.text, "You have ₹1,42,000 in your account.");

// Normalize fallback from raw string
const rawFallback = AI.normalize(null, "Just a plain message from model");
assert.strictEqual(rawFallback.kind, "text");
assert.strictEqual(rawFallback.text, "Just a plain message from model");

// Local Fallback offline questions
const fbScenario = AI.localFallback("Can I afford a ₹60,000 laptop in 4 months?", demoData);
assert.strictEqual(fbScenario.kind, "scenario");
assert.strictEqual(fbScenario.cost, 60000);
assert.strictEqual(fbScenario.months, 4);

const fbBal = AI.localFallback("What is my current balance?", demoData);
assert.strictEqual(fbBal.kind, "text");
assert.ok(fbBal.text.includes("1,42,000"));

const fbSave = AI.localFallback("How much do I save each month?", demoData);
assert.strictEqual(fbSave.kind, "text");
assert.ok(fbSave.text.includes("18,500"));

const fbNetWorth = AI.localFallback("Tell me my net worth", demoData);
assert.strictEqual(fbNetWorth.kind, "text");
assert.ok(fbNetWorth.text.includes("6,42,300"));

// System prompt fact extraction
const prompt = AI.systemPrompt({}, demoData, { real: true, categories: [{ name: "Dining", amt: 5000 }] });
assert.ok(prompt.includes("142000"));
assert.ok(prompt.includes("Dining"));
console.log("✓ ai.js passed");

// ==========================================
// 2. ANALYTICS MODULE (analytics.js)
// ==========================================
console.log("Testing analytics.js...");

const mockTransactions = [
  // Monthly recurring bill (every ~30 days)
  { day: "2026-08-01", amount: 649, category: "Entertainment", note: "Netflix Subscription" },
  { day: "2026-09-01", amount: 649, category: "Entertainment", note: "Netflix Subscription" },
  { day: "2026-10-01", amount: 649, category: "Entertainment", note: "Netflix Subscription" },
  // Frequent coffee/food purchases
  { day: "2026-10-02", amount: 250, category: "Dining", note: "Blue Tokai Coffee" },
  { day: "2026-10-05", amount: 270, category: "Dining", note: "Blue Tokai Coffee" },
  { day: "2026-10-08", amount: 260, category: "Dining", note: "Blue Tokai Coffee" },
  // One-off purchase
  { day: "2026-10-12", amount: 15000, category: "Shopping", note: "New Monitor" }
];

// detectRecurring
const recurring = Analytics.detectRecurring(mockTransactions);
assert.ok(Array.isArray(recurring));
assert.strictEqual(recurring.length, 2);

const netflixRec = recurring.find((r) => r.merchant.includes("Netflix"));
assert.ok(netflixRec);
assert.strictEqual(netflixRec.cadence, "monthly");
assert.strictEqual(netflixRec.estimatedAmount, 649);
assert.strictEqual(netflixRec.occurrences, 3);

const coffeeRec = recurring.find((r) => r.merchant.includes("Blue Tokai"));
assert.ok(coffeeRec);
assert.strictEqual(coffeeRec.estimatedAmount, 260);

// summarize
const summary = Analytics.summarize(mockTransactions, "2026-10-15");
assert.strictEqual(summary.real, true);
assert.strictEqual(summary.y, 2026);
assert.strictEqual(summary.m, 9); // October (0-indexed)
assert.strictEqual(summary.upTo, 15);
assert.ok(summary.categories.length > 0);
assert.strictEqual(summary.categories[0].name, "Shopping"); // 15000 is highest in October

// forecastCashFlow
const forecast = Analytics.forecastCashFlow(
  {
    balance: 50000,
    safety: 30000,
    saving: 15000,
    bills: [{ when: "5th", name: "Rent", amt: 25000 }]
  },
  summary,
  "2026-10-01"
);

assert.strictEqual(forecast.startBalance, 50000);
assert.strictEqual(forecast.days.length, 30);
assert.ok(forecast.dailyBurnRate > 0);
assert.strictEqual(forecast.breachesSafety, true, "Balance dips below 30k safety reserve due to rent + daily burn");

console.log("✓ analytics.js passed");

// ==========================================
// 3. VALIDATION MODULE (validate.js)
// ==========================================
console.log("Testing validate.js...");

// Valid transaction
const validTx = Validate.cleanTransaction({
  day: "2026-10-28",
  amount: "1450.758",
  category: "  Groceries  ",
  note: "Weekly market run"
});
assert.strictEqual(validTx.day, "2026-10-28");
assert.strictEqual(validTx.amount, 1450.76);
assert.strictEqual(validTx.category, "Groceries");
assert.strictEqual(validTx.note, "Weekly market run");

// Invalid date
assert.throws(() => {
  Validate.cleanTransaction({ day: "28-10-2026", amount: 100 });
}, /Date must be YYYY-MM-DD/);

// Invalid amount (negative or zero)
assert.throws(() => {
  Validate.cleanTransaction({ day: "2026-10-28", amount: -50 });
}, /Amount must be a positive number/);
assert.throws(() => {
  Validate.cleanTransaction({ day: "2026-10-28", amount: 0 });
}, /Amount must be a positive number/);

// Clean Profile
const pClean = Validate.cleanProfile({
  balance: "85000",
  saving: "12000",
  safety: "25000",
  netWorth: "250000",
  runway: "3.5",
  growth: "0.08",
  bills: [{ when: "10th", name: "WiFi", amt: 1200, sub: "Fiber" }],
  subs: [{ name: "Spotify", amt: 119, unused: false }],
  goals: [{ name: "Emergency fund", have: 20000, need: 60000, unit: "" }]
}, demoData);
assert.strictEqual(pClean.balance, 85000);
assert.strictEqual(pClean.bills.length, 1);
assert.strictEqual(pClean.subs[0].name, "Spotify");

// Clean Prefs
const prefs = Validate.cleanPrefs({ theme: "cobalt", trim: true, g1: false, rng: 2, day: 14, sav: 15000 });
assert.strictEqual(prefs.theme, "cobalt");
assert.strictEqual(prefs.trim, true);
assert.strictEqual(prefs.rng, 2);

console.log("✓ validate.js passed");

// ==========================================
// 4. CSV PARSER (csv.js)
// ==========================================
console.log("Testing csv.js...");

// Helper function tests
assert.strictEqual(CSV.parseDate("2026-10-28"), "2026-10-28");
assert.strictEqual(CSV.parseDate("28/10/2026"), "2026-10-28");
assert.strictEqual(CSV.parseDate("28 Oct 2026"), "2026-10-28");
assert.strictEqual(CSV.parseMoney("-1,450.50"), -1450.5);
assert.strictEqual(CSV.parseMoney("₹500"), 500);
assert.strictEqual(CSV.guessCategory("Swiggy food order"), "Food delivery");
assert.strictEqual(CSV.guessCategory("Uber ride"), "Cabs");
assert.strictEqual(CSV.guessCategory("Netflix monthly"), "Subscriptions");

const standardCsv = `Date,Description,Amount
2026-10-01,Starbucks Coffee,-350.00
2026-10-02,Salary Credit,50000.00
2026-10-03,Electricity Bill,-2400.00`;

const parsed = CSV.importCsv(standardCsv);
assert.strictEqual(parsed.rows.length, 2, "Only negative/spending amounts are kept for spending tracker");
assert.strictEqual(parsed.rows[0].note, "Starbucks Coffee");
assert.strictEqual(parsed.rows[0].amount, 350);
assert.strictEqual(parsed.rows[1].note, "Electricity Bill");
assert.strictEqual(parsed.rows[1].amount, 2400);

// Separate Debit and Credit columns format
const debitCreditCsv = `Date,Narration,Debit,Credit
05/10/2026,Swiggy Food Delivery,450.00,
06/10/2026,Interest Payout,,120.00`;

const parsed2 = CSV.importCsv(debitCreditCsv);
assert.strictEqual(parsed2.rows.length, 1);
assert.strictEqual(parsed2.rows[0].note, "Swiggy Food Delivery");
assert.strictEqual(parsed2.rows[0].amount, 450);
assert.strictEqual(parsed2.rows[0].category, "Food delivery");

console.log("✓ csv.js passed");
console.log("\nALL MODULE UNIT TESTS PASSED SUCCESSFULLY!");

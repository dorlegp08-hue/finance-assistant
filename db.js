// SQLite storage (Node's built-in node:sqlite). One file, no installs.
// Every query uses bound parameters, never string-built SQL.
const { DatabaseSync } = require("node:sqlite");

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS docs (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      json TEXT NOT NULL,
      updated INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      note TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tx_user_day ON transactions(user_id, day);
    CREATE INDEX IF NOT EXISTS idx_tx_user_cat ON transactions(user_id, category);
    CREATE TABLE IF NOT EXISTS category_rules (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      category TEXT NOT NULL,
      PRIMARY KEY (user_id, pattern)
    );
  `);
  return db;
}

function getDoc(db, uid, kind) {
  const r = db.prepare("SELECT json FROM docs WHERE user_id = ? AND kind = ?").get(uid, kind);
  if (!r) return null;
  try { return JSON.parse(r.json); } catch (e) { return null; }
}
function setDoc(db, uid, kind, value) {
  db.prepare("INSERT INTO docs (user_id, kind, json, updated) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET json = excluded.json, updated = excluded.updated")
    .run(uid, kind, JSON.stringify(value), Date.now());
}
function delDoc(db, uid, kind) { db.prepare("DELETE FROM docs WHERE user_id = ? AND kind = ?").run(uid, kind); }

function listTransactions(db, uid, opts) {
  opts = opts || {};
  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const offset = Math.max(0, Number(opts.offset) || 0);
  let where = "WHERE user_id = ?";
  const params = [uid];
  if (opts.category) { where += " AND category = ?"; params.push(String(opts.category)); }
  if (opts.from) { where += " AND day >= ?"; params.push(String(opts.from)); }
  if (opts.to) { where += " AND day <= ?"; params.push(String(opts.to)); }
  if (opts.q) { where += " AND note LIKE ? ESCAPE '\\'"; params.push(`%${String(opts.q).replace(/[%_\\]/g, "\\$&")}%`); }
  const total = db.prepare(`SELECT COUNT(*) AS n FROM transactions ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT id, day, amount, category, note FROM transactions ${where} ORDER BY day DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total: Number(total), limit, offset, rows };
}

function addTransaction(db, uid, { day, amount, category, note }) {
  const r = db.prepare("INSERT INTO transactions (user_id, day, amount, category, note) VALUES (?, ?, ?, ?, ?)").run(uid, day, amount, category, note);
  return { id: Number(r.lastInsertRowid), day, amount, category, note };
}

function updateTransaction(db, uid, id, updates) {
  const existing = db.prepare("SELECT id, day, amount, category, note FROM transactions WHERE id = ? AND user_id = ?").get(id, uid);
  if (!existing) return null;
  const day = updates.day != null ? updates.day : existing.day;
  const amount = updates.amount != null ? updates.amount : existing.amount;
  const category = updates.category != null ? updates.category : existing.category;
  const note = updates.note != null ? updates.note : existing.note;
  db.prepare("UPDATE transactions SET day = ?, amount = ?, category = ?, note = ? WHERE id = ? AND user_id = ?").run(day, amount, category, note, id, uid);
  return { id: Number(id), day, amount, category, note };
}

function deleteTransaction(db, uid, id) {
  const r = db.prepare("DELETE FROM transactions WHERE id = ? AND user_id = ?").run(id, uid);
  return r.changes > 0;
}

function exportTransactions(db, uid) {
  return db.prepare("SELECT day, amount, category, note FROM transactions WHERE user_id = ? ORDER BY day ASC, id ASC").all(uid);
}

function getUserDataPackage(db, uid) {
  const user = db.prepare("SELECT id, email, name, created FROM users WHERE id = ?").get(uid);
  if (!user) return null;
  const docsRows = db.prepare("SELECT kind, json, updated FROM docs WHERE user_id = ?").all(uid);
  const docs = {};
  for (const d of docsRows) {
    try { docs[d.kind] = JSON.parse(d.json); } catch (e) { docs[d.kind] = d.json; }
  }
  const transactions = exportTransactions(db, uid);
  return { user, docs, transactions, exportedAt: new Date().toISOString() };
}

module.exports = {
  openDb, getDoc, setDoc, delDoc,
  listTransactions, addTransaction, updateTransaction, deleteTransaction,
  exportTransactions, getUserDataPackage
};

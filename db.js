// SQLite storage (Node's built-in node:sqlite). One file, no installs.
// Every query uses bound parameters, never string-built SQL.
const { DatabaseSync } = require("node:sqlite");

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
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

module.exports = { openDb, getDoc, setDoc, delDoc };

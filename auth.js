// Accounts and sessions. Passwords: scrypt with a random salt, compared in constant time.
// Sessions: a random 256-bit token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored.
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const COOKIE = "fathom_sid";
const SESSION_MS = 30 * 24 * 3600 * 1000;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hashPw = async (pw, salt) => (await scrypt(pw, salt, 64)).toString("hex");

function validEmail(e) { return typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

async function signup(db, { name, email, password }) {
  email = String(email || "").trim().toLowerCase();
  name = String(name || "").trim();
  if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!name || name.length > 60) throw new HttpError(400, "Enter your name (up to 60 characters).");
  if (typeof password !== "string" || password.length < 8 || password.length > 200) throw new HttpError(400, "Use a password of at least 8 characters.");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPw(password, salt);
  try {
    const r = db.prepare("INSERT INTO users (email, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)").run(email, name, salt, hash, Date.now());
    return { id: Number(r.lastInsertRowid), email, name };
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, "An account with that email already exists.");
    throw e;
  }
}

const DUMMY_SALT = crypto.randomBytes(16).toString("hex");
async function login(db, { email, password }) {
  email = String(email || "").trim().toLowerCase();
  const u = db.prepare("SELECT id, email, name, salt, hash FROM users WHERE email = ?").get(email);
  // Always do the same work, so timing does not reveal whether the email exists.
  const attempt = await hashPw(String(password || "").slice(0, 200), u ? u.salt : DUMMY_SALT);
  const ok = u && crypto.timingSafeEqual(Buffer.from(attempt, "hex"), Buffer.from(u.hash, "hex"));
  if (!ok) throw new HttpError(401, "Wrong email or password.");
  return { id: u.id, email: u.email, name: u.name };
}

async function verifyPassword(db, uid, password) {
  const u = db.prepare("SELECT salt, hash FROM users WHERE id = ?").get(uid);
  if (!u) return false;
  const attempt = await hashPw(String(password || "").slice(0, 200), u.salt);
  return crypto.timingSafeEqual(Buffer.from(attempt, "hex"), Buffer.from(u.hash, "hex"));
}

function createSession(db, uid) {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)").run(sha(token), uid, Date.now() + SESSION_MS);
  return token;
}
function destroySession(db, token) { if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token)); }
function purgeExpired(db) { db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now()); }

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const tokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE] || "";

function userFrom(db, req) {
  const t = tokenOf(req);
  if (!t || t.length !== 64) return null;
  return db.prepare("SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?").get(sha(t), Date.now()) || null;
}
const cookieHeader = (token, secure) => `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? "; Secure" : ""}`;
const clearCookieHeader = () => `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

// Fixed-window attempt limiter, in memory.
function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(), arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { hits.set(key, arr); return false; }
    arr.push(now); hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
    return true;
  };
}

async function changePassword(db, uid, oldPassword, newPassword) {
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 200) {
    throw new HttpError(400, "New password must be at least 8 characters.");
  }
  const ok = await verifyPassword(db, uid, oldPassword);
  if (!ok) throw new HttpError(401, "Current password is incorrect.");
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPw(newPassword, salt);
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hash, uid);
  return true;
}

function destroyAllSessions(db, uid) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(uid);
}

module.exports = {
  HttpError, signup, login, verifyPassword, changePassword,
  createSession, destroySession, destroyAllSessions, purgeExpired,
  userFrom, tokenOf, cookieHeader, clearCookieHeader, limiter, parseCookies
};

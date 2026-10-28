# Fathom

A finance chat you can bend. Ask "Can I afford a ₹50,000 laptop in 3 months?", then drag the number and watch the picture change.
Plain code (`engine.js`) does every sum; the AI model only reads the question and words the answer.

## Run

```bash
npm start
```

Open http://localhost:3000 (Node 24, no installs). The server only listens on this machine. On first visit, create an account.

## Backend

- **Accounts and login.** Passwords are hashed with scrypt (random salt, constant-time check). Sessions are a random token in an `HttpOnly`, `SameSite=Strict` cookie; only its SHA-256 is stored. Sign-in attempts are rate limited.
- **SQLite database** (`fathom.db`, created on first run, git-ignored) holds users, their numbers, preferences, chat history and imported transactions. Change the path with `FATHOM_DB`.
- **Each user's data is separate.** Everything the browser sends is validated and trimmed before it is stored; all SQL uses bound parameters.
- **Transactions.** Settings → Transactions imports a bank-statement CSV (`date, description, amount`, or separate debit/credit columns; negative amounts are spending). The Spending page then shows your real month, categories against your own usual month, and the guardrail uses them.
- **Money maths on the server too.** `POST /api/scenario` runs the same `engine.js` as the browser; the browser keeps a local copy only so sliders respond instantly.
- **Delete anything.** Settings can remove all transactions or delete the whole account (asks for the password).

### API

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `login`, `logout` | accounts |
| `GET /api/session` | who you are plus your profile, prefs and chat |
| `PUT /api/profile`, `DELETE /api/profile` | your numbers (delete resets to demo) |
| `PUT /api/prefs` | theme and view settings |
| `PUT/DELETE /api/chat/history` | saved conversation |
| `POST /api/chat` | ask the model (uses your stored numbers) |
| `POST /api/scenario` | affordability maths |
| `POST /api/transactions/import`, `GET /api/transactions/summary`, `DELETE /api/transactions` | spending data |
| `POST /api/account/delete` | delete the account and its data |

### Running it somewhere other than your own computer

It is built for local use. Before exposing it, put it behind HTTPS (set `FATHOM_SECURE_COOKIE=1`), add the public host name to `FATHOM_ALLOWED_HOSTS`, bind to a public interface in `server.js`, and consider closing sign-ups. Back up `fathom.db`.

## Add your AI key (optional)

Edit `config.json`:

| field | meaning |
| --- | --- |
| `provider` | `"openai"` (any OpenAI-compatible API: OpenAI, Groq, OpenRouter, Ollama...) or `"anthropic"` |
| `apiKey` | your key, or set the `FATHOM_API_KEY` environment variable instead |
| `baseUrl` | provider URL, e.g. `https://api.openai.com/v1` |
| `model` | model name |

`config.json` is git-ignored. The key stays on the server and never reaches the browser. No key? Chat still works with built-in wording.

## Your own numbers

Open **Settings** to enter your balance, saving, bills, subscriptions and goals. They are saved to your account and are the only figures the model is given. "Reset to demo" restores the sample data in `data.json`.

## Motion

Soft animation with one signature: a sonar ring from the point of action. Settings → Motion has **Full**, **Calm** (fades and rolling numbers only) and **Off**; the first visit follows your system's reduced-motion setting. Optional soft sounds are off by default. This preference is kept per device. The code is `motion.css` and `motion.js`.

## Pages and shortcuts

Home, Chat, Spending, Futures, Settings. `Ctrl/Cmd+K` opens the command palette; `G` then `H`/`C`/`S`/`F`/`E` jumps between pages.

## Test

```bash
npm test
```

Fathom is informational only and is not financial advice.

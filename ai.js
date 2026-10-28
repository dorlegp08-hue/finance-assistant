// Fathom AI Service
// Supports Google Gemini, OpenAI, Anthropic, Groq, and Local Ollama.
// Includes zero-config offline smart fallback using engine.js.
const E = require("./engine.js");

const TIMEOUT_MS = 25000;

function todayStr() {
  const t = new Date();
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`;
}

function factsFrom(profile, summary) {
  const leaks = summary && summary.real && summary.categories ? summary.categories : profile.leaks;
  return {
    today: todayStr(),
    balance: profile.balance,
    safetyLine: profile.safety,
    savedPerMonth: profile.saving,
    netWorth: profile.netWorth,
    bills: profile.bills,
    subscriptions: profile.subs,
    topSpendingCategories: leaks,
    goals: profile.goals
  };
}

function systemPrompt(cfg, profile, summary) {
  return `${cfg.systemPrompt || "You are Fathom, a calm and precise personal-finance assistant."}
All money is in Indian rupees (₹). Use ONLY the facts in this JSON; never invent numbers:
${JSON.stringify(factsFrom(profile, summary))}

Reply strictly with ONE JSON object and nothing else:
If the user asks whether they can afford a purchase, trip, gadget, or expense, reply:
{"kind":"scenario","label":"<1-3 word name>","cost":<rupees as a number>,"months":<whole months from today, default 5>,"lead":"<friendly explanation under 14 words>"}
Otherwise reply:
{"kind":"text","text":"<short plain answer, 1-3 sentences, using only the facts above>"}
You are not a licensed financial advisor; keep advice informational and grounded.`;
}

function normalize(obj, raw) {
  if (obj && obj.kind === "scenario") {
    const cost = E.parseAmount(obj.cost);
    let months = Math.round(Number(obj.months));
    if (!isFinite(months)) months = 5;
    if (cost > 0) {
      return {
        kind: "scenario",
        label: String(obj.label || "That").slice(0, 30),
        cost: Math.round(cost),
        months: Math.min(24, Math.max(1, months)),
        lead: obj.lead ? String(obj.lead).slice(0, 160) : undefined
      };
    }
  }
  if (obj && obj.kind === "text" && obj.text) {
    return { kind: "text", text: String(obj.text).slice(0, 1500) };
  }
  return {
    kind: "text",
    text: String(raw || "").trim().slice(0, 1500) || "I couldn’t work that out. Try asking in other words."
  };
}

// Local smart fallback when offline or no API key is provided
function localFallback(question, profile) {
  const p = E.parseAsk(question, { today: todayStr(), ...profile });
  if (p.cost && p.cost > 0) {
    return {
      kind: "scenario",
      label: p.label ? p.label[0].toUpperCase() + p.label.slice(1) : "That",
      cost: p.cost,
      months: p.months || 5,
      lead: "Simulated with your current numbers"
    };
  }
  const q = question.toLowerCase();
  if (q.includes("balance") || q.includes("in the bank") || q.includes("have")) {
    return { kind: "text", text: `Your current balance is ${E.fmt(profile.balance)} with a safety reserve of ${E.fmt(profile.safety)}.` };
  }
  if (q.includes("save") || q.includes("saving")) {
    return { kind: "text", text: `You currently save about ${E.fmt(profile.saving)} per month.` };
  }
  if (q.includes("net worth")) {
    return { kind: "text", text: `Your net worth is recorded at ${E.fmt(profile.netWorth)}.` };
  }
  if (q.includes("leak") || q.includes("spend")) {
    const top = profile.leaks && profile.leaks[0];
    const leakText = top ? `Top leak area is ${top.name} at ~${E.fmt(top.amt)}/mo.` : "Check your Spending tab for category breakdowns.";
    return { kind: "text", text: leakText };
  }
  return {
    kind: "text",
    text: `You have ${E.fmt(profile.balance)} in the bank, saving ${E.fmt(profile.saving)}/mo. Ask me whether you can afford something, for example: "Can I afford a ₹60,000 laptop in 4 months?"`
  };
}

async function askModel(cfg, question, history, profile, summary) {
  const provider = (cfg.provider || "openai").toLowerCase();
  const apiKey = cfg.apiKey || process.env.FATHOM_API_KEY;
  const isOllama = provider === "ollama";

  // If no API key configured and not local/ollama, report readable error
  if (!isOllama && provider !== "local" && (!apiKey || apiKey === "PASTE_KEY_HERE" || apiKey.trim() === "")) {
    throw new Error("Add your API key to config.json.");
  }
  if (provider === "local") {
    return localFallback(question, profile);
  }

  const sys = systemPrompt(cfg, profile, summary);
  const cleanHistory = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1500) }));

  let url, headers = {}, body;

  try {
    if (provider === "gemini") {
      const model = cfg.model || "gemini-1.5-flash";
      url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const contents = [
        { role: "user", parts: [{ text: "System Instructions: " + sys }] },
        ...cleanHistory.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }]
        })),
        { role: "user", parts: [{ text: question.slice(0, 1000) }] }
      ];
      body = {
        contents,
        generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 500 }
      };
      headers = { "content-type": "application/json" };
    } else if (provider === "anthropic") {
      url = (cfg.baseUrl || "https://api.anthropic.com") + "/v1/messages";
      headers = {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
      body = {
        model: cfg.model || "claude-3-5-haiku-20241022",
        max_tokens: 600,
        system: sys,
        messages: [...cleanHistory, { role: "user", content: question.slice(0, 1000) }]
      };
    } else if (isOllama) {
      url = (cfg.baseUrl || "http://localhost:11434").replace(/\/$/, "") + "/api/chat";
      headers = { "content-type": "application/json" };
      body = {
        model: cfg.model || "llama3",
        messages: [
          { role: "system", content: sys },
          ...cleanHistory,
          { role: "user", content: question.slice(0, 1000) }
        ],
        stream: false,
        format: "json"
      };
    } else {
      // OpenAI / Groq / OpenRouter / DeepSeek
      url = String(cfg.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
      headers = {
        "content-type": "application/json",
        Authorization: "Bearer " + apiKey
      };
      body = {
        model: cfg.model || "gpt-4o-mini",
        messages: [
          { role: "system", content: sys },
          ...cleanHistory,
          { role: "user", content: question.slice(0, 1000) }
        ],
        response_format: { type: "json_object" }
      };
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data.error?.message || data.message || `Provider returned status ${res.status}`;
      throw new Error(err);
    }

    let raw = "";
    if (provider === "gemini") {
      raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    } else if (provider === "anthropic") {
      raw = (data.content || []).map((b) => b.text || "").join("");
    } else if (isOllama) {
      raw = data.message?.content || "";
    } else {
      raw = data.choices?.[0]?.message?.content || "";
    }

    const m = raw.match(/\{[\s\S]*\}/);
    let obj = null;
    if (m) {
      try { obj = JSON.parse(m[0]); } catch (e) {}
    }
    return normalize(obj, raw);
  } catch (err) {
    throw new Error(err.message || "Could not reach the provider.");
  }
}

module.exports = { askModel, normalize, systemPrompt, localFallback };

// Fathom motion helpers. Vanilla, no libraries. Everything respects Motion mode: full | calm | off.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const cfg = { mode: reduce ? "calm" : "full", sound: false };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem("fathom_motion") || "{}")); } catch (e) {}
  const root = () => document.getElementById("dx-root");
  const on = () => cfg.mode !== "off";
  const full = () => cfg.mode === "full";
  const at = (el) => { const b = el.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; };

  function apply() {
    const r = root(); if (!r) return;
    r.classList.toggle("motion-off", cfg.mode === "off");
    r.classList.toggle("motion-calm", cfg.mode === "calm");
  }
  function set(k, v) { cfg[k] = v; try { localStorage.setItem("fathom_motion", JSON.stringify(cfg)); } catch (e) {} apply(); }

  // ---- signature: one soft ring from the point of action ----
  function ripple(x, y, o) {
    if (!full()) return;
    const r = root(); if (!r) return;
    const el = document.createElement("i");
    el.className = "ring" + (o && o.small ? " sm" : "");
    el.style.left = x + "px"; el.style.top = y + "px";
    r.appendChild(el);
    el.addEventListener("animationend", () => el.remove());
    setTimeout(() => el.remove(), 1300);
  }
  let trT = 0;
  function trail(el) {
    if (!full() || !el) return;
    const n = performance.now(); if (n - trT < 45) return; trT = n;
    const [x, y] = at(el), d = document.createElement("i");
    d.className = "trail"; d.style.left = x + "px"; d.style.top = y + "px";
    root().appendChild(d); setTimeout(() => d.remove(), 850);
  }

  // ---- rolling numbers: one shared frame loop, retargets from the value on screen ----
  const active = new Set(); let raf = 0, last = 0;
  function frame(t) {
    const dt = Math.min(64, t - last || 16); last = t;
    for (const el of active) {
      const n = el._n;
      n.v += (n.to - n.v) * (1 - Math.exp(-dt / n.tau));
      if (Math.abs(n.to - n.v) < Math.max(0.5, Math.abs(n.to) * 0.0015)) { n.v = n.to; active.delete(el); }
      el.textContent = n.fmt(Math.round(n.v));
    }
    raf = active.size ? requestAnimationFrame(frame) : 0;
  }
  function num(el, to, fmt, o) {
    if (!el) return;
    o = o || {};
    let n = el._n;
    if (!n) n = el._n = { v: o.from !== undefined ? o.from : to, to, fmt, tau: o.tau || 100 };
    else { n.to = to; n.fmt = fmt; if (o.tau) n.tau = o.tau; if (o.from !== undefined) n.v = o.from; }
    clearTimeout(n.fin);
    if (!on() || n.v === to) { n.v = to; active.delete(el); el.textContent = fmt(Math.round(to)); return; }
    // Safety net: frames pause in background tabs, but a number must never stay wrong.
    n.fin = setTimeout(() => { n.v = n.to; active.delete(el); el.textContent = n.fmt(Math.round(n.to)); }, 1600);
    active.add(el);
    el.textContent = fmt(Math.round(n.v));
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  // ---- charts draw themselves ----
  // The class is removed on animationend, and by a timer in case the event never fires (hidden tab).
  const once = (el, cls, ms) => {
    el.classList.add(cls);
    const off = () => el.classList.remove(cls);
    el.addEventListener("animationend", off, { once: true }); setTimeout(off, ms);
  };
  function drawChart(svg) {
    if (!svg || !on()) return;
    $$(".ln", svg).forEach((p) => {
      p.setAttribute("pathLength", "1");
      p.classList.remove("draw"); void p.getBoundingClientRect(); once(p, "draw", 2200);
    });
    $$(".ar", svg).forEach((a) => once(a, "fadeup", 2200));
    $$(".mk", svg).forEach((m) => {
      once(m, "drop", 2200);
      setTimeout(() => { const c = m.isConnected && full() && $("circle", m); if (c) { const [x, y] = at(c); ripple(x, y, { small: true }); } }, 1100);
    });
  }

  // ---- page entrance: reveal on scroll, chart draw, heatmap wave ----
  function enter(page, nav) {
    if (!nav || !on() || !page) return;
    const wrap = $(".wrap", page); if (wrap) wrap.classList.add("enter");
    $$("svg.chart", page).forEach(drawChart);
    $$(".heat > .hc", page).forEach((c, i) => {
      if (c.classList.contains("emp")) return;
      c.classList.add("wave"); c.style.animationDelay = (Math.floor(i / 7) + (i % 7)) * 26 + "ms";
    });
    if (!("IntersectionObserver" in window)) return;
    const els = [...new Set($$(".hero>div,.stat,.sec>div:first-child,.sec>div:last-child,.ph,.foot,.rcpt,.ms>div,.wrap>.cd,.conv .scn", page))];
    els.forEach((e) => e.classList.add("rv"));
    const settle = (e, d) => setTimeout(() => { e.classList.add("in"); setTimeout(() => e.classList.remove("rv", "in"), 900); }, d);
    const io = new IntersectionObserver((entries) => {
      let n = 0;
      entries.forEach((en) => { if (en.isIntersecting) { io.unobserve(en.target); settle(en.target, Math.min(n++, 5) * 70); } });
    }, { root: page, threshold: 0.06, rootMargin: "0px 0px -4% 0px" });
    els.forEach((e) => io.observe(e));
    // Safety net: a hidden pane may never fire the observer, so nothing may stay invisible.
    setTimeout(() => { els.forEach((e) => { if (e.classList.contains("rv") && !e.classList.contains("in")) settle(e, 0); }); io.disconnect(); }, 1600);
  }

  // ---- verdict change: pill pops, one ring leaves the marker ----
  function verdict(card, marker) {
    if (!on()) return;
    const pill = $(".pill", card);
    if (pill) { pill.classList.remove("pop"); void pill.offsetWidth; pill.classList.add("pop"); }
    if (full() && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) {} }
    setTimeout(() => { const c = marker && marker.isConnected && $("circle", marker); if (c && full()) { const [x, y] = at(c); ripple(x, y, { small: true }); } }, 320);
  }

  // ---- theme: colour grows out of the pressed swatch ----
  function themeReveal(x, y, fn) {
    if (!full() || !document.startViewTransition) { fn(); return; }
    const r = document.documentElement;
    r.style.setProperty("--vx", x + "px"); r.style.setProperty("--vy", y + "px");
    document.startViewTransition(fn);
  }

  // ---- optional soft sounds (generated, off by default, same frame as the visual) ----
  let ac;
  function tone(f, d, g, delay) {
    if (!cfg.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      const t = ac.currentTime + (delay || 0), o = ac.createOscillator(), a = ac.createGain();
      o.type = "sine"; o.frequency.value = f;
      a.gain.setValueAtTime(0.0001, t); a.gain.exponentialRampToValueAtTime(g, t + 0.01); a.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(a); a.connect(ac.destination); o.start(t); o.stop(t + d + 0.02);
    } catch (e) {}
  }
  const tick = () => tone(1400, 0.03, 0.02);
  const pop = () => tone(520, 0.08, 0.03);
  const chime = () => { tone(660, 0.25, 0.035); tone(990, 0.35, 0.03, 0.09); };

  // ---- press feedback on pointer-down, ripple on meaningful actions ----
  const PING = ".btn,.send,[data-act=trim],[data-act=g1],[data-act=newChat],[data-ask]";
  function press(b) {
    b.style.transition = "scale .08s ease-out"; b.style.scale = ".97";
    const up = () => {
      b.style.transition = "scale .45s cubic-bezier(.22,1,.36,1)"; b.style.scale = "";
      setTimeout(() => { if (b.style.scale === "") b.style.transition = ""; }, 480);
      removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
    };
    addEventListener("pointerup", up); addEventListener("pointercancel", up);
  }
  document.addEventListener("pointerdown", (e) => {
    if (!on()) return;
    const b = e.target.closest && e.target.closest("button");
    if (!b || b.disabled) return;
    press(b);
    if (b.matches(PING)) ripple(e.clientX, e.clientY);
  });
  document.addEventListener("click", (e) => {
    if (!on() || e.detail !== 0) return; // keyboard activation: ring from the element
    const b = e.target.closest && e.target.closest(PING);
    if (b) { const [x, y] = at(b); ripple(x, y); }
  });

  // ---- cursor-following light, magnetic buttons, hero tilt (full mode, mouse only) ----
  let px = 0, py = 0, pt = null, pend = false, mag = null, tilt = null;
  document.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || !full()) return;
    px = e.clientX; py = e.clientY; pt = e.target;
    if (!pend) { pend = true; requestAnimationFrame(move); }
  });
  function move() {
    pend = false;
    const t = pt; if (!t || !t.closest) return;
    const card = t.closest(".cd");
    if (card) { const b = card.getBoundingClientRect(); card.style.setProperty("--lx", ((px - b.left) / b.width) * 100 + "%"); card.style.setProperty("--ly", ((py - b.top) / b.height) * 100 + "%"); }
    const m = t.closest(".btn,.send");
    if (m !== mag) { if (mag) mag.style.translate = ""; mag = m; }
    if (m) {
      const b = m.getBoundingClientRect(), c = (v) => Math.max(-6, Math.min(6, v * 0.14));
      m.style.translate = c(px - (b.left + b.width / 2)) + "px " + c(py - (b.top + b.height / 2)) + "px";
    }
    const hp = t.closest(".hp");
    if (hp) {
      const b = hp.getBoundingClientRect();
      hp.style.transform = `perspective(900px) rotateX(${(((py - b.top) / b.height) - 0.5) * -5}deg) rotateY(${(((px - b.left) / b.width) - 0.5) * 5}deg)`;
      tilt = hp;
    } else if (tilt) { tilt.style.transform = ""; tilt = null; }
  }

  apply();
  window.Motion = { cfg, set, apply, ripple, at, trail, num, drawChart, enter, verdict, themeReveal, tick, pop, chime };
})();

# Galaxy + Music Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the Win Journal front-end with a music + galaxy aesthetic, WCAG 2.1 AA compliant, with independent High-Contrast and Colorblind-safe toggles and tasteful decorative effects.

**Architecture:** Three orthogonal attributes on `<html>` (`data-theme` mood, `data-contrast`, `data-cvd`) drive CSS custom-property token layers. Galaxy visuals = a canvas starfield (dark mood only) + CSS nebula + frosted-glass cards + a decorative CSS equalizer. All decoration is gated off under high-contrast and `prefers-reduced-motion`. Presentation layer only — no server/DB/journaling changes.

**Tech Stack:** Vanilla HTML/CSS/JS (zero runtime deps), Canvas 2D, Node built-in test runner for the one pure function.

## Global Constraints

- Presentation layer only: do NOT modify `server.js`, `storage.js`, `env.js`, or journaling behavior.
- Keep the app zero-runtime-dependency; tests use `node --test` / `node:assert` only.
- Token structure MUST mirror the existing base: light is the `:root` base; dark layers under `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` and `:root[data-theme="dark"]`. After JS init, `data-theme` is ALWAYS set explicitly (`dark`/`light`), so `data-cvd`/`data-contrast` override blocks key off explicit `[data-theme="dark"]`/`[data-theme="light"]`.
- Cascade/precedence: base mood → `[data-cvd="safe"]` → `[data-contrast="high"]`. High-contrast blocks authored LAST so they win (equal specificity with cvd).
- Contrast: ≥ 4.5:1 text / 3:1 UI in all modes; ≥ 7:1 in high-contrast. Never convey meaning by color alone.
- Motion: `prefers-reduced-motion` AND high-contrast each fully stop starfield, nebula drift, equalizer, parallax.
- Decorative elements (`#starfield`, `#nebula`, `.equalizer`) are `aria-hidden="true"` and `pointer-events:none`.
- Exact token values are in the spec: `docs/superpowers/specs/2026-07-02-galaxy-music-theme-design.md`.

---

### Task 1: Token architecture + explicit-theme resolution

**Files:**
- Modify: `public/styles.css` (token blocks near top, lines ~6-69)
- Modify: `public/app.js` (theme block, lines ~90-115)

**Interfaces:**
- Produces: `<html>` always carries an explicit `data-theme` of `dark`|`light` after load; new CSS tokens `--space-0, --glass-bg, --glass-border, --glow, --star-a/b/c, --nebula-a/b/c, --nebula-opacity, --starfield-display` defined per mood; `[data-cvd="safe"]` and `[data-contrast="high"]` override blocks. `applyTheme(pref)` sets the explicit attribute.

- [ ] **Step 1: Add galaxy tokens to the light base (`:root`)**

In `public/styles.css`, inside the existing `:root { ... }` block (after `--grad-b`), add:
```css
  /* galaxy / aurora additions (Aurora Dawn) */
  --space-0: #eef1fb;
  --glass-bg: rgba(255,255,255,0.74);
  --glass-border: rgba(79,70,229,0.18);
  --glow: 0 0 20px rgba(124,58,237,0.18);
  --nebula-a: rgba(150,130,255,0.20);
  --nebula-b: rgba(120,200,220,0.18);
  --nebula-c: rgba(210,150,230,0.16);
  --nebula-opacity: 1;
  --starfield-display: none;
```

- [ ] **Step 2: Add galaxy tokens to BOTH dark blocks (Nebula Night)**

Add the SAME block below to each of: the `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` block AND the `:root[data-theme="dark"] { ... }` block (after their `--grad-b`):
```css
  /* galaxy additions (Nebula Night) */
  --space-0: #05060d;
  --glass-bg: rgba(18,20,34,0.72);
  --glass-border: rgba(140,150,255,0.22);
  --glow: 0 0 24px rgba(129,140,248,0.35);
  --star-a: rgba(255,255,255,0.90);
  --star-b: rgba(190,200,255,0.80);
  --star-c: rgba(150,220,255,0.70);
  --nebula-a: rgba(88,60,180,0.35);
  --nebula-b: rgba(30,90,160,0.30);
  --nebula-c: rgba(140,50,150,0.25);
  --nebula-opacity: 1;
  --starfield-display: block;
```

- [ ] **Step 3: Add the colorblind-safe and high-contrast override blocks**

Immediately AFTER the `:root[data-theme="dark"] { ... }` block, add (order matters — cvd first, high-contrast last):
```css
/* --- Colorblind-safe (Okabe-Ito blue accent) --- */
:root[data-theme="light"][data-cvd="safe"] {
  --accent:#0072B2; --accent-hover:#005a8c; --accent-contrast:#ffffff;
  --accent-soft:#d6ebf7; --accent-on-soft:#004e79; --ring:rgba(0,114,178,.55);
  --grad-a:#0072B2; --grad-b:#005a8c;
}
:root[data-theme="dark"][data-cvd="safe"] {
  --accent:#56B4E9; --accent-hover:#7fc7ef; --accent-contrast:#05060d;
  --accent-soft:#10314a; --accent-on-soft:#9bd3f2; --ring:rgba(86,180,233,.60);
  --grad-a:#0072B2; --grad-b:#005a8c;
}

/* --- High contrast (AAA, decoration off) — authored last so it wins over cvd --- */
:root[data-theme="light"][data-contrast="high"] {
  --bg:#fff; --bg-elev:#fff; --bg-inset:#fff; --space-0:#fff; --glass-bg:#fff;
  --ink:#000; --muted:#1a1a1a; --line:#000; --glass-border:#000;
  --accent:#0000cc; --accent-contrast:#fff; --accent-hover:#0000a0;
  --accent-soft:#e6e6ff; --accent-on-soft:#0000a0; --ring:#0000cc;
  --grad-a:#fff; --grad-b:#fff; --glow:none; --nebula-opacity:0; --starfield-display:none;
}
:root[data-theme="dark"][data-contrast="high"] {
  --bg:#000; --bg-elev:#000; --bg-inset:#000; --space-0:#000; --glass-bg:#000;
  --ink:#fff; --muted:#e6e6e6; --line:#fff; --glass-border:#fff;
  --accent:#ffd400; --accent-contrast:#000; --accent-hover:#ffe34d;
  --accent-soft:#1a1a00; --accent-on-soft:#ffd400; --ring:#fff;
  --grad-a:#000; --grad-b:#000; --glow:none; --nebula-opacity:0; --starfield-display:none;
}
```

- [ ] **Step 4: Refactor `applyTheme` in `public/app.js` to always set an explicit theme**

Replace the current `applyTheme` function (lines ~92-102) with:
```js
function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(pref) {
  const effective = resolveTheme(pref);
  document.documentElement.setAttribute('data-theme', effective); // always explicit
  const isDark = effective === 'dark';
  themeToggle.textContent = isDark ? '☀️ Light' : '🌙 Dark';
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
}
```
(The existing click handler and the `matchMedia(...).addEventListener('change', ...)` that calls `applyTheme(null)` stay as-is — they now resolve to an explicit attribute. The starfield reacts via a MutationObserver added in Task 4, so no event wiring is needed here.)

- [ ] **Step 5: Verify tokens resolve correctly in every combination**

Start the app: `node server.js &` (then open `http://localhost:4321` in the browser MCP; stop with `kill %1` when done).
In the browser console, for each combination set the attributes and read back tokens, e.g.:
```js
const h = document.documentElement;
h.setAttribute('data-theme','dark'); h.removeAttribute('data-contrast'); h.removeAttribute('data-cvd');
getComputedStyle(h).getPropertyValue('--ink').trim();   // expect #e8eaf2
h.setAttribute('data-contrast','high');
getComputedStyle(h).getPropertyValue('--bg').trim();     // expect #000  (dark high-contrast)
getComputedStyle(h).getPropertyValue('--accent').trim(); // expect #ffd400
h.setAttribute('data-theme','light');
getComputedStyle(h).getPropertyValue('--bg').trim();     // expect #fff  (light high-contrast)
h.removeAttribute('data-contrast'); h.setAttribute('data-cvd','safe');
getComputedStyle(h).getPropertyValue('--accent').trim(); // expect #0072B2 (light cvd)
h.setAttribute('data-theme','dark');
getComputedStyle(h).getPropertyValue('--accent').trim(); // expect #56B4E9 (dark cvd)
```
Expected: each read matches the comment. Reset attributes when done.

- [ ] **Step 6: Commit**
```bash
git add public/styles.css public/app.js
git commit -m "Add three-axis theme tokens (mood/contrast/color-vision) + explicit theme resolution"
```

---

### Task 2: Galaxy/aurora backgrounds + frosted-glass surfaces

**Files:**
- Modify: `public/index.html` (add decorative elements after `<body>`)
- Modify: `public/styles.css` (background + surface rules)

**Interfaces:**
- Consumes: tokens from Task 1 (`--space-0`, `--glass-bg`, `--glass-border`, `--glow`, `--nebula-*`, `--starfield-display`).
- Produces: `#starfield` canvas and `#nebula` element in the DOM (renderer JS comes in Task 4); glass `.card`/`.tabs` surfaces.

- [ ] **Step 1: Add the decorative background elements**

In `public/index.html`, immediately after the opening `<body>` tag, add:
```html
  <canvas id="starfield" aria-hidden="true"></canvas>
  <div id="nebula" aria-hidden="true"></div>
```

- [ ] **Step 2: Add background + nebula CSS**

In `public/styles.css`, after the `body { ... }` rule, add:
```css
body { background: var(--space-0); position: relative; }
#starfield {
  position: fixed; inset: 0; width: 100%; height: 100%;
  z-index: -2; display: var(--starfield-display); pointer-events: none;
}
#nebula {
  position: fixed; inset: -10%; z-index: -1; pointer-events: none;
  opacity: var(--nebula-opacity);
  background:
    radial-gradient(40% 50% at 20% 30%, var(--nebula-a), transparent 70%),
    radial-gradient(45% 55% at 80% 25%, var(--nebula-b), transparent 70%),
    radial-gradient(50% 60% at 60% 80%, var(--nebula-c), transparent 70%);
  filter: blur(40px);
  animation: nebula-drift 90s ease-in-out infinite alternate;
}
@keyframes nebula-drift {
  from { transform: translate3d(0,0,0) scale(1); }
  to   { transform: translate3d(2%, -2%, 0) scale(1.08); }
}
```

- [ ] **Step 3: Make cards + tabs frosted glass with a supported-fallback**

In `public/styles.css`, replace the existing `.card { ... }` rule with:
```css
.card {
  background: var(--glass-bg);
  backdrop-filter: blur(12px) saturate(1.2);
  -webkit-backdrop-filter: blur(12px) saturate(1.2);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  padding: 22px;
  box-shadow: var(--shadow), var(--glow);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .card { background: var(--bg-elev); }
}
```
And update the `.tabs` rule's `background: var(--bg-elev);` to:
```css
  background: var(--glass-bg);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
```
And add a glow to the primary button — after `.btn.primary:hover { ... }` add:
```css
.btn.primary { box-shadow: var(--glow); }
```

- [ ] **Step 4: Verify visually in both moods**

With the app running, use the browser MCP to screenshot: (a) dark mood — expect nebula glow + frosted cards over a deep base; (b) light mood — expect pale aurora + light frosted cards. Confirm body text on cards is clearly legible in both. (Starfield will be blank until Task 4 — that's expected.)

- [ ] **Step 5: Commit**
```bash
git add public/index.html public/styles.css
git commit -m "Add galaxy/aurora backgrounds and frosted-glass surfaces"
```

---

### Task 3: Decorative music motif (equalizer + accents)

**Files:**
- Modify: `public/index.html` (equalizer in the brand area)
- Modify: `public/styles.css` (equalizer + accent styles, reduced-motion)

**Interfaces:**
- Consumes: tokens from Task 1.
- Produces: an `aria-hidden` `.equalizer` decoration in the header.

- [ ] **Step 1: Add the equalizer markup**

In `public/index.html`, inside `<div class="brand">`, after the `<div>` that holds the `<h1>`/tagline (i.e., just before `</div>` closing `.brand`), add:
```html
      <div class="equalizer" aria-hidden="true">
        <span></span><span></span><span></span><span></span><span></span><span></span><span></span>
      </div>
```

- [ ] **Step 2: Add equalizer CSS**

In `public/styles.css`, at the end of the file add:
```css
/* --- decorative music equalizer --- */
.equalizer { display:inline-flex; align-items:flex-end; gap:3px; height:22px; margin-left:6px; color:#fff; opacity:.9; }
.equalizer span {
  width:3px; height:100%; background: currentColor; border-radius:2px;
  transform-origin: bottom; transform: scaleY(.4);
  animation: eq 1.1s ease-in-out infinite;
}
.equalizer span:nth-child(1){ animation-delay:-.9s } .equalizer span:nth-child(2){ animation-delay:-.2s }
.equalizer span:nth-child(3){ animation-delay:-.6s } .equalizer span:nth-child(4){ animation-delay:-.35s }
.equalizer span:nth-child(5){ animation-delay:-.75s } .equalizer span:nth-child(6){ animation-delay:-.1s }
.equalizer span:nth-child(7){ animation-delay:-.5s }
@keyframes eq { 0%,100%{ transform: scaleY(.35) } 50%{ transform: scaleY(1) } }
/* meaning-free decoration: hidden when decoration is off */
:root[data-contrast="high"] .equalizer { display:none; }
```

- [ ] **Step 3: Extend the reduced-motion rule to rest the equalizer + freeze nebula**

The file already has `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { transition:none!important; animation:none!important; ... } }`. That already stops the equalizer/nebula animations. Add inside that same media block:
```css
  .equalizer span { transform: scaleY(.5) !important; }
```

- [ ] **Step 4: Verify**

Screenshot dark mood — expect the animated equalizer bars in the header. Emulate `prefers-reduced-motion: reduce` (browser MCP) and confirm bars are static (mid-height) and nebula isn't drifting. Toggle high-contrast (`document.documentElement.setAttribute('data-contrast','high')`) and confirm the equalizer disappears.

- [ ] **Step 5: Commit**
```bash
git add public/index.html public/styles.css
git commit -m "Add decorative music equalizer with motion/contrast gating"
```

---

### Task 4: Starfield canvas renderer (with unit-tested gate)

**Files:**
- Create: `public/starfield.js`
- Create: `test/starfield.test.js`
- Modify: `public/index.html` (load the script)

**Interfaces:**
- Consumes: `#starfield` canvas (Task 2), tokens `--star-a/b/c`, and `<html>` attributes `data-theme`/`data-contrast`.
- Produces: `starfield.js` exporting `{ shouldAnimate }` under Node; in the browser it self-runs, syncing on attribute/motion/visibility changes.

- [ ] **Step 1: Write the failing unit test**

Create `test/starfield.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { shouldAnimate } = require(path.join(__dirname, '..', 'public', 'starfield.js'));

test('starfield animates only in dark mood with no high-contrast and no reduced-motion', () => {
  assert.strictEqual(shouldAnimate({ effectiveDark: true,  highContrast: false, reducedMotion: false }), true);
  assert.strictEqual(shouldAnimate({ effectiveDark: false, highContrast: false, reducedMotion: false }), false);
  assert.strictEqual(shouldAnimate({ effectiveDark: true,  highContrast: true,  reducedMotion: false }), false);
  assert.strictEqual(shouldAnimate({ effectiveDark: true,  highContrast: false, reducedMotion: true  }), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../public/starfield.js'`.

- [ ] **Step 3: Create `public/starfield.js`**

```js
'use strict';

// Pure gate: stars animate only in dark mood, decoration on, motion allowed.
function shouldAnimate({ effectiveDark, highContrast, reducedMotion }) {
  return Boolean(effectiveDark) && !highContrast && !reducedMotion;
}

// Under Node (tests) export the pure function and stop before touching the DOM.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { shouldAnimate };
} else {
  (function () {
    const canvas = document.getElementById('starfield');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const LAYERS = [
      { count: 120, speed: 0.02, size: 1.2, varName: '--star-a' },
      { count: 80,  speed: 0.05, size: 1.6, varName: '--star-b' },
      { count: 50,  speed: 0.09, size: 2.2, varName: '--star-c' },
    ];
    const MAX = 300;
    let stars = [], raf = 0, w = 0, h = 0, dpr = 1, mx = 0, my = 0, running = false, t = 0;

    function currentState() {
      const el = document.documentElement;
      return {
        effectiveDark: el.getAttribute('data-theme') === 'dark',
        highContrast: el.getAttribute('data-contrast') === 'high',
        reducedMotion: rm.matches,
      };
    }
    function tokenColor(varName) {
      return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || 'rgba(255,255,255,.8)';
    }
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      genStars();
    }
    function genStars() {
      stars = [];
      const scale = Math.min(1, (w * h) / (1440 * 900));
      LAYERS.forEach((L, li) => {
        const n = Math.min(Math.round(L.count * scale), MAX);
        for (let i = 0; i < n; i++) {
          stars.push({ x: Math.random() * w, y: Math.random() * h, r: L.size * (0.6 + Math.random() * 0.6), tw: Math.random() * Math.PI * 2, layer: li });
        }
      });
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      const cols = LAYERS.map((L) => tokenColor(L.varName));
      for (const s of stars) {
        const L = LAYERS[s.layer];
        const px = mx * L.speed * 40, py = my * L.speed * 40;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s.tw);
        ctx.fillStyle = cols[s.layer];
        ctx.beginPath();
        ctx.arc(((s.x + px + t * L.speed * 20) % w + w) % w, ((s.y + py) % h + h) % h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function loop() { t += 0.016; draw(); raf = requestAnimationFrame(loop); }
    function start() { if (running) return; running = true; resize(); loop(); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; ctx.clearRect(0, 0, w, h); }
    function sync() { (shouldAnimate(currentState()) && !document.hidden) ? start() : stop(); }

    window.addEventListener('resize', () => { if (running) resize(); });
    window.addEventListener('pointermove', (e) => { mx = (e.clientX / window.innerWidth - 0.5); my = (e.clientY / window.innerHeight - 0.5); });
    document.addEventListener('visibilitychange', sync);
    rm.addEventListener('change', sync);
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast'] });
    sync();
  })();
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npm test`
Expected: PASS — all storage tests plus the new `shouldAnimate` test pass.

- [ ] **Step 5: Load the script in the page**

In `public/index.html`, after `<script src="/app.js"></script>`, add:
```html
  <script src="/starfield.js"></script>
```

- [ ] **Step 6: Verify in the browser**

With the app running: dark mood → twinkling drifting stars visible; switch to light mood → canvas blank (aurora only); set high-contrast → stars stop and clear; emulate reduced-motion → no stars; switch to a background tab and back → animation pauses/resumes. Screenshot dark mood with stars.

- [ ] **Step 7: Commit**
```bash
git add public/starfield.js test/starfield.test.js public/index.html
git commit -m "Add canvas starfield renderer with unit-tested animation gate"
```

---

### Task 5: Accessibility toggles + Display popover

**Files:**
- Modify: `public/index.html` (topbar-actions markup, lines ~18-23)
- Modify: `public/app.js` (toggle wiring + popover)
- Modify: `public/styles.css` (popover + toggle styles)

**Interfaces:**
- Consumes: token override blocks from Task 1.
- Produces: `#displayBtn`/`#displayPanel` popover; `#contrastToggle`, `#cvdToggle`; `applyContrast(on)`, `applyCvd(on)` in app.js; persisted `wj-contrast`/`wj-cvd`.

- [ ] **Step 1: Replace the topbar-actions markup**

In `public/index.html`, replace the entire `<div class="topbar-actions"> ... </div>` block with:
```html
    <div class="topbar-actions">
      <button class="ai-toggle" id="aiToggle" type="button" aria-pressed="false" disabled
              title="Use Claude AI for summaries, resume bullets, and suggestions">AI: off</button>
      <div class="display-menu">
        <button class="display-btn" id="displayBtn" type="button"
                aria-haspopup="true" aria-expanded="false" aria-controls="displayPanel">⚙ Display</button>
        <div class="display-panel" id="displayPanel" role="menu" aria-label="Display settings" hidden>
          <button class="theme-toggle" id="themeToggle" type="button" role="menuitem"
                  aria-pressed="false" aria-label="Switch to dark mode">🌙 Dark</button>
          <button class="display-item" id="contrastToggle" type="button" role="menuitemcheckbox"
                  aria-checked="false">High contrast</button>
          <button class="display-item" id="cvdToggle" type="button" role="menuitemcheckbox"
                  aria-checked="false">Colorblind-safe</button>
        </div>
      </div>
    </div>
```

- [ ] **Step 2: Add popover + toggle styles**

In `public/styles.css`, at the end of the file add:
```css
/* --- display popover --- */
.display-menu { position: relative; }
.display-btn {
  background: rgba(255,255,255,0.18); color:#fff; border:1px solid transparent;
  padding:7px 14px; border-radius:999px; font-size:13px; font-weight:600; cursor:pointer;
  transition: background .2s ease, transform .15s ease;
}
.display-btn:hover { background: rgba(255,255,255,0.32); transform: translateY(-1px); }
.display-panel {
  position:absolute; right:0; top:100%; margin-top:8px; z-index:30;
  background: var(--bg-elev); color: var(--ink);
  border:1px solid var(--line); border-radius:12px; box-shadow: var(--shadow);
  min-width:200px; padding:8px; display:flex; flex-direction:column; gap:4px;
}
.display-panel .theme-toggle,
.display-item {
  width:100%; text-align:left; background:none; border:1px solid transparent;
  color: var(--ink); padding:9px 12px; border-radius:8px; font-size:14px; cursor:pointer;
}
.display-panel .theme-toggle { width:100%; height:auto; border-radius:8px; font-size:14px; }
.display-item[aria-checked="true"]::after { content:" ✓"; color: var(--accent); font-weight:700; }
.display-panel button:hover { background: var(--accent-soft); color: var(--accent-on-soft); }
```

- [ ] **Step 3: Wire the toggles + popover in `public/app.js`**

In `public/app.js`, after the theme block (after `applyTheme(localStorage.getItem('wj-theme'));`), add:
```js
// --- accessibility toggles: high contrast + colorblind-safe ---
const contrastToggle = $('#contrastToggle');
const cvdToggle = $('#cvdToggle');
function applyContrast(on) {
  if (on) document.documentElement.setAttribute('data-contrast', 'high');
  else document.documentElement.removeAttribute('data-contrast');
  contrastToggle.setAttribute('aria-checked', String(on));
  localStorage.setItem('wj-contrast', on ? 'high' : '');
}
function applyCvd(on) {
  if (on) document.documentElement.setAttribute('data-cvd', 'safe');
  else document.documentElement.removeAttribute('data-cvd');
  cvdToggle.setAttribute('aria-checked', String(on));
  localStorage.setItem('wj-cvd', on ? 'safe' : '');
}
contrastToggle.addEventListener('click', () => {
  const on = contrastToggle.getAttribute('aria-checked') !== 'true';
  applyContrast(on); toast(on ? 'High contrast on' : 'High contrast off');
});
cvdToggle.addEventListener('click', () => {
  const on = cvdToggle.getAttribute('aria-checked') !== 'true';
  applyCvd(on); toast(on ? 'Colorblind-safe palette on' : 'Colorblind-safe off');
});
applyContrast(localStorage.getItem('wj-contrast') === 'high');
applyCvd(localStorage.getItem('wj-cvd') === 'safe');

// --- display popover ---
const displayBtn = $('#displayBtn');
const displayPanel = $('#displayPanel');
function panelItems() { return Array.from(displayPanel.querySelectorAll('button')); }
function openPanel() {
  displayPanel.hidden = false;
  displayBtn.setAttribute('aria-expanded', 'true');
  const first = panelItems()[0]; if (first) first.focus();
  document.addEventListener('keydown', onPanelKey, true);
  document.addEventListener('click', onOutside, true);
}
function closePanel(returnFocus) {
  displayPanel.hidden = true;
  displayBtn.setAttribute('aria-expanded', 'false');
  document.removeEventListener('keydown', onPanelKey, true);
  document.removeEventListener('click', onOutside, true);
  if (returnFocus) displayBtn.focus();
}
function onPanelKey(e) {
  if (e.key === 'Escape') { e.preventDefault(); closePanel(true); return; }
  if (e.key === 'Tab') { // simple focus trap
    const items = panelItems(); if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
    else if (!e.shiftKey && (i === items.length - 1)) { e.preventDefault(); items[0].focus(); }
  }
}
function onOutside(e) {
  if (!displayPanel.contains(e.target) && !displayBtn.contains(e.target)) closePanel(false);
}
displayBtn.addEventListener('click', () => (displayPanel.hidden ? openPanel() : closePanel(true)));
```
Note: the existing `themeToggle` click handler already toggles mood and lives above; it now sits inside the panel and keeps working unchanged.

- [ ] **Step 4: Verify keyboard + state + persistence**

With the app running and the browser MCP:
- Tab to "⚙ Display", press Enter → panel opens, focus lands on the first item; `aria-expanded="true"`.
- Tab cycles within the panel (focus trap); Esc closes and focus returns to the Display button.
- Activate High contrast → `data-contrast="high"` on `<html>`, `aria-checked="true"`, toast announces, palette flips; reload the page → still on (persisted).
- Activate Colorblind-safe → `data-cvd="safe"`, accent turns blue; reload → persists.
- Click outside the panel → it closes.

- [ ] **Step 5: Commit**
```bash
git add public/index.html public/app.js public/styles.css
git commit -m "Add High-Contrast + Colorblind-safe toggles in an accessible Display popover"
```

---

### Task 6: Cross-mode accessibility audit + hardening

**Files:**
- Modify (only if the audit finds issues): `public/styles.css`, `public/app.js`, `public/index.html`

**Interfaces:**
- Consumes: everything from Tasks 1-5.

- [ ] **Step 1: Screenshot every mode combination**

With the app running, capture screenshots for all six combinations via the browser MCP (toggle through the Display popover / attributes): {Nebula Night, Aurora Dawn} × {normal, High contrast, Colorblind-safe}. Confirm each is legible and on-theme.

- [ ] **Step 2: Run an automated accessibility audit**

Run a Lighthouse accessibility audit (chrome-devtools MCP `lighthouse_audit` with the accessibility category) or inject axe-core and run `axe.run()`, for at least: default dark, dark High-contrast, and light default. Expected: no serious/critical violations; all contrast checks pass. Record the results in the commit message or `docs/superpowers/`.

- [ ] **Step 3: Keyboard + motion pass**

- Keyboard-only: traverse tabs, form, entry actions, and the Display popover; confirm visible focus everywhere and logical order.
- Emulate `prefers-reduced-motion: reduce`: confirm starfield off, nebula frozen, equalizer at rest, no panel/tab transitions.
- Confirm the starfield pauses on a hidden tab and resumes on return.

- [ ] **Step 4: Regression smoke check**

Confirm core flows still work over the new theme: add an entry, edit it, switch tabs, generate an offline summary, and confirm the toast appears. (No server/DB changes were made, so this is a UI smoke test.)

- [ ] **Step 5: Fix any findings and re-verify**

If Steps 2-4 surfaced issues, fix them in the relevant file(s), re-run the specific check, and confirm it passes.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "Verify + harden galaxy theme: a11y audit, keyboard, reduced-motion, all-mode screenshots"
```

---

## Self-Review

**Spec coverage:**
- Three orthogonal axes + persistence → Task 1 (+ toggles Task 5). ✓
- Concrete palettes for every combination → Task 1 Step 3 (matches spec tables). ✓
- Mirror light-base/dark-layered structure → Task 1 Steps 1-2 + explicit-theme resolution Step 4. ✓
- Galaxy starfield (dark only) + nebula + glass + glow → Tasks 2 & 4. ✓
- Aurora Dawn (no starfield) → tokens (`--starfield-display:none` in `:root`) + gate. ✓
- Music motif (decorative, no audio) → Task 3. ✓
- Motion/contrast gating (reduced-motion + high-contrast stop everything; tab-hidden pause) → Task 3 Step 3, Task 4 gate + visibility, Task 1 high-contrast tokens. ✓
- High-Contrast + Colorblind-safe toggles, Display popover with focus trap/Esc/aria → Task 5. ✓
- WCAG AA / AAA-in-high-contrast, never color-alone, keyboard, SR (aria-hidden decoration, aria-checked toggles, toast) → Tasks 1/5 + verified Task 6. ✓
- Verification: screenshots all combos + axe/Lighthouse + keyboard + motion → Task 6. ✓
- No server/DB/journaling change → enforced by Global Constraints; only `public/*` and `test/starfield.test.js` touched. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code; verification steps name exact expected values/behaviors. ✓

**Type/name consistency:** `shouldAnimate({effectiveDark,highContrast,reducedMotion})` identical in test (Task 4 Step 1) and impl (Step 3); toggle ids (`#contrastToggle`,`#cvdToggle`,`#displayBtn`,`#displayPanel`) consistent across HTML (Task 5 Step 1) and JS (Step 3); token names consistent with Task 1 and the spec. ✓

## Notes / Risks

- Browser-driven verification needs the app running (`node server.js`) and a browser automation MCP (chrome-devtools or playwright). If neither is available in the execution environment, fall back to launching the app and having the human confirm the listed expectations.
- `backdrop-filter` has a `@supports` fallback to solid `--bg-elev`, so glass degrades gracefully.
- Only `public/*` and `test/starfield.test.js` change; the storage test suite must stay green (`npm test` runs both).

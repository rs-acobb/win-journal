# Win Journal — Galaxy + Music theme with accessibility toggles

**Date:** 2026-07-02
**Status:** Approved (design); implementation pending
**Goal:** Restyle the Win Journal front-end with a music + galaxy aesthetic that is WCAG 2.1 AA compliant and offers independent **High Contrast** and **Colorblind-safe** toggles, plus tasteful decorative effects. Presentation layer only — no changes to the server, DB, or journaling logic.

## Context

The existing front-end (`public/index.html`, `styles.css`, `app.js`) already has a solid base: CSS custom-property theme tokens, a light/dark toggle (`data-theme` + `localStorage['wj-theme']`, follows OS when unset), `prefers-reduced-motion` handling, `:focus-visible` rings, an `.sr-only` utility, and ARIA on tabs + a live-region toast. This work layers a galaxy/music aesthetic and two accessibility modes onto that token system without rewriting components.

## Decision: three orthogonal theme axes on `<html>`

All styling composes from three independent attributes, so every combination is valid and CSS stays declarative. Cascade order: **mood → colorblind → contrast** (contrast wins).

| Axis | Attribute | Values | Control | localStorage |
|---|---|---|---|---|
| Mood (aesthetic) | `data-theme` | `dark` = Nebula Night (default) · `light` = Aurora Dawn · unset = follow OS | 🌙/☀️ toggle (exists) | `wj-theme` (exists) |
| Contrast | `data-contrast` | `high` · unset | new "High Contrast" toggle | `wj-contrast` (new) |
| Color vision | `data-cvd` | `safe` · unset | new "Colorblind-safe" toggle | `wj-cvd` (new) |

Each layer only overrides `--token` values (and a couple of decoration flags). Components are unchanged; only tokens differ. Compound selectors (e.g. `:root[data-theme="light"][data-contrast="high"]`) give the right specificity; `[data-contrast="high"]` rules are authored **last** so they win over `[data-cvd="safe"]`.

## Token specification (concrete)

### Base — Nebula Night (`data-theme="dark"`, extends existing dark tokens)
Adds to the existing dark palette:
```
--space-0: #05060d;              /* deepest base behind the canvas */
--glass-bg: rgba(18,20,34,0.72); /* frosted card; #e8eaf2 on it ≈ 13:1 ✓ */
--glass-border: rgba(140,150,255,0.22);
--glow: 0 0 24px rgba(129,140,248,0.35);
--star-a: rgba(255,255,255,0.90); --star-b: rgba(190,200,255,0.80); --star-c: rgba(150,220,255,0.70);
--nebula-a: rgba(88,60,180,0.35); --nebula-b: rgba(30,90,160,0.30); --nebula-c: rgba(140,50,150,0.25);
--nebula-opacity: 1;
--starfield-display: block;
```

### Base — Aurora Dawn (`data-theme="light"`, extends existing light tokens)
```
--space-0: #eef1fb;
--glass-bg: rgba(255,255,255,0.74); /* #1f2330 on it ≈ 14:1 ✓ */
--glass-border: rgba(79,70,229,0.18);
--glow: 0 0 20px rgba(124,58,237,0.18);
--nebula-a: rgba(150,130,255,0.20); --nebula-b: rgba(120,200,220,0.18); --nebula-c: rgba(210,150,230,0.16);
--nebula-opacity: 1;
--starfield-display: none;   /* stars don't read on light; aurora gradients only */
```

### Colorblind-safe (`data-cvd="safe"`) — Okabe-Ito blue accent (unambiguous across deuteran/protan/tritan)
**Must mirror the base token structure:** light is the `:root` base; the **dark variant layers under the same conditions as the base dark tokens** — `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])[data-cvd="safe"]` **and** `:root[data-theme="dark"][data-cvd="safe"]`. This ensures a system-light user who hasn't picked a mood still gets the light-appropriate accent (never the light sky-blue on a pale background). The app uses a single accent (no categorical color coding), so one safe hue suffices; meaning never relies on color regardless.

- **Light (base, `:root[data-cvd="safe"]`):** `--accent:#0072B2; --accent-hover:#005a8c; --accent-contrast:#ffffff; --accent-soft:#d6ebf7; --accent-on-soft:#004e79; --ring:rgba(0,114,178,.55); --grad-a:#0072B2; --grad-b:#005a8c;` (white on `#0072B2` ≈ 4.8:1 ✓ AA)
- **Dark (variant, under the two dark conditions above):** `--accent:#56B4E9; --accent-hover:#7fc7ef; --accent-contrast:#05060d; --accent-soft:#10314a; --accent-on-soft:#9bd3f2; --ring:rgba(86,180,233,.60); --grad-a:#0072B2; --grad-b:#005a8c;` (dark text on `#56B4E9` ✓)

### High Contrast (`data-contrast="high"`) — AAA, decoration off, thick borders
**Authored last** so it wins over `[data-cvd="safe"]`, and **mirrors the base structure** (light base, dark variant layered under the same two dark conditions as the base dark tokens) so contrast is correct for system-light-unset users too. Both variants set `--glow:none; --nebula-opacity:0; --starfield-display:none;` and thicken borders (`--line`/`--glass-border` become the ink color).

- **Light (base, `:root[data-contrast="high"]`):** `--bg/--bg-elev/--bg-inset/--space-0/--glass-bg:#fff; --ink:#000; --muted:#1a1a1a; --line:#000; --glass-border:#000; --accent:#0000cc; --accent-contrast:#fff; --accent-hover:#0000a0; --accent-soft:#e6e6ff; --accent-on-soft:#0000a0; --ring:#0000cc; --grad-a/--grad-b:#fff;` — topbar becomes solid with a strong bottom border and black text (no gradient). (white on `#0000cc` ≈ 8.6:1 ✓)
- **Dark (variant, under the two dark conditions):** `--bg/--bg-elev/--bg-inset/--space-0/--glass-bg:#000; --ink:#fff; --muted:#e6e6e6; --line:#fff; --glass-border:#fff; --accent:#ffd400; --accent-contrast:#000; --accent-hover:#ffe34d; --accent-soft:#1a1a00; --accent-on-soft:#ffd400; --ring:#fff; --grad-a/--grad-b:#000;` (white on black 21:1; black on `#ffd400` ≈ 15:1 ✓)

High-contrast palettes are inherently colorblind-safe (black/white/yellow, black/white/blue), so when both toggles are on, high-contrast governs.

## Visual design & effects

- **Nebula Night:** fixed full-page `<canvas id="starfield" aria-hidden="true">` behind content — 3 parallax star layers (~120/80/50 stars, capped ≤ ~300 total, scaled to viewport, DPR-aware), twinkle via per-star opacity sine, slow layer drift + clamped mouse/scroll parallax; over it, CSS nebula = 2–3 large blurred radial-gradient blobs drifting on 60–120s keyframes at `--nebula-opacity`.
- **Aurora Dawn:** no canvas (`--starfield-display:none`); same nebula blobs in pale aurora hues.
- **Frosted-glass cards:** `background: var(--glass-bg); backdrop-filter: blur(12px) saturate(1.2);` with `--glass-border` and optional `--glow`. `@supports not (backdrop-filter: blur(1px))` fallback → solid `--bg-elev`. Card background alpha is high enough that `--ink` keeps ≥ 4.5:1 regardless of what's behind (text never sits directly on the animated field).
- **Music motif (decorative only, no audio):** a slim CSS equalizer bar strip (5–7 bars, `scaleY` keyframes phase-offset per bar to look audio-reactive) as a topbar accent; musical-note/constellation accent glyphs and "staff-line" dividers. All `aria-hidden`, `pointer-events:none`.
- **Micro-effects:** accent glow on primary buttons/focus, star twinkle, entry-card hover lift, tab-panel fade (already present).

## Performance & motion gating

- Starfield renderer uses `requestAnimationFrame`; **pauses on `visibilitychange` (hidden)**; star count capped and viewport-scaled; canvas sized to `devicePixelRatio`.
- **Starfield is active iff:** effective mood is dark **and** `data-contrast !== high` **and** `prefers-reduced-motion` is not set. Otherwise the canvas is hidden and a static CSS gradient stands in.
- Nebula + equalizer are pure CSS animations; the existing `@media (prefers-reduced-motion: reduce)` block already nulls all `animation`/`transition` — extend it to also set `--nebula-opacity` static and keep equalizer bars at rest.

## Accessibility requirements (acceptance criteria)

1. **Contrast:** all text and meaningful UI ≥ 4.5:1 (normal) / 3:1 (large/UI) in every mood; ≥ 7:1 in High Contrast. Verified by automated audit.
2. **Color independence:** no meaning by color alone (icons/text accompany; impact shows number + pips; tags are text).
3. **Motion:** `prefers-reduced-motion` **and** High Contrast each fully stop starfield, nebula drift, equalizer, and parallax.
4. **Keyboard:** every control (incl. new toggles and the Display menu) is reachable and operable by keyboard with visible focus; logical order preserved; existing ARIA tabs intact.
5. **Screen readers:** decorative canvas/equalizer are `aria-hidden`; toggles are `<button aria-pressed>` with descriptive `aria-label`; each toggle change announces via the existing `aria-live` toast (e.g., "High contrast on").
6. **Popover:** Display menu button has `aria-haspopup`/`aria-expanded`; opening moves focus into the menu; `Esc` closes and returns focus to the button; click-outside closes.

## Toggle UX — "Display" popover

The three *display* controls consolidate into one **"⚙ Display" menu button** in `.topbar-actions` (AI toggle stays separate to avoid crowding, especially on mobile). Popover contents: Mood (Dark/Light), High Contrast (switch), Colorblind-safe (switch). Focus-trapped, Esc-dismissable.

## Components / files

- **`public/starfield.js` (new)** — self-contained canvas renderer. Interface: `initStarfield()` returns `{ start(), stop(), destroy() }`; owns rAF, star generation, resize (DPR), parallax, and gating (reads `prefers-reduced-motion`, `data-contrast`, effective mood, tab visibility). One responsibility.
- **`public/app.js`** — add: High-Contrast + Colorblind toggle wiring (`applyContrast`/`applyCvd`: set attribute, persist, set `aria-pressed`, toast); Display popover open/close + focus management; and start/stop the starfield when mood/contrast changes. Reuse the existing `applyTheme` pattern and effective-dark computation.
- **`public/styles.css`** — bulk of the work: extend token layers (2 moods × cvd × high-contrast per the tables above), galaxy/aurora backgrounds, `.starfield` canvas, nebula blobs, glassmorphism (+`@supports` fallback), equalizer keyframes, glow, Display popover styles, high-contrast overrides, reduced-motion extensions.
- **`public/index.html`** — add `<canvas id="starfield" aria-hidden="true">`, the Display popover markup (menu button + panel with the three toggles), decorative equalizer/staff-line accents; load `starfield.js`. Preserve all existing semantics/ARIA.
- **No changes** to `server.js`, `storage.js`, `env.js`, or any journaling behavior. Theme applies across all four tabs (journal, summaries, resume, export).

## Verification

Front-end visual + a11y work, verified in a real browser via the available Chrome DevTools / Playwright MCP:
1. Drive the app; toggle every combination — {Night, Dawn} × {normal, high-contrast} × {normal, colorblind-safe} — and **screenshot each**.
2. Run an **automated accessibility audit** (axe/Lighthouse): target zero serious/critical violations; contrast passes in all modes.
3. Keyboard-only pass: tab order, Display popover focus trap + Esc, all toggles operable, focus visible.
4. Motion: emulate `prefers-reduced-motion` and confirm all animation stops; confirm High Contrast also stops it and hides the canvas; confirm the starfield pauses when the tab is hidden.
5. Confirm no regressions to existing flows (add/edit entry, tabs, summaries) — smoke check.

## Out of scope

Audio/soundtrack and audio-reactive visualizer; per-CVD-type palettes (deuteran/protan/tritan variants); any server/DB/journaling change; Phase-2 Vercel work (tracked separately).

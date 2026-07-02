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
      { count: 80, speed: 0.05, size: 1.6, varName: '--star-b' },
      { count: 50, speed: 0.09, size: 2.2, varName: '--star-c' },
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
          stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: L.size * (0.6 + Math.random() * 0.6),
            tw: Math.random() * Math.PI * 2,
            layer: li,
          });
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
    window.addEventListener('pointermove', (e) => {
      mx = (e.clientX / window.innerWidth - 0.5);
      my = (e.clientY / window.innerHeight - 0.5);
    });
    document.addEventListener('visibilitychange', sync);
    rm.addEventListener('change', sync);
    new MutationObserver(sync).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme', 'data-contrast'],
    });
    sync();
  })();
}

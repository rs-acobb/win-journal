'use strict';

// Pure gate: the backdrop animates only in dark mood, decoration on, motion allowed.
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
    const NOTES = ['♪', '♫', '♩', '♬', '♭'];
    const LAYERS = [
      { count: 90, speed: 0.02, size: 11, varName: '--star-a' },
      { count: 60, speed: 0.05, size: 15, varName: '--star-b' },
      { count: 40, speed: 0.09, size: 20, varName: '--star-c' },
    ];
    const MAX = 260;
    let notes = [], shooters = [], raf = 0, w = 0, h = 0, dpr = 1, mx = 0, my = 0, running = false, t = 0, nextShoot = 2;

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
      genNotes();
    }
    function genNotes() {
      notes = [];
      const scale = Math.min(1, (w * h) / (1440 * 900));
      LAYERS.forEach((L, li) => {
        const n = Math.min(Math.round(L.count * scale), MAX);
        for (let i = 0; i < n; i++) {
          notes.push({
            x: Math.random() * w,
            y: Math.random() * h,
            glyph: NOTES[Math.floor(Math.random() * NOTES.length)],
            fs: L.size * (0.7 + Math.random() * 0.6),
            tw: Math.random() * Math.PI * 2,
            layer: li,
          });
        }
      });
    }
    function spawnShooter() {
      const fromLeft = Math.random() < 0.5;
      const speed = (w + h) * 0.35;
      const angle = 0.15 + Math.random() * 0.25; // gentle downward slope
      shooters.push({
        x: fromLeft ? -60 : w + 60,
        y: Math.random() * h * 0.5,
        vx: (fromLeft ? 1 : -1) * speed * Math.cos(angle),
        vy: speed * Math.sin(angle),
        life: 0, max: 1.1,
      });
    }
    function draw(dt) {
      ctx.clearRect(0, 0, w, h);
      const cols = LAYERS.map((L) => tokenColor(L.varName));
      // drifting music notes
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const s of notes) {
        const L = LAYERS[s.layer];
        const px = mx * L.speed * 40, py = my * L.speed * 40;
        ctx.globalAlpha = 0.30 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + s.tw));
        ctx.fillStyle = cols[s.layer];
        ctx.font = s.fs.toFixed(1) + 'px serif';
        ctx.fillText(s.glyph, ((s.x + px + t * L.speed * 20) % w + w) % w, ((s.y + py) % h + h) % h);
      }
      // shooting stars with fading trail
      nextShoot -= dt;
      if (nextShoot <= 0) { spawnShooter(); nextShoot = 4 + Math.random() * 5; }
      for (const sh of shooters) { sh.x += sh.vx * dt; sh.y += sh.vy * dt; sh.life += dt; }
      shooters = shooters.filter((sh) => sh.life < sh.max && sh.x > -140 && sh.x < w + 140 && sh.y < h + 140);
      const head = cols[0];
      for (const sh of shooters) {
        const tx = sh.x - sh.vx * 0.16, ty = sh.y - sh.vy * 0.16;
        const grad = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
        grad.addColorStop(0, head);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.globalAlpha = Math.max(0, 1 - sh.life / sh.max) * 0.9 + 0.1;
        ctx.strokeStyle = grad; ctx.lineWidth = 2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sh.x, sh.y); ctx.stroke();
        ctx.fillStyle = head;
        ctx.beginPath(); ctx.arc(sh.x, sh.y, 2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function loop() { const dt = 0.016; t += dt; draw(dt); raf = requestAnimationFrame(loop); }
    function start() { if (running) return; running = true; nextShoot = 2; shooters = []; resize(); loop(); }
    function stop() { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; shooters = []; ctx.clearRect(0, 0, w, h); }
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

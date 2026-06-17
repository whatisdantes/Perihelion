// ============================================================
//  Варп-круиз: лёгкий оверлей радиальных световых штрихов.
//  Яркость/длина растут с интенсивностью (0 — выключено).
//  Тянется главным циклом анимации (warpFx.update(dt)).
// ============================================================

export function createWarpFX() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:15;pointer-events:none;opacity:0;transition:opacity .22s;';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  const N = 240;
  const streaks = [];
  for (let i = 0; i < N; i++) {
    streaks.push({ a: Math.random() * Math.PI * 2, r: Math.random(), w: 0.6 + Math.random() * 1.7, hue: 198 + Math.random() * 44 });
  }

  let intensity = 0, shown = false;
  function setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); }

  function update(dt) {
    const t = intensity;
    if (t < 0.02) {
      if (shown) { overlay.style.opacity = '0'; shown = false; ctx.clearRect(0, 0, W, H); }
      return;
    }
    if (!shown) { overlay.style.opacity = '1'; shown = true; }
    const cx = W / 2, cy = H / 2, maxR = Math.max(W, H) * 0.55;
    ctx.clearRect(0, 0, W, H);
    // лёгкое голубое свечение из центра
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    g.addColorStop(0, `rgba(150,190,255,${0.12 * t})`);
    g.addColorStop(1, 'rgba(0,0,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // радиальные штрихи, летящие из центра
    ctx.globalCompositeOperation = 'lighter';
    const spd = 0.5 + t * 2.6;
    for (const s of streaks) {
      s.r += spd * dt;
      if (s.r > 1.3) s.r -= 1.3;
      const rad = s.r * s.r * maxR;
      const len = (6 + t * 300) * (0.3 + s.r);
      const x1 = cx + Math.cos(s.a) * rad, y1 = cy + Math.sin(s.a) * rad;
      const x2 = cx + Math.cos(s.a) * (rad + len), y2 = cy + Math.sin(s.a) * (rad + len);
      ctx.strokeStyle = `hsla(${s.hue}, 90%, 72%, ${(0.1 + t * 0.55) * Math.min(1, s.r * 2)})`;
      ctx.lineWidth = s.w * (0.6 + t);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  return { update, setIntensity };
}

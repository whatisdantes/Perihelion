// ============================================================
//  Эффект прыжка через червоточину: туннель из световых
//  штрихов с финальной вспышкой (отбытие) и обратный
//  эффект-вспышка (прибытие). Чистый canvas 2D поверх сцены.
// ============================================================

function makeOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:300;pointer-events:none;';
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'width:100%;height:100%;display:block;';
  overlay.appendChild(canvas);
  document.body.appendChild(overlay);
  return { overlay, canvas, ctx: canvas.getContext('2d') };
}

function makeStreaks(n) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    arr.push({
      a: Math.random() * Math.PI * 2,
      r: Math.random(),
      w: 0.6 + Math.random() * 1.8,
      hue: 195 + Math.random() * 45,
    });
  }
  return arr;
}

// Отбытие: разгоняющийся туннель → белая вспышка → onDone()
export function wormholeTunnel(onDone) {
  const { overlay, canvas, ctx } = makeOverlay();
  const DUR = 1500;
  const streaks = makeStreaks(260);
  const t0 = performance.now();

  function frame(now) {
    const t = Math.min((now - t0) / DUR, 1);
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const speed = t * t;
    ctx.clearRect(0, 0, w, h);
    // лёгкое голубое свечение из центра
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.5);
    g.addColorStop(0, `rgba(150,190,255,${0.25 * speed})`);
    g.addColorStop(1, 'rgba(0,0,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // штрихи, летящие из центра
    ctx.globalCompositeOperation = 'lighter';
    for (const s of streaks) {
      s.r += 0.012 + speed * 0.1;
      if (s.r > 1.4) s.r = 0.02;
      const rad = s.r * s.r * Math.max(w, h) * 0.75;
      const len = (8 + speed * 340) * (0.4 + s.r);
      const x = cx + Math.cos(s.a) * rad, y = cy + Math.sin(s.a) * rad;
      const x2 = cx + Math.cos(s.a) * (rad + len), y2 = cy + Math.sin(s.a) * (rad + len);
      ctx.strokeStyle = `hsla(${s.hue}, 90%, ${65 + speed * 30}%, ${0.22 + speed * 0.6})`;
      ctx.lineWidth = s.w + speed * 2.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (t > 0.72) {
      ctx.fillStyle = `rgba(255,255,255,${(((t - 0.72) / 0.28) ** 1.6).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    if (t < 1) requestAnimationFrame(frame);
    else onDone();
  }
  requestAnimationFrame(frame);
}

// Прибытие: белая вспышка гаснет, штрихи схлопываются к центру
export function wormholeArrival() {
  const { overlay, canvas, ctx } = makeOverlay();
  const DUR = 1400;
  const streaks = makeStreaks(180);
  const t0 = performance.now();

  function frame(now) {
    const t = Math.min((now - t0) / DUR, 1);
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const calm = 1 - t;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const s of streaks) {
      s.r -= 0.008 + calm * 0.06;
      if (s.r < 0.02) s.r = 1.2;
      const rad = s.r * s.r * Math.max(w, h) * 0.75;
      const len = (6 + calm * 200) * (0.4 + s.r);
      const x = cx + Math.cos(s.a) * rad, y = cy + Math.sin(s.a) * rad;
      const x2 = cx + Math.cos(s.a) * (rad + len), y2 = cy + Math.sin(s.a) * (rad + len);
      ctx.strokeStyle = `hsla(${s.hue}, 90%, 75%, ${(0.55 * calm * calm).toFixed(3)})`;
      ctx.lineWidth = s.w * (0.5 + calm);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    // гаснущая вспышка
    ctx.fillStyle = `rgba(255,255,255,${(calm ** 1.8).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    if (t < 1) requestAnimationFrame(frame);
    else overlay.remove();
  }
  requestAnimationFrame(frame);
}

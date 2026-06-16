// ============================================================
//  Процедурная генерация текстур (canvas, без внешних файлов)
// ============================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Решётчатый value-noise, периодический по X (чтобы текстура сферы не имела шва)
function makeNoise(seed) {
  const rand = mulberry32(seed);
  const S = 256;
  const grid = new Float32Array(S * S);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();

  function lattice(ix, iy, px) {
    ix = ((ix % px) + px) % px;
    iy = ((iy % S) + S) % S;
    return grid[(iy & 255) * S + (ix & 255)];
  }
  // x ∈ [0, px), y — любое
  function noise(x, y, px) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = lattice(ix, iy, px), b = lattice(ix + 1, iy, px);
    const c = lattice(ix, iy + 1, px), d = lattice(ix + 1, iy + 1, px);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, px, oct = 4, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < oct; o++) {
      sum += noise(x * f, y * f, px * f) * amp;
      norm += amp; amp *= gain; f *= 2;
    }
    return sum / norm;
  }
  return { rand, noise, fbm };
}

function hex2rgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lerpC(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}
// Градиентная рампа: stops = [[t, '#hex'], ...]
function makeRamp(stops) {
  const s = stops.map(([t, h]) => [t, hex2rgb(h)]);
  return function (t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < s.length - 1; i++) {
      if (t <= s[i + 1][0]) {
        const k = (t - s[i][0]) / (s[i + 1][0] - s[i][0] || 1);
        return lerpC(s[i][1], s[i + 1][1], k);
      }
    }
    return s[s.length - 1][1];
  };
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Базовый проход: цвет каждого пикселя из функции f(nx, ny, helpers)
function paintPixels(w, h, freq, seed, f) {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const nz = makeNoise(seed);
  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const col = f(nx, ny, nz, freq);
      const i = (y * w + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2];
      d[i + 3] = col.length > 3 ? col[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Кратеры поверх готового canvas (с заворачиванием по X)
function addCraters(canvas, seed, count, minR, maxR, strength = 1) {
  const ctx = canvas.getContext('2d');
  const rand = mulberry32(seed);
  const w = canvas.width, h = canvas.height;
  for (let i = 0; i < count; i++) {
    const r = minR + rand() * rand() * (maxR - minR);
    const cx = rand() * w;
    const cy = h * 0.06 + rand() * h * 0.88;
    const dark = 0.16 + rand() * 0.22;
    for (const ox of [-w, 0, w]) {
      // тёмная чаша
      let g = ctx.createRadialGradient(cx + ox, cy, 0, cx + ox, cy, r);
      g.addColorStop(0, `rgba(0,0,0,${(dark * strength).toFixed(3)})`);
      g.addColorStop(0.75, `rgba(0,0,0,${(dark * 0.5 * strength).toFixed(3)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx + ox, cy, r, 0, Math.PI * 2); ctx.fill();
      // светлый вал
      ctx.strokeStyle = `rgba(255,250,240,${(0.10 + rand() * 0.12) * strength})`;
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath(); ctx.arc(cx + ox, cy, r * 0.92, -2.4 + rand(), 0.6 + rand()); ctx.stroke();
    }
  }
}

// ──────────────────────── генераторы тел ────────────────────────

function rocky({ seed, ramp, freq = 6, oct = 5, craters = 0, crMax = 26, mottle = 0, size = 512 }) {
  const w = size, h = size / 2;
  const r = makeRamp(ramp);
  const c = paintPixels(w, h, freq, seed, (nx, ny, nz, f) => {
    let v = nz.fbm(nx * f, ny * f * 0.55, f, oct);
    if (mottle) v = v * (1 - mottle) + mottle * nz.fbm(nx * f * 4, ny * f * 2.2, f * 4, 3);
    return r(v);
  });
  if (craters) addCraters(c, seed + 7, craters, 2, crMax);
  return c;
}

function texMercury() {
  return rocky({
    seed: 101, freq: 7, craters: 300, crMax: 22, mottle: 0.35,
    ramp: [[0, '#4f463e'], [0.35, '#6e6259'], [0.6, '#8d8076'], [0.8, '#a59a8e'], [1, '#c2b8ac']],
  });
}

function texVenus() {
  const w = 1024, h = 512;
  const ramp = makeRamp([[0, '#9a6f33'], [0.3, '#c4934e'], [0.55, '#e0b878'], [0.75, '#efd5a4'], [1, '#fbf0d4']]);
  return paintPixels(w, h, 6, 202, (nx, ny, nz, f) => {
    const warp = nz.fbm(nx * f, ny * f, f, 4) * 1.6;
    const v = nz.fbm(nx * f * 0.8 + warp, ny * f * 2.4 + warp * 0.5, f * 0.8, 5);
    const band = 0.5 + 0.5 * Math.sin(ny * Math.PI * 5 + warp * 3.5);
    return ramp(v * 0.65 + band * 0.35);
  });
}

// Земля: единая карта суши → день, ночь, облака
let earthCache = null;
function earthMaps() {
  if (earthCache) return earthCache;
  const w = 1024, h = 512;
  const nz = makeNoise(303);
  const f = 5;
  const land = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const warp = nz.fbm(nx * f * 2, ny * f * 2, f * 2, 3) * 0.45;
      let v = nz.fbm(nx * f + warp, ny * f * 0.55 + warp, f, 6, 0.52);
      // меньше суши у полюсов-океанов не нужно; чуть больше континентов в средних широтах
      land[y * w + x] = v;
    }
  }
  const TH = 0.553; // порог суши

  // ---- День ----
  const day = canvasOf(w, h);
  {
    const ctx = day.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const ocean = makeRamp([[0, '#06203f'], [0.5, '#0a3260'], [0.85, '#11487f'], [1, '#1d639f']]);
    const ground = makeRamp([[0, '#2c5e2e'], [0.35, '#3c7a3a'], [0.55, '#6f9a44'], [0.72, '#a8a05c'], [0.88, '#9b7e4e'], [1, '#8a6a42']]);
    for (let y = 0; y < h; y++) {
      const ny = y / h;
      const lat = Math.abs(ny - 0.5) * 2; // 0 экватор … 1 полюс
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const v = land[y * w + x];
        let col;
        if (v > TH) {
          const t = nz.fbm(nx * 14, ny * 8, 14, 3);
          col = ground(t);
          // пустыни ближе к экватору, тундра к полюсам
          if (lat < 0.25) col = lerpC(col, [196, 168, 96], 0.35 * (1 - lat / 0.25) * t);
          if (lat > 0.62) col = lerpC(col, [225, 228, 232], (lat - 0.62) / 0.38 * 0.85);
        } else {
          const depth = (TH - v) / TH;
          col = ocean(1 - Math.min(1, depth * 2.4));
          // мелководье у берега
          if (TH - v < 0.012) col = lerpC(col, [60, 160, 180], 0.5);
        }
        // полярные шапки
        if (lat > 0.88) col = lerpC(col, [240, 246, 252], Math.min(1, (lat - 0.88) / 0.09));
        const i = (y * w + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---- Ночь (огни городов) ----
  const night = canvasOf(w, h);
  {
    const ctx = night.getContext('2d');
    ctx.fillStyle = '#010208';
    ctx.fillRect(0, 0, w, h);
    const rand = mulberry32(909);
    let placed = 0, guard = 0;
    while (placed < 260 && guard++ < 20000) {
      const x = Math.floor(rand() * w), y = Math.floor(h * 0.12 + rand() * h * 0.76);
      if (land[y * w + x] <= TH + 0.004) continue;
      placed++;
      const big = rand();
      const R = 2 + big * big * 7;
      for (const ox of [-w, 0, w]) {
        const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, R * 2.2);
        g.addColorStop(0, `rgba(255,196,110,${0.55 + big * 0.4})`);
        g.addColorStop(0.4, 'rgba(255,170,80,0.25)');
        g.addColorStop(1, 'rgba(255,150,60,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x + ox, y, R * 2.2, 0, Math.PI * 2); ctx.fill();
      }
      // россыпь пригородов
      const n = 3 + Math.floor(rand() * 10);
      ctx.fillStyle = 'rgba(255,200,120,0.8)';
      for (let k = 0; k < n; k++) {
        const dx = (rand() - 0.5) * R * 6, dy = (rand() - 0.5) * R * 3;
        const xx = x + dx, yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        if (land[Math.floor(yy) * w + ((Math.floor(xx) + w) % w)] > TH)
          ctx.fillRect((xx + w) % w, yy, 1.2, 1.2);
      }
    }
  }

  // ---- Облака (альфа) ----
  const clouds = paintPixels(w, h, 6, 404, (nx, ny, nz2, f2) => {
    const warp = nz2.fbm(nx * f2 * 1.5, ny * f2 * 1.5, f2 * 1.5, 3) * 0.8;
    let v = nz2.fbm(nx * f2 + warp, ny * f2 * 0.9 + warp * 0.4, f2, 5, 0.55);
    let a = Math.max(0, (v - 0.52) / 0.30);
    a = Math.min(1, a) * 0.92;
    return [255, 255, 255, Math.round(a * 255)];
  });

  earthCache = { day, night, clouds };
  return earthCache;
}

function texMars() {
  const w = 1024, h = 512;
  const ramp = makeRamp([[0, '#5f2a14'], [0.3, '#90431f'], [0.55, '#b65a2a'], [0.75, '#cf7440'], [1, '#e8a06a']]);
  const c = paintPixels(w, h, 6, 505, (nx, ny, nz, f) => {
    const warp = nz.fbm(nx * f * 2, ny * f * 2, f * 2, 3) * 0.5;
    let v = nz.fbm(nx * f + warp, ny * f * 0.6 + warp, f, 5);
    // тёмные базальтовые «моря»
    const dark = nz.fbm(nx * 3 + 9, ny * 2.2, 3, 3);
    if (dark > 0.62) v *= 0.55;
    let col = ramp(v);
    const lat = Math.abs(ny - 0.5) * 2;
    const capEdge = 0.86 + nz.noise(nx * 20, 3.5, 20) * 0.06;
    if (lat > capEdge) col = lerpC(col, [245, 240, 235], Math.min(1, (lat - capEdge) / 0.06));
    return col;
  });
  addCraters(c, 506, 90, 2, 14, 0.7);
  return c;
}

function banded({ seed, stops, bandFreq, turb, spot, size = 1024 }) {
  const w = size, h = size / 2;
  const ramp = makeRamp(stops);
  const c = paintPixels(w, h, 8, seed, (nx, ny, nz, f) => {
    const warp = nz.fbm(nx * f, ny * f * 2, f, 4) - 0.5;
    const yy = ny + warp * turb;
    const band = 0.5 + 0.5 * Math.sin(yy * Math.PI * bandFreq + Math.sin(yy * Math.PI * bandFreq * 0.37) * 2);
    const detail = nz.fbm(nx * f * 2, ny * f * 5, f * 2, 4) - 0.5;
    return ramp(Math.max(0, Math.min(1, band * 0.78 + 0.5 * 0.22 + detail * 0.25)));
  });
  if (spot) {
    const ctx = c.getContext('2d');
    const { x, y, rx, ry, color, ringColor } = spot;
    for (const ox of [-w, 0, w]) {
      ctx.save();
      ctx.translate(x * w + ox, y * h);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * w);
      g.addColorStop(0, color);
      g.addColorStop(0.55, color.replace(/[\d.]+\)$/, '0.75)'));
      g.addColorStop(0.8, ringColor);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.scale(1, ry / rx);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, rx * w, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  return c;
}

function texJupiter() {
  return banded({
    seed: 606, bandFreq: 11, turb: 0.05,
    stops: [[0, '#7d5a3c'], [0.22, '#a87c54'], [0.4, '#d9b28a'], [0.55, '#ecd9bd'], [0.7, '#c9986a'], [0.85, '#e6cfae'], [1, '#9a6f49']],
    spot: { x: 0.7, y: 0.63, rx: 0.055, ry: 0.034, color: 'rgba(196,90,52,0.95)', ringColor: 'rgba(230,200,170,0.4)' },
  });
}

function texSaturn() {
  return banded({
    seed: 707, bandFreq: 9, turb: 0.03,
    stops: [[0, '#a3814e'], [0.25, '#c8a86e'], [0.5, '#e2c898'], [0.7, '#efddb4'], [0.85, '#d3b079'], [1, '#b89058']],
  });
}

function texUranus() {
  return banded({
    seed: 808, bandFreq: 6, turb: 0.02, size: 512,
    stops: [[0, '#76b9c4'], [0.4, '#93d2da'], [0.6, '#a8e0e6'], [0.8, '#9ed8e0'], [1, '#c4ecf0']],
  });
}

function texNeptune() {
  return banded({
    seed: 909, bandFreq: 7, turb: 0.05, size: 512,
    stops: [[0, '#23368f'], [0.3, '#3052b4'], [0.55, '#3f6cd0'], [0.75, '#5b86e0'], [1, '#7fa6ec']],
    spot: { x: 0.32, y: 0.42, rx: 0.06, ry: 0.04, color: 'rgba(16,28,90,0.85)', ringColor: 'rgba(120,160,240,0.3)' },
  });
}

function texMoon() {
  return rocky({
    seed: 111, freq: 6, craters: 380, crMax: 26, mottle: 0.3,
    ramp: [[0, '#55524e'], [0.35, '#73706b'], [0.6, '#8f8c86'], [0.8, '#a8a59e'], [1, '#c4c1ba']],
  });
}

function texIo() {
  const w = 512, h = 256;
  const ramp = makeRamp([[0, '#8c5a14'], [0.3, '#c89020'], [0.55, '#e6c84a'], [0.75, '#f2e088'], [1, '#faf0c0']]);
  const c = paintPixels(w, h, 6, 222, (nx, ny, nz, f) => {
    const v = nz.fbm(nx * f, ny * f * 0.6, f, 5);
    return ramp(v);
  });
  // вулканические пятна
  const ctx = c.getContext('2d');
  const rand = mulberry32(223);
  for (let i = 0; i < 46; i++) {
    const x = rand() * w, y = h * 0.1 + rand() * h * 0.8, R = 3 + rand() * 12;
    const hot = rand() > 0.45;
    for (const ox of [-w, 0, w]) {
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, R);
      if (hot) {
        g.addColorStop(0, 'rgba(60,20,8,0.95)');
        g.addColorStop(0.45, 'rgba(180,70,20,0.7)');
        g.addColorStop(1, 'rgba(230,140,40,0)');
      } else {
        g.addColorStop(0, 'rgba(250,250,245,0.9)');
        g.addColorStop(1, 'rgba(250,250,245,0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x + ox, y, R, 0, Math.PI * 2); ctx.fill();
    }
  }
  return c;
}

function texEuropa() {
  const w = 512, h = 256;
  const c = paintPixels(w, h, 5, 333, (nx, ny, nz, f) => {
    const v = nz.fbm(nx * f, ny * f * 0.6, f, 4);
    return lerpC([214, 200, 178], [240, 236, 226], v);
  });
  // линии-трещины
  const ctx = c.getContext('2d');
  const rand = mulberry32(334);
  for (let i = 0; i < 70; i++) {
    const y0 = rand() * h, amp = (rand() - 0.5) * 90, ph = rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(${150 + rand() * 40 | 0},${90 + rand() * 35 | 0},${55 + rand() * 30 | 0},${0.25 + rand() * 0.4})`;
    ctx.lineWidth = 0.6 + rand() * 1.8;
    ctx.beginPath();
    for (let x = -10; x <= w + 10; x += 8) {
      const y = y0 + Math.sin(x / w * Math.PI * (1 + rand() * 0.08) * 2 + ph) * amp * 0.25 + (rand() - 0.5) * 4;
      x === -10 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function texGanymede() {
  return rocky({
    seed: 444, freq: 5, craters: 120, crMax: 16, mottle: 0.4,
    ramp: [[0, '#5a5044'], [0.35, '#766a5a'], [0.6, '#968a78'], [0.8, '#b0a695'], [1, '#cfc6b6']],
  });
}

function texCallisto() {
  return rocky({
    seed: 555, freq: 7, craters: 420, crMax: 14, mottle: 0.45,
    ramp: [[0, '#3e3830'], [0.4, '#5a5248'], [0.65, '#736a5e'], [0.85, '#8d8478'], [1, '#a89f92']],
  });
}

function texEnceladus() {
  const w = 512, h = 256;
  const c = paintPixels(w, h, 5, 666, (nx, ny, nz, f) => {
    const v = nz.fbm(nx * f, ny * f * 0.6, f, 4);
    return lerpC([222, 234, 242], [250, 253, 255], v);
  });
  // «тигровые полосы» юга
  const ctx = c.getContext('2d');
  const rand = mulberry32(667);
  ctx.strokeStyle = 'rgba(110,160,190,0.5)';
  for (let i = 0; i < 5; i++) {
    ctx.lineWidth = 1.5 + rand() * 2;
    ctx.beginPath();
    const y0 = h * (0.82 + rand() * 0.1);
    ctx.moveTo(0, y0);
    for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y0 + Math.sin(x / 40 + i) * 6);
    ctx.stroke();
  }
  return c;
}

function texTitan() {
  const w = 512, h = 256;
  const ramp = makeRamp([[0, '#a3651e'], [0.4, '#c8862e'], [0.7, '#dfa345'], [1, '#efc06a']]);
  return paintPixels(w, h, 4, 777, (nx, ny, nz, f) => {
    const v = nz.fbm(nx * f, ny * f * 0.8, f, 4);
    const haze = 0.5 + 0.5 * Math.sin((ny - 0.5) * Math.PI);
    return ramp(v * 0.4 + 0.3 + haze * 0.18);
  });
}

function texTriton() {
  const w = 512, h = 256;
  const c = paintPixels(w, h, 6, 888, (nx, ny, nz, f) => {
    const v = nz.fbm(nx * f, ny * f * 0.7, f, 5);
    let col = lerpC([198, 178, 168], [236, 228, 222], v);
    if (ny > 0.62) col = lerpC(col, [248, 240, 230], (ny - 0.62) * 1.6); // южная азотная шапка
    return col;
  });
  addCraters(c, 889, 40, 2, 8, 0.45);
  return c;
}

function texPluto() {
  const w = 512, h = 256;
  const ramp = makeRamp([[0, '#6e4f36'], [0.35, '#9a7350'], [0.6, '#c09a72'], [0.8, '#d9bd97'], [1, '#efe0c4']]);
  const c = paintPixels(w, h, 6, 990, (nx, ny, nz, f) => {
    let v = nz.fbm(nx * f, ny * f * 0.6, f, 5);
    // светлое «сердце» — равнина Спутника
    const dx = (nx - 0.62), dy = (ny - 0.55) * 2;
    const heart = Math.exp(-(dx * dx * 60 + dy * dy * 18));
    v = v * (1 - heart) + heart * 0.95;
    return ramp(v);
  });
  addCraters(c, 991, 50, 2, 9, 0.4);
  return c;
}

const texCharon = () => rocky({
  seed: 992, freq: 6, craters: 90, crMax: 10, mottle: 0.35,
  ramp: [[0, '#56504a'], [0.4, '#787068'], [0.7, '#9a9088'], [1, '#bdb2a8']],
});
const texPhobos = () => rocky({
  seed: 117, freq: 7, craters: 60, crMax: 30, mottle: 0.5, size: 256,
  ramp: [[0, '#433b34'], [0.5, '#5e544a'], [1, '#8a7d70']],
});
const texDeimos = () => rocky({
  seed: 118, freq: 6, craters: 30, crMax: 22, mottle: 0.5, size: 256,
  ramp: [[0, '#4a4239'], [0.5, '#6a5f52'], [1, '#968878']],
});
const texMiranda = () => rocky({
  seed: 119, freq: 8, craters: 50, crMax: 14, mottle: 0.55, size: 256,
  ramp: [[0, '#5e6670'], [0.5, '#8a929c'], [1, '#c2c8d0']],
});
const texTitania = () => rocky({
  seed: 120, freq: 6, craters: 80, crMax: 12, mottle: 0.4, size: 256,
  ramp: [[0, '#4e4c4e'], [0.5, '#76737a'], [1, '#a5a2a8']],
});
const texCeres = () => rocky({
  seed: 121, freq: 7, craters: 160, crMax: 14, mottle: 0.45, size: 256,
  ramp: [[0, '#4c4742'], [0.5, '#6e6862'], [1, '#9a938c']],
});

// ──────────────────────── кольца ────────────────────────

function texSaturnRings() {
  const w = 1024, h = 64;
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const nz = makeNoise(1234);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let x = 0; x < w; x++) {
    const t = x / w; // 0 — внутренний край, 1 — внешний
    let a = 0.15 + nz.fbm(t * 60, 0.5, 60, 4) * 0.9;
    // структура колец: C (тусклое), B (яркое), щель Кассини, A
    if (t < 0.18) a *= 0.35;                                  // кольцо C
    else if (t < 0.55) a *= 1.05;                              // кольцо B
    else if (t < 0.62) a *= 0.06;                              // щель Кассини
    else if (t < 0.92) a *= 0.85;                              // кольцо A
    else if (t < 0.945) a *= 0.12;                             // щель Энке
    else a *= 0.55;
    a *= 0.55 + nz.noise(t * 220, 1.5, 220) * 0.7;
    a = Math.max(0, Math.min(1, a));
    const tone = 0.75 + nz.noise(t * 120, 7.5, 120) * 0.3;
    const r = 226 * tone, g = 205 * tone, b = 170 * tone;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function texUranusRings() {
  const w = 512, h = 32;
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d');
  const nz = makeNoise(4321);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let x = 0; x < w; x++) {
    const t = x / w;
    let a = 0;
    // несколько узких колечек
    for (const [pos, wd, str] of [[0.15, 0.02, 0.5], [0.35, 0.015, 0.4], [0.55, 0.02, 0.45], [0.8, 0.045, 0.9], [0.92, 0.02, 0.5]]) {
      a += str * Math.exp(-((t - pos) ** 2) / (wd * wd));
    }
    a *= 0.7 + nz.noise(t * 100, 0.5, 100) * 0.4;
    a = Math.min(1, a);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      d[i] = 160; d[i + 1] = 185; d[i + 2] = 200; d[i + 3] = a * 200;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ──────────────────────── спрайты ────────────────────────

// Мягкое радиальное свечение (гало Солнца, маркеры)
export function spriteGlow(colorIn, colorMid, size = 256) {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, colorIn);
  g.addColorStop(0.25, colorMid);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// Кольцо выделения
export function spriteSelectionRing(size = 256) {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const r = size * 0.42;
  ctx.strokeStyle = 'rgba(130,200,255,0.9)';
  ctx.lineWidth = size * 0.015;
  ctx.setLineDash([r * 0.5, r * 0.28]);
  ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(130,200,255,0.35)';
  ctx.lineWidth = size * 0.05;
  ctx.beginPath(); ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2); ctx.stroke();
  return c;
}

// Мягкая звезда для Points
export function spriteStar(size = 64) {
  const c = canvasOf(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

// ──────────────────────── реестр ────────────────────────

const REGISTRY = {
  mercury: texMercury, venus: texVenus, mars: texMars,
  jupiter: texJupiter, saturn: texSaturn, uranus: texUranus, neptune: texNeptune,
  moon: texMoon, io: texIo, europa: texEuropa, ganymede: texGanymede, callisto: texCallisto,
  enceladus: texEnceladus, titan: texTitan, triton: texTriton,
  pluto: texPluto, charon: texCharon, phobos: texPhobos, deimos: texDeimos,
  miranda: texMiranda, titania: texTitania, ceres: texCeres,
  saturnRings: texSaturnRings, uranusRings: texUranusRings,
};

const cache = new Map();
export function getTextureCanvas(name) {
  if (name === 'earth') return earthMaps();
  if (!cache.has(name)) cache.set(name, REGISTRY[name]());
  return cache.get(name);
}

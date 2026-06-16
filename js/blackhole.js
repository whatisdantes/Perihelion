// ============================================================
//  Гаргантюа — чёрная дыра из к/ф «Интерстеллар»
//  Полноэкранный шейдер: трассировка лучей с интегрированием
//  нулевых геодезических в метрике Шварцшильда (приближение):
//  d²x/dλ² = −(3/2)·h²·x/r⁵, h = |x×v| — сохраняется.
//  Так получаются: тень горизонта, фотонное кольцо,
//  линзированные арки диска и кольцо Эйнштейна — как в фильме.
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { wormholeTunnel, wormholeArrival } from './wormhole-fx.js';

// ───────────────────────── рендерер ─────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// камера-«пилот» (ей управляет OrbitControls; в шейдер идут её позиция и базис)
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.1, 16.5);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.enablePan = false;
controls.minDistance = 3.2;
controls.maxDistance = 55;
controls.target.set(0, 0, 0);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ───────────────────────── шейдер ─────────────────────────
const uniforms = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uCamPos: { value: new THREE.Vector3() },
  uCamBasis: { value: new THREE.Matrix3() },
  uTanFov: { value: Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) },
  uTime: { value: 0 },
  uDoppler: { value: 1 },
  uJets: { value: 0 },
  uPlanet: { value: 1 },
  uPlanetPos: { value: new THREE.Vector3(8.6, 1.05, 0) },
  uWormPos: { value: new THREE.Vector3(15.5, 4.5, -12.5) },
  uWormR: { value: 1.35 },
};

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform mat3 uCamBasis;
uniform float uTanFov;
uniform float uTime;
uniform float uDoppler;
uniform float uJets;
uniform float uPlanet;
uniform vec3 uPlanetPos;
uniform vec3 uWormPos;
uniform float uWormR;

#define STEPS 260
const float EH       = 1.0;    // горизонт событий (r_s = 1)
const float DISK_IN  = 2.35;   // внутренняя кромка диска
const float DISK_OUT = 13.0;
const float FAR      = 27.0;   // дальше лучи считаем прямыми
const float PLANET_R = 0.32;

// ---------- шум ----------
float hash13(vec3 p){
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1,0,0));
  float n010 = hash13(i + vec3(0,1,0));
  float n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1));
  float n101 = hash13(i + vec3(1,0,1));
  float n011 = hash13(i + vec3(0,1,1));
  float n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y),
             mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p){
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.3; a *= 0.5; }
  return s;
}

// ---------- звёздный фон (искажается линзированием сам собой) ----------
vec3 stars(vec3 d){
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float scale = l == 0 ? 95.0 : 48.0;
    vec3 q = d * scale;
    vec3 cell = floor(q);
    float h = hash13(cell);
    if (h > 0.93) {
      vec3 center = cell + 0.5 + (vec3(hash13(cell + 1.3), hash13(cell + 2.7), hash13(cell + 4.1)) - 0.5) * 0.75;
      float dc = length(q - center);
      float b = (h - 0.93) / 0.07;
      float star = pow(max(0.0, 1.0 - dc * 2.1), 7.0) * (0.25 + b * 1.7);
      vec3 tint = mix(vec3(1.0, 0.92, 0.8), vec3(0.75, 0.85, 1.0), hash13(cell + 7.7));
      col += tint * star * (l == 0 ? 1.0 : 0.5);
    }
  }
  vec3 bn = normalize(vec3(0.32, 1.0, 0.22));
  float band = pow(max(0.0, 1.0 - abs(dot(d, bn)) * 1.9), 2.6);
  col += vec3(0.5, 0.45, 0.52) * band * (0.05 + fbm(d * 3.1) * 0.08);
  return col;
}

// ---------- «домашнее» небо в червоточине ----------
vec3 solarSky(vec3 d){
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    vec3 q = d * (l == 0 ? 44.0 : 88.0) + 51.0 + float(l) * 9.0;
    vec3 cell = floor(q);
    float h = hash13(cell);
    if (h > 0.8) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 5.2), hash13(cell + 9.1), hash13(cell + 3.3)) - 0.5) * 0.7;
      float star = pow(max(0.0, 1.0 - length(q - c) * 1.7), 5.0) * (h - 0.8) * 15.0;
      col += vec3(0.95, 0.97, 1.0) * star;
    }
  }
  // наше Солнце — тёплая искра в тоннеле
  vec3 sd = normalize(vec3(-0.45, 0.18, -0.88));
  float s = max(dot(d, sd), 0.0);
  col += vec3(1.0, 0.88, 0.6) * (pow(s, 600.0) * 5.0 + pow(s, 24.0) * 0.5);
  col += vec3(0.3, 0.42, 0.62) * fbm(d * 2.6) * 0.06;
  return col;
}

// ---------- аккреционный диск ----------
vec4 diskShade(vec3 hit, vec3 vdir){
  float r = length(hit.xz);
  float ang = atan(hit.z, hit.x);
  // дифференциальное (кеплеровское) вращение
  float w = 1.55 / pow(r, 1.5);
  float a2 = ang - uTime * w;
  vec3 q = vec3(log(r) * 5.5, cos(a2) * 2.4, sin(a2) * 2.4);
  float s = fbm(q) * 0.62 + fbm(q * 2.6 + 17.0) * 0.38;
  s = s * 0.78 + 0.22 * vnoise(vec3(log(r) * 24.0, cos(a2) * 1.3, sin(a2) * 1.3));

  float br = pow(DISK_IN / r, 2.1);
  float fadeIn  = smoothstep(DISK_IN, DISK_IN + 0.45, r);
  float fadeOut = 1.0 - smoothstep(DISK_OUT - 4.2, DISK_OUT, r);
  float dens = smoothstep(0.16, 0.62, s + br * 0.22);
  float alpha = clamp(dens * fadeIn * fadeOut, 0.0, 0.95);

  float tr = smoothstep(DISK_IN, 8.0, r);
  vec3 cHot = vec3(1.45, 1.38, 1.22);
  vec3 cMid = vec3(1.35, 0.92, 0.55);
  vec3 cOut = vec3(0.82, 0.46, 0.25);
  vec3 col = mix(cHot, mix(cMid, cOut, smoothstep(0.3, 1.0, tr)), smoothstep(0.0, 0.4, tr));
  float B = (0.5 + 3.6 * br) * (0.5 + s * 1.0);

  if (uDoppler > 0.5) {
    // релятивистское усиление: сторона диска, летящая на нас, ярче и белее
    float beta = sqrt(0.5 / max(r - 0.8, 1.25));
    vec3 vel = normalize(vec3(-hit.z, 0.0, hit.x));
    float g = 1.0 / sqrt(1.0 - beta * beta);
    float dop = 1.0 / (g * (1.0 + beta * dot(vel, vdir)));
    B *= pow(dop, 2.6);
    float ts = clamp((dop - 1.0) * 1.3, -0.55, 0.55);
    col *= vec3(1.0 - ts * 0.32, 1.0 + ts * 0.04, 1.0 + ts * 0.5);
  }
  // гравитационное красное смещение приглушает внутреннюю кромку
  B *= 0.35 + 0.65 * sqrt(max(1.0 - 1.0 / max(r, 1.05), 0.0));
  B = min(B, 3.8); // ограничение HDR, чтобы bloom не заливал тень
  return vec4(col * B, alpha);
}

// ---------- джеты (в фильме их нет — включаются тумблером) ----------
vec3 jetEmit(vec3 p, float dt){
  float ay = abs(p.y);
  if (ay < 1.0 || ay > 14.0) return vec3(0.0);
  float rxz = length(p.xz);
  float jr = 0.10 + ay * 0.13;
  float x = rxz / jr;
  if (x > 1.0) return vec3(0.0);
  float core = 1.0 - x;
  float n = 0.55 + 0.85 * vnoise(vec3(p.y * 1.7 - uTime * 6.0 * sign(p.y), atan(p.z, p.x) * 1.5, ay * 0.3));
  float fade = smoothstep(1.0, 2.4, ay) * (1.0 - smoothstep(8.0, 14.0, ay));
  return vec3(0.55, 0.7, 1.0) * core * core * n * fade * dt * 1.25;
}

void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(uCamBasis * vec3(ndc.x * uTanFov * (uRes.x / uRes.y), ndc.y * uTanFov, -1.0));
  vec3 p = uCamPos;
  vec3 col = vec3(0.0);
  float T = 1.0;          // прозрачность вдоль луча
  bool captured = false;

  // быстрый прогон прямого участка, если камера далеко
  float rc = length(p);
  if (rc > FAR) {
    float b = dot(p, dir);
    float c = rc * rc - FAR * FAR;
    float disc = b * b - c;
    if (disc < 0.0 || (-b - sqrt(disc)) < 0.0) {
      gl_FragColor = vec4(stars(dir), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    p += dir * (-b - sqrt(disc));
  }

  vec3 v = dir;
  vec3 hvec = cross(p, v);
  float h2 = dot(hvec, hvec);   // сохраняющийся момент импульса фотона

  for (int i = 0; i < STEPS; i++) {
    float r2 = dot(p, p);
    float r = sqrt(r2);
    if (r < EH * 1.02) { captured = true; break; }          // упал за горизонт
    if (r > FAR && dot(p, v) > 0.0) break;                  // улетел
    float dt = clamp(0.075 * r, 0.025, 0.5);
    // изгиб луча гравитацией
    vec3 acc = -1.5 * h2 * p / (r2 * r2 * r);
    vec3 pn = p + v * dt + 0.5 * acc * dt * dt;
    vec3 vn = normalize(v + acc * dt);

    // пересечение плоскости диска
    if (p.y * pn.y < 0.0) {
      float f = p.y / (p.y - pn.y);
      vec3 hit = mix(p, pn, f);
      float hr = length(hit.xz);
      if (hr > DISK_IN && hr < DISK_OUT) {
        vec4 d = diskShade(hit, v);
        col += T * d.rgb * d.a;
        T *= 1.0 - d.a;
        if (T < 0.02) break;
      }
    }
    // планета Миллер (силуэт на фоне диска)
    if (uPlanet > 0.5) {
      vec3 seg = pn - p;
      float tt = clamp(dot(uPlanetPos - p, seg) / dot(seg, seg), 0.0, 1.0);
      vec3 cp = p + seg * tt;
      vec3 dp = cp - uPlanetPos;
      if (dot(dp, dp) < PLANET_R * PLANET_R) {
        vec3 n = normalize(dp);
        float rim = pow(1.0 - abs(dot(n, normalize(v))), 3.0);
        vec3 toDisk = normalize(vec3(-uPlanetPos.x, 0.0, -uPlanetPos.z));
        float lit = max(dot(n, toDisk), 0.0);
        col += T * (vec3(1.0, 0.6, 0.3) * rim * 0.4 + vec3(0.9, 0.55, 0.3) * lit * 0.06);
        T = 0.0;
        break;
      }
    }
    // червоточина: сфера, показывающая небо Солнечной системы
    {
      vec3 seg = pn - p;
      float tt = clamp(dot(uWormPos - p, seg) / dot(seg, seg), 0.0, 1.0);
      vec3 cp = p + seg * tt;
      vec3 dpw = cp - uWormPos;
      if (dot(dpw, dpw) < uWormR * uWormR) {
        vec3 n2 = normalize(dpw);
        vec3 vd = normalize(v);
        if (dot(vd, n2) > 0.0) n2 = -n2;
        float q2 = abs(dot(n2, vd));
        vec3 rd = refract(vd, n2, 0.70);
        if (dot(rd, rd) < 0.5) rd = reflect(vd, n2);
        rd = normalize(rd + cross(n2, rd) * 0.35 * (1.0 - q2));
        float edge = 1.0 - q2;
        col += T * (solarSky(rd) * 1.2
          + vec3(0.10, 0.16, 0.30) * (0.25 + 0.75 * edge)
          + vec3(0.75, 0.86, 1.0) * (pow(edge, 2.2) * 0.9 + pow(edge, 7.0) * 3.6));
        T = 0.0;
        break;
      }
    }
    // джеты
    if (uJets > 0.5) col += T * jetEmit(p, dt);

    p = pn; v = vn;
  }

  if (!captured && T > 0.02) col += T * stars(normalize(v));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const quadScene = new THREE.Scene();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadMat = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: FRAG,
  depthTest: false, depthWrite: false,
});
quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat));

// ───────────────────────── bloom ─────────────────────────
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
  window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType },
));
composer.addPass(new RenderPass(quadScene, quadCam));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.35, 1.2,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// ───────────────────────── качество ─────────────────────────
const TIERS = { high: 1.0, medium: 0.72, low: 0.5 };
let qualityMode = 'auto';
let tier = 'medium';
function applyTier() {
  const scale = TIERS[tier] * Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(scale);
  composer.setPixelRatio(scale);
  composer.setSize(window.innerWidth, window.innerHeight);
  uniforms.uRes.value.set(window.innerWidth, window.innerHeight);
}
applyTier();

let fpsAcc = 0, fpsN = 0, fpsTimer = 0;
function autoQuality(dt) {
  if (qualityMode !== 'auto') return;
  fpsAcc += dt; fpsN++; fpsTimer += dt;
  if (fpsTimer < 1.6) return;
  const fps = fpsN / fpsAcc;
  fpsAcc = 0; fpsN = 0; fpsTimer = 0;
  if (fps < 34 && tier !== 'low') {
    tier = tier === 'high' ? 'medium' : 'low';
    applyTier();
  } else if (fps > 72 && tier !== 'high') {
    tier = tier === 'low' ? 'medium' : 'high';
    applyTier();
  }
}

// ───────────────────────── UI ─────────────────────────
let diskSpeed = 1;
document.getElementById('speedSlider').addEventListener('input', (e) => {
  diskSpeed = parseFloat(e.target.value) / 100;
  document.getElementById('speedLabel').textContent = `×${diskSpeed.toFixed(1)}`;
});
function wireToggle(id, uniform, initial) {
  const el = document.getElementById(id);
  el.classList.toggle('on', !!initial);
  uniforms[uniform].value = initial ? 1 : 0;
  el.addEventListener('click', () => {
    const on = !el.classList.contains('on');
    el.classList.toggle('on', on);
    uniforms[uniform].value = on ? 1 : 0;
  });
}
wireToggle('tglDoppler', 'uDoppler', true);
wireToggle('tglPlanet', 'uPlanet', true);
wireToggle('tglJets', 'uJets', false);

document.getElementById('qualitySelect').addEventListener('change', (e) => {
  qualityMode = e.target.value;
  if (qualityMode !== 'auto') { tier = qualityMode; applyTier(); }
  else { tier = 'medium'; applyTier(); }
});

const infoPanel = document.getElementById('infoPanel');
const wormPanel = document.getElementById('wormPanel');
document.getElementById('infoClose').addEventListener('click', () => infoPanel.classList.remove('open'));
document.getElementById('btnInfo').addEventListener('click', () => {
  wormPanel.classList.remove('open');
  infoPanel.classList.toggle('open');
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { infoPanel.classList.remove('open'); wormPanel.classList.remove('open'); }
});
setTimeout(() => document.getElementById('hint')?.classList.add('gone'), 11000);

// ─────────────── червоточина: метка, панель, прыжок домой ───────────────
const wormLabel = document.getElementById('wormLabel');
wormLabel.addEventListener('click', () => {
  infoPanel.classList.remove('open');
  wormPanel.classList.toggle('open');
});
document.getElementById('wormClose').addEventListener('click', () => wormPanel.classList.remove('open'));

let jumping = false;
document.getElementById('btnJumpHome').addEventListener('click', () => {
  if (jumping) return;
  jumping = true;
  // рывок камеры к тоннелю
  const start = camera.position.clone();
  const t0 = performance.now();
  const wp = uniforms.uWormPos.value;
  function rush(now) {
    const t = Math.min((now - t0) / 1250, 1);
    const e = t * t * (3 - 2 * t);
    camera.position.lerpVectors(start, wp, e * 0.96);
    controls.target.lerpVectors(new THREE.Vector3(0, 0, 0), wp, e);
    if (t < 1 && jumping) requestAnimationFrame(rush);
  }
  requestAnimationFrame(rush);
  wormholeTunnel(() => { location.href = 'index.html#wormhole'; });
});

const projW = new THREE.Vector3();
function updateWormLabel() {
  projW.copy(uniforms.uWormPos.value).project(camera);
  if (projW.z > 1) { wormLabel.style.display = 'none'; return; }
  const x = (projW.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-projW.y * 0.5 + 0.5) * window.innerHeight;
  if (x < -60 || x > window.innerWidth + 60 || y < -40 || y > window.innerHeight + 40) {
    wormLabel.style.display = 'none';
    return;
  }
  wormLabel.style.display = 'flex';
  wormLabel.style.transform = `translate(-50%, -160%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

// ───────────────────────── цикл ─────────────────────────
const clock = new THREE.Clock();
let planetAng = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  uniforms.uTime.value += dt * diskSpeed;

  planetAng += dt * diskSpeed * 0.034;
  uniforms.uPlanetPos.value.set(Math.cos(planetAng) * 8.6, 1.05, Math.sin(planetAng) * 8.6);

  controls.update();
  camera.updateMatrixWorld();
  uniforms.uCamPos.value.copy(camera.position);
  uniforms.uCamBasis.value.setFromMatrix4(camera.matrixWorld);

  updateWormLabel();
  composer.render();
  autoQuality(dt);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  applyTier();
});

window.__bh = { renderer, composer, camera, controls, uniforms };

// прибытие через червоточину из Солнечной системы
if (location.hash === '#wormhole') {
  history.replaceState(null, '', location.pathname);
  const wp = uniforms.uWormPos.value;
  camera.position.copy(wp).add(wp.clone().normalize().multiplyScalar(3.5));
  wormPanel.classList.add('open');
  infoPanel.classList.remove('open');
  wormholeArrival();
}

animate();
requestAnimationFrame(() => {
  document.getElementById('loader').classList.add('done');
  setTimeout(() => document.getElementById('loader')?.remove(), 900);
});

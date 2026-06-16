// ============================================================
//  Солнечная система — интерактивная 3D-модель
// ============================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  BODIES, SIDEBAR, KIND_LABEL, SEASONS_N, SEASONS_S, MONTHS_RU, SIM_START, REALISTIC,
} from './data.js';
import {
  getTextureCanvas, spriteGlow, spriteSelectionRing, spriteStar,
} from './textures.js';
import { wormholeTunnel, wormholeArrival } from './wormhole-fx.js';
import { ShipControls, buildPlayerShip } from './flight.js';

const TWO_PI = Math.PI * 2;
const deg = THREE.MathUtils.degToRad;
const AU = 68; // 1 а.е. в единицах сцены (орбита Земли)

// ───────────────────────── рендерер / сцена ─────────────────────────
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020409);

// обзорная точка и пределы камеры зависят от масштаба
const OVERVIEW_POS = REALISTIC ? [180000, 120000, 300000] : [95, 62, 155];
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, REALISTIC ? 3e7 : 7000);
camera.position.set(OVERVIEW_POS[0], OVERVIEW_POS[1], OVERVIEW_POS[2]);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = REALISTIC ? 0.02 : 0.4;
controls.maxDistance = REALISTIC ? 5e7 : 1700;
controls.target.set(0, 0, 0);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const sunLight = new THREE.PointLight(0xfff1dd, 2.6, 0, 0);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0x223450, 0.55));

// ─────────────── floating-origin ───────────────
// Мировые позиции хранятся в Float64 (rec.wpos / shipCtl.wpos). Каждый кадр
// applyOrigin() переносит сцену так, чтобы камера была у нуля → Float32 не «дрожит».
// uSunLocal — позиция Солнца в СДВИНУТОМ кадре, общая для шейдеров атмосферы,
// аналитических теней и Земли (раньше они считали Солнце в начале координат).
const origin = { x: 0, y: 0, z: 0 };
const uSunLocal = { value: new THREE.Vector3(0, 0, 0) };

// ─────────────── корабль игрока (режим полёта) ───────────────
const playerShip = buildPlayerShip();
playerShip.visible = false;
scene.add(playerShip);
const shipCtl = new ShipControls(camera, canvas, { ship: playerShip, fovBase: camera.fov });

// ─────────────── постобработка: bloom ───────────────
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(
  window.innerWidth, window.innerHeight,
  { type: THREE.HalfFloatType, samples: 4 },
));
composer.setPixelRatio(renderer.getPixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.65, 0.5, 1.0,
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function canvasTex(cnv, srgb = true) {
  const t = new THREE.CanvasTexture(cnv);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ─────────────── реальные текстуры (NASA / Solar System Scope) ───────────────
// Загружаются асинхронно поверх процедурных: при отсутствии файла
// объект просто остаётся с процедурной текстурой.
const texLoader = new THREE.TextureLoader();
const REAL_TEX = {
  mercury: 'textures/2k_mercury.jpg',
  venus: 'textures/2k_venus_atmosphere.jpg',
  mars: 'textures/2k_mars.jpg',
  jupiter: 'textures/2k_jupiter.jpg',
  saturn: 'textures/2k_saturn.jpg',
  uranus: 'textures/2k_uranus.jpg',
  neptune: 'textures/2k_neptune.jpg',
  moon: 'textures/2k_moon.jpg',
  saturnRings: 'textures/2k_saturn_ring_alpha.png',
};
function loadReal(name, onTex, srgb = true) {
  const url = REAL_TEX[name] || name;
  texLoader.load(url, (t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.RepeatWrapping;
    onTex(t);
  }, undefined, () => { /* фолбэк: остаётся процедурная текстура */ });
}

// ───────────────────────── звёздный фон ─────────────────────────
// Небесный фон следует за камерой (skyGroup) → «бесконечен»: на реальном
// масштабе корабль улетает на млн ед., а звёзды должны оставаться вдали.
const skyGroup = new THREE.Group();
scene.add(skyGroup);
function buildStars() {
  const starTex = new THREE.CanvasTexture(spriteStar());
  const layers = [
    { n: 4200, size: 1.5, op: 0.6, tint: [1, 1, 1] },
    { n: 1900, size: 2.6, op: 0.8, tint: [0.82, 0.88, 1] },
    { n: 520, size: 4.2, op: 1.0, tint: [1, 0.93, 0.82] },
  ];
  for (const L of layers) {
    const pos = new Float32Array(L.n * 3);
    const col = new Float32Array(L.n * 3);
    for (let i = 0; i < L.n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(2300 + Math.random() * 500);
      pos.set([v.x, v.y, v.z], i * 3);
      const w = 0.55 + Math.random() * 0.45;
      col.set([L.tint[0] * w, L.tint[1] * w, L.tint[2] * w], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: L.size, map: starTex, vertexColors: true, transparent: true,
      opacity: L.op, depthWrite: false, sizeAttenuation: true,
    });
    skyGroup.add(new THREE.Points(g, m));
  }
  // полоса Млечного Пути
  const n = 3200;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const tiltQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(62), deg(20), 0));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TWO_PI;
    const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 260;
    const v = new THREE.Vector3(Math.cos(a) * 2400, spread, Math.sin(a) * 2400).applyQuaternion(tiltQ);
    pos.set([v.x, v.y, v.z], i * 3);
    const w = 0.3 + Math.random() * 0.5;
    col.set([w * 0.9, w * 0.95, w], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  skyGroup.add(new THREE.Points(g, new THREE.PointsMaterial({
    size: 2.0, map: starTex, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false,
  })));
  // мягкие туманности
  const nebCols = [
    ['rgba(120,80,220,0.18)', 'rgba(60,40,140,0.06)'],
    ['rgba(60,120,220,0.16)', 'rgba(30,70,160,0.05)'],
    ['rgba(200,90,160,0.12)', 'rgba(120,50,110,0.04)'],
  ];
  for (let i = 0; i < 9; i++) {
    const [c1, c2] = nebCols[i % nebCols.length];
    const tex = new THREE.CanvasTexture(spriteGlow(c1, c2, 256));
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.position.copy(new THREE.Vector3().randomDirection().multiplyScalar(2500));
    sp.scale.setScalar(500 + Math.random() * 700);
    skyGroup.add(sp);
  }
}
buildStars();

// ───────────────────────── Солнце ─────────────────────────
const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 mod289(vec4 x){return x - floor(x * (1.0/289.0)) * 289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p *= 2.05; a *= 0.5; }
  return s;
}`;

const sunUniforms = { uTime: { value: 0 }, uFlash: { value: 0 } };
function buildSun(data) {
  const group = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: sunUniforms,
    vertexShader: /* glsl */`
      varying vec3 vPos; varying vec3 vN; varying vec3 vPw;
      void main(){
        vPos = position;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPw = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${NOISE_GLSL}
      uniform float uTime; uniform float uFlash;
      varying vec3 vPos; varying vec3 vN; varying vec3 vPw;
      void main(){
        vec3 p = normalize(vPos);
        float t = uTime * 0.05;
        float n1 = fbm(p * 3.0 + vec3(t, t * 0.6, -t * 0.8));
        float n2 = fbm(p * 9.0 - vec3(t * 1.7, 0.0, t));
        float v = clamp((n1 * 0.65 + n2 * 0.35) * 0.5 + 0.5, 0.0, 1.0);
        vec3 c1 = vec3(0.55, 0.08, 0.0);
        vec3 c2 = vec3(1.0, 0.45, 0.05);
        vec3 c3 = vec3(1.0, 0.85, 0.35);
        vec3 c4 = vec3(1.0, 0.98, 0.85);
        vec3 col = mix(c1, c2, smoothstep(0.0, 0.45, v));
        col = mix(col, c3, smoothstep(0.45, 0.75, v));
        col = mix(col, c4, smoothstep(0.78, 0.97, v));
        vec3 view = normalize(cameraPosition - vPw);
        float lim = pow(max(dot(view, normalize(vN)), 0.0), 0.55);
        col *= 0.5 + 0.62 * lim;
        col *= 1.55 + uFlash * 0.9;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(data.radius, 96, 64), mat);
  group.add(mesh);

  // гало и корона
  const mkSprite = (c1, c2, scale, op) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(spriteGlow(c1, c2, 512)),
      transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sp.scale.setScalar(scale);
    group.add(sp);
    return sp;
  };
  const halo = mkSprite('rgba(255,235,180,0.9)', 'rgba(255,130,30,0.18)', data.radius * 8.5, 0.85);
  const corona1 = mkSprite('rgba(255,200,120,0.6)', 'rgba(255,100,20,0.1)', data.radius * 4.6, 0.7);
  const corona2 = mkSprite('rgba(255,220,160,0.5)', 'rgba(255,140,40,0.08)', data.radius * 6.2, 0.5);
  return { group, mesh, halo, corona1, corona2 };
}

// ───────────────── корональные выбросы массы (КВМ) ─────────────────
class CMEBurst {
  constructor(sunR) {
    this.sunR = sunR;
    this.N = 340;
    this.duration = 7;
    this.start = -1e9;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3)); // заглушка
    g.setAttribute('aDir', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
    g.setAttribute('aTan', new THREE.BufferAttribute(new Float32Array(this.N * 3), 3));
    g.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    g.setAttribute('aDelay', new THREE.BufferAttribute(new Float32Array(this.N), 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), sunR * 8);
    this.uniforms = { uT: { value: 2 }, uSunR: { value: sunR } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec3 aDir; attribute vec3 aTan;
        attribute float aSpeed; attribute float aSize; attribute float aDelay;
        uniform float uT; uniform float uSunR;
        varying float vA; varying float vT;
        void main(){
          float t = clamp((uT - aDelay) / (1.0 - aDelay), 0.0, 1.0);
          vT = t;
          float dist = uSunR * (1.02 + aSpeed * t * 4.2);
          vec3 p = aDir * dist + aTan * (uSunR * 1.1 * t * t);
          vA = (1.0 - t) * smoothstep(0.0, 0.04, t);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSize * (1.0 + t * 2.6) * (240.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA; varying float vT;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float disk = smoothstep(0.5, 0.05, d);
          vec3 col = mix(vec3(1.0, 0.96, 0.78), vec3(1.0, 0.32, 0.04), clamp(vT * 1.5, 0.0, 1.0));
          gl_FragColor = vec4(col * 1.7, disk * vA * 0.7);
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.visible = false;
    this.points.frustumCulled = false;
  }
  fire(now, aimDir) {
    this.start = now;
    const g = this.points.geometry;
    const dir = g.attributes.aDir, tan = g.attributes.aTan;
    const spd = g.attributes.aSpeed, siz = g.attributes.aSize, del = g.attributes.aDelay;
    const center = aimDir ? aimDir.clone().normalize() : new THREE.Vector3().randomDirection();
    const tangent = new THREE.Vector3().randomDirection().cross(center).normalize();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < this.N; i++) {
      tmp.randomDirection().multiplyScalar(0.22).add(center).normalize();
      dir.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const curl = (Math.random() - 0.3) * 0.6;
      tan.setXYZ(i, tangent.x * curl, tangent.y * curl, tangent.z * curl);
      spd.setX(i, 0.6 + Math.random() * 1.2);
      siz.setX(i, 2.4 + Math.random() * 6.5);
      del.setX(i, Math.random() * 0.22);
    }
    dir.needsUpdate = tan.needsUpdate = spd.needsUpdate = siz.needsUpdate = del.needsUpdate = true;
    this.points.visible = true;
  }
  update(now) {
    const t = (now - this.start) / this.duration;
    this.uniforms.uT.value = t;
    if (t > 1 && this.points.visible) this.points.visible = false;
    return t >= 0 && t <= 1;
  }
}

// ───────────────────────── аналитические тени ─────────────────────────
// Вместо shadow map — точный расчёт: сферические окклюдеры (затмения,
// транзиты лун) и тень колец Сатурна, с полутенью от углового размера Солнца.
const SHADOW_GLSL = /* glsl */`
uniform vec4 uOccl[4];      // xyz — центр окклюдера (мир), w — радиус
uniform int uOcclCount;
uniform vec3 uSunLocal;     // позиция Солнца в текущем (сдвинутом) кадре
float occlShadow(vec3 P) {
  vec3 toSun = uSunLocal - P;
  float dl = length(toSun);
  vec3 ld = toSun / dl;     // направление на Солнце
  float sh = 1.0;
  for (int i = 0; i < 4; i++) {
    if (i >= uOcclCount) break;
    vec3 toOcc = uOccl[i].xyz - P;
    float proj = dot(toOcc, ld);
    if (proj <= 0.0 || proj >= dl) continue;
    float d = length(toOcc - ld * proj);
    float sunAng = 16.0 / dl * 0.55;             // угловой радиус Солнца (полутень)
    float occAng = uOccl[i].w / proj;
    float cover = smoothstep(occAng + sunAng, max(occAng - sunAng, 0.0), d / proj);
    float maxCov = clamp((occAng * occAng) / (sunAng * sunAng), 0.0, 1.0);
    sh *= 1.0 - cover * maxCov * 0.94;
  }
  return sh;
}
uniform vec4 uRingOcc;      // xyz — центр планеты, w — 1.0 если кольца есть
uniform vec3 uRingNormal;
uniform vec2 uRingRadii;    // внутренний, внешний радиусы
float ringAlphaProfile(float x) {
  // приближение плотности колец Сатурна: C, B, щель Кассини, A, щель Энке
  float a = 0.0;
  a += 0.28 * smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.13, 0.18, x));
  a += 0.95 * smoothstep(0.16, 0.22, x) * (1.0 - smoothstep(0.52, 0.575, x));
  a += 0.70 * smoothstep(0.60, 0.65, x) * (1.0 - smoothstep(0.88, 0.93, x));
  a *= 1.0 - 0.9 * smoothstep(0.930, 0.942, x) * (1.0 - smoothstep(0.950, 0.962, x));
  return clamp(a, 0.0, 1.0);
}
float ringShadow(vec3 P) {
  if (uRingOcc.w < 0.5) return 1.0;
  vec3 toSun = uSunLocal - P;
  float dl = length(toSun);
  vec3 ld = toSun / dl;
  float denom = dot(ld, uRingNormal);
  if (abs(denom) < 1e-4) return 1.0;
  float t = dot(uRingOcc.xyz - P, uRingNormal) / denom;
  if (t <= 0.0 || t >= dl) return 1.0;
  vec3 hit = P + ld * t;
  float r = length(hit - uRingOcc.xyz);
  float x = (r - uRingRadii.x) / (uRingRadii.y - uRingRadii.x);
  if (x < 0.0 || x > 1.0) return 1.0;
  return 1.0 - ringAlphaProfile(x) * 0.85;
}`;

const shadowMats = [];
function injectShadows(mat, opts) {
  mat.userData.shadowOpts = opts;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uOccl = {
      value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()],
    };
    shader.uniforms.uOcclCount = { value: 0 };
    shader.uniforms.uRingOcc = { value: new THREE.Vector4(0, 0, 0, 0) };
    shader.uniforms.uRingNormal = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uRingRadii = { value: new THREE.Vector2(1, 2) };
    shader.uniforms.uSunLocal = uSunLocal; // общая ссылка — обновляется раз в кадр

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShadowWP;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvShadowWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vShadowWP;\n${SHADOW_GLSL}`)
      .replace('#include <opaque_fragment>',
        'float totalShadow = occlShadow(vShadowWP) * ringShadow(vShadowWP);\n'
        + 'outgoingLight *= mix(0.045, 1.0, totalShadow);\n'
        + '#include <opaque_fragment>');
    mat.userData.shadowShader = shader;
  };
  shadowMats.push(mat);
}

// затмения и транзиты: луны ↔ родительские планеты
const OCCLUDERS = {};
for (const b of BODIES) {
  if (b.kind === 'moon') {
    OCCLUDERS[b.id] = [b.parent];
    (OCCLUDERS[b.parent] = OCCLUDERS[b.parent] || []).push(b.id);
  }
}
for (const k of Object.keys(OCCLUDERS)) OCCLUDERS[k] = OCCLUDERS[k].slice(0, 4);

function updateShadowUniforms() {
  for (const mat of shadowMats) {
    const sh = mat.userData.shadowShader;
    if (!sh) continue; // шейдер ещё не скомпилирован
    const opts = mat.userData.shadowOpts;
    let n = 0;
    for (const id of opts.occluders) {
      const o = bodies.get(id);
      const p = o.group.position;
      sh.uniforms.uOccl.value[n].set(p.x, p.y, p.z, o.data.radius);
      n++;
    }
    sh.uniforms.uOcclCount.value = n;
    if (opts.ring) {
      const rb = bodies.get(opts.ring.bodyId);
      const p = rb.group.position;
      sh.uniforms.uRingOcc.value.set(p.x, p.y, p.z, 1);
      sh.uniforms.uRingNormal.value.set(0, 1, 0).applyEuler(rb.tiltNode.rotation);
      sh.uniforms.uRingRadii.value.set(opts.ring.inner, opts.ring.outer);
    }
  }
}

// ───────────────────────── атмосферное свечение ─────────────────────────
function makeAtmosphere(radius, colorVec, intensity = 1) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: colorVec }, uInt: { value: intensity }, uSunLocal },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vPw;
      void main(){
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPw = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uInt; uniform vec3 uSunLocal;
      varying vec3 vN; varying vec3 vPw;
      void main(){
        vec3 n = normalize(vN);
        vec3 view = normalize(cameraPosition - vPw);
        float rim = pow(1.0 - clamp(dot(view, n), 0.0, 1.0), 3.2);
        vec3 sunDir = normalize(uSunLocal - vPw);
        float lit = clamp(dot(n, sunDir), -0.15, 1.0) * 0.5 + 0.5;
        gl_FragColor = vec4(uColor * rim * lit * uInt, rim * lit);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat);
}

const ATMO = {
  earth: { c: new THREE.Vector3(0.35, 0.62, 1.0), s: 1.045, i: 1.25 },
  venus: { c: new THREE.Vector3(0.95, 0.82, 0.55), s: 1.05, i: 0.8 },
  mars: { c: new THREE.Vector3(0.9, 0.55, 0.35), s: 1.04, i: 0.45 },
  titan: { c: new THREE.Vector3(0.95, 0.65, 0.25), s: 1.12, i: 0.9 },
  neptune: { c: new THREE.Vector3(0.4, 0.55, 1.0), s: 1.04, i: 0.6 },
  uranus: { c: new THREE.Vector3(0.6, 0.9, 0.95), s: 1.04, i: 0.5 },
};

// ───────────────────────── Земля (ультрареалистичный шейдер) ─────────────────────────
const earthUniforms = {
  uDay: { value: null }, uNight: { value: null },
  uNormalMap: { value: null }, uSpecMap: { value: null }, uClouds: { value: null },
  uHasNormal: { value: 0 }, uHasSpec: { value: 0 }, uHasClouds: { value: 0 },
  uCloudShift: { value: 0 },
  uSunDir: { value: new THREE.Vector3(1, 0, 0) },
  uWinterN: { value: 0 }, uWinterS: { value: 1 },
  uMoonPos: { value: new THREE.Vector3(1e6, 0, 0) }, uMoonR: { value: 0.55 },
  uSunLocal,
};
function buildEarthMaterial() {
  const maps = getTextureCanvas('earth');
  earthUniforms.uDay.value = canvasTex(maps.day);
  earthUniforms.uNight.value = canvasTex(maps.night);
  // асинхронная замена на реальные карты NASA
  loadReal('textures/4k_earth_daymap.jpg', (t) => { earthUniforms.uDay.value = t; });
  loadReal('textures/4k_earth_nightmap.jpg', (t) => { earthUniforms.uNight.value = t; });
  loadReal('textures/earth_normal_2048.jpg', (t) => {
    earthUniforms.uNormalMap.value = t; earthUniforms.uHasNormal.value = 1;
  }, false);
  loadReal('textures/earth_specular_2048.jpg', (t) => {
    earthUniforms.uSpecMap.value = t; earthUniforms.uHasSpec.value = 1;
  }, false);
  return new THREE.ShaderMaterial({
    uniforms: earthUniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw;
      void main(){
        vUv = uv;
        vNw = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPw = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uDay; uniform sampler2D uNight;
      uniform sampler2D uNormalMap; uniform sampler2D uSpecMap; uniform sampler2D uClouds;
      uniform float uHasNormal; uniform float uHasSpec; uniform float uHasClouds;
      uniform float uCloudShift;
      uniform vec3 uSunDir; uniform float uWinterN; uniform float uWinterS;
      uniform vec3 uMoonPos; uniform float uMoonR; uniform vec3 uSunLocal;
      varying vec2 vUv; varying vec3 vNw; varying vec3 vPw;

      vec3 perturbNormal(vec3 surfNorm, vec3 mapN, vec2 uv) {
        vec3 q0 = dFdx(vPw); vec3 q1 = dFdy(vPw);
        vec2 st0 = dFdx(uv); vec2 st1 = dFdy(uv);
        vec3 S = normalize(q0 * st1.t - q1 * st0.t);
        vec3 T = normalize(-q0 * st1.s + q1 * st0.s);
        return normalize(mat3(S, T, normalize(surfNorm)) * mapN);
      }
      // затмение Луной
      float moonShadow(vec3 P) {
        vec3 toSun = uSunLocal - P;
        float dl = length(toSun);
        vec3 ld = toSun / dl;
        vec3 toOcc = uMoonPos - P;
        float proj = dot(toOcc, ld);
        if (proj <= 0.0) return 1.0;
        float d = length(toOcc - ld * proj);
        float sunAng = 16.0 / dl * 0.55;
        float occAng = uMoonR / proj;
        float cover = smoothstep(occAng + sunAng, max(occAng - sunAng, 0.0), d / proj);
        float maxCov = clamp((occAng * occAng) / (sunAng * sunAng), 0.0, 1.0);
        return 1.0 - cover * maxCov * 0.92;
      }
      void main(){
        vec3 nGeo = normalize(vNw);
        vec3 n = nGeo;
        if (uHasNormal > 0.5) {
          vec3 mapN = texture2D(uNormalMap, vUv).xyz * 2.0 - 1.0;
          mapN.xy *= 0.8;
          n = perturbNormal(nGeo, mapN, vUv);
        }
        float ndl = dot(n, uSunDir);
        float ndlGeo = dot(nGeo, uSunDir);
        float dayF = smoothstep(-0.08, 0.22, ndlGeo);
        vec3 day = texture2D(uDay, vUv).rgb;
        vec3 night = texture2D(uNight, vUv).rgb;
        float ocean = uHasSpec > 0.5
          ? smoothstep(0.2, 0.6, texture2D(uSpecMap, vUv).r)
          : smoothstep(0.0, 0.09, day.b - day.r);
        // сезонный снежный покров: зимой граница снега спускается к экватору
        float lat = vUv.y - 0.5;
        float lineN = 0.31 - 0.13 * uWinterN;
        float lineS = 0.31 - 0.13 * uWinterS;
        float snow = smoothstep(lineN, lineN + 0.08, lat) + smoothstep(lineS, lineS + 0.08, -lat);
        day = mix(day, vec3(0.93, 0.96, 1.0), clamp(snow, 0.0, 1.0) * (1.0 - ocean) * 0.75);
        // тени облаков на поверхности
        if (uHasClouds > 0.5) {
          float cl = texture2D(uClouds, vec2(vUv.x - uCloudShift, vUv.y)).r;
          day *= 1.0 - cl * 0.32;
        }
        float eclipse = moonShadow(vPw);
        vec3 view = normalize(cameraPosition - vPw);
        vec3 hv = normalize(uSunDir + view);
        float spec = pow(max(dot(n, hv), 0.0), 120.0) * ocean * dayF;
        // тёплый свет на терминаторе
        vec3 sunTint = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, ndlGeo));
        vec3 col = day * (0.018 + dayF * (0.2 + 1.05 * max(ndl, 0.0))) * sunTint * eclipse;
        col += vec3(1.0, 0.85, 0.6) * spec * 0.85 * eclipse;
        // огни городов — ярче порога bloom, чтобы светились
        col += night * vec3(1.0, 0.9, 0.75) * (1.0 - dayF) * 2.3;
        // лёгкая голубая дымка по краю диска
        float rim = pow(1.0 - max(dot(view, nGeo), 0.0), 2.6);
        col += vec3(0.25, 0.5, 1.0) * rim * (0.18 + 0.45 * dayF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ───────────────────────── червоточина ─────────────────────────
// Сфера, сквозь которую «просвечивает» небо системы Гаргантюа:
// преломление взгляда + яркое кольцо Эйнштейна по краю.
const wormUniforms = { uTime: { value: 0 } };
function makeWormholeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: wormUniforms,
    vertexShader: /* glsl */`
      varying vec3 vNw; varying vec3 vPw;
      void main(){
        vNw = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPw = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime;
      varying vec3 vNw; varying vec3 vPw;
      float hash13(vec3 p){
        p = fract(p * 0.1031);
        p += dot(p, p.zyx + 31.32);
        return fract((p.x + p.y) * p.z);
      }
      // небо «другой стороны»: чужие звёзды + далёкое свечение Гаргантюа
      vec3 gargSky(vec3 d){
        vec3 col = vec3(0.0);
        for (int l = 0; l < 2; l++) {
          vec3 q = d * (l == 0 ? 42.0 : 90.0) + 13.0 + float(l) * 7.0;
          vec3 cell = floor(q);
          float h = hash13(cell);
          if (h > 0.8) {
            vec3 c = cell + 0.5 + (vec3(hash13(cell + 3.1), hash13(cell + 6.4), hash13(cell + 9.2)) - 0.5) * 0.7;
            float star = pow(max(0.0, 1.0 - length(q - c) * 1.7), 5.0) * (h - 0.8) * 16.0;
            col += vec3(0.92, 0.95, 1.0) * star;
          }
        }
        vec3 gdir = normalize(vec3(0.35, -0.12, 1.0));
        float g = max(dot(d, gdir), 0.0);
        col += vec3(1.0, 0.55, 0.18) * (pow(g, 60.0) * 3.5 + pow(g, 7.0) * 0.45);
        return col;
      }
      void main(){
        vec3 n = normalize(vNw);
        vec3 view = normalize(vPw - cameraPosition);
        vec3 rd = refract(view, n, 0.70);
        if (dot(rd, rd) < 0.5) rd = reflect(view, n);
        // лёгкое вихревое мерцание у края
        float edge = 1.0 - abs(dot(view, n));
        rd = normalize(rd + cross(n, rd) * (0.25 + 0.1 * sin(uTime * 0.7)) * edge);
        vec3 col = gargSky(rd) * 1.2;
        // линзовая дымка + двойное кольцо Эйнштейна по краю
        col += vec3(0.10, 0.16, 0.30) * (0.25 + 0.75 * edge);
        col += vec3(0.75, 0.86, 1.0) * (pow(edge, 2.2) * 0.9 + pow(edge, 7.0) * 3.6);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ───────────────────────── полярные сияния ─────────────────────────
// Занавеси над магнитными полюсами Земли; вспыхивают, когда корональный
// выброс долетает до планеты.
const auroraUniforms = { uTime: { value: 0 }, uIntensity: { value: 0 } };
let auroraSys = null;
let auroraStart = -1e9;

function buildAurora(r) {
  const mat = new THREE.ShaderMaterial({
    uniforms: auroraUniforms,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${NOISE_GLSL}
      uniform float uTime; uniform float uIntensity;
      varying vec2 vUv;
      void main(){
        if (uIntensity < 0.003) discard;
        float up = 1.0 - vUv.y;             // 0 — нижняя кромка, 1 — верх
        float ang = vUv.x * 6.2831853;
        vec2 c = vec2(cos(ang), sin(ang));
        // вертикальные лучи-занавеси, медленно дрейфующие
        float n1 = fbm(vec3(c * 2.6, uTime * 0.22));
        float n2 = fbm(vec3(c * 6.0 + 31.7, uTime * 0.35 + up * 0.8));
        float rays = smoothstep(0.08, 0.75, n1 * 0.5 + 0.5) * (0.55 + 0.45 * n2);
        float band = 0.65 + 0.35 * sin(ang * 3.0 + uTime * 0.4 + n1 * 2.0);
        float fade = pow(max(1.0 - up, 0.0), 1.7) * smoothstep(0.0, 0.05, up + 0.04);
        float a = uIntensity * rays * band * fade;
        vec3 col = mix(vec3(0.15, 1.0, 0.45), vec3(0.62, 0.3, 1.0), smoothstep(0.1, 0.95, up + n2 * 0.2));
        col = mix(col, vec3(1.0, 0.35, 0.45), smoothstep(0.75, 1.0, up) * 0.4);
        gl_FragColor = vec4(col * (1.3 + uIntensity * 1.2), a * 0.85);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.CylinderGeometry(r * 0.40, r * 0.44, r * 0.30, 96, 6, true);
  const north = new THREE.Mesh(geo, mat);
  north.position.y = r * 0.9 + r * 0.15;
  const south = new THREE.Mesh(geo, mat);
  south.position.y = -(r * 0.9 + r * 0.15);
  south.rotation.x = Math.PI;
  north.renderOrder = south.renderOrder = 6;
  return { north, south };
}

function triggerAurora(elapsedNow, delay) {
  auroraStart = elapsedNow + delay;
}

// ───────────────────────── модели аппаратов ─────────────────────────
function metalMat(color, emissive = 0x000000, ei = 0.4) {
  return new THREE.MeshStandardMaterial({
    color, metalness: 0.65, roughness: 0.45, emissive, emissiveIntensity: ei,
  });
}
function panelMat() {
  return new THREE.MeshStandardMaterial({
    color: 0x2c4a8c, metalness: 0.4, roughness: 0.35, emissive: 0x16306b, emissiveIntensity: 0.7,
  });
}
const CRAFT_BUILDERS = {
  iss() {
    const g = new THREE.Group();
    const truss = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.07, 0.07), metalMat(0xb8c0cc, 0x404a58, 0.5));
    g.add(truss);
    for (const x of [-1.05, -0.62, 0.62, 1.05]) {
      for (const z of [0.36, -0.36]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.6), panelMat());
        p.position.set(x, 0, z);
        g.add(p);
      }
    }
    const mod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.1, 12), metalMat(0xd8dde6, 0x55606e, 0.5));
    mod1.rotation.x = Math.PI / 2;
    g.add(mod1);
    const mod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 12), metalMat(0xc8ced8, 0x4a5462, 0.5));
    mod2.rotation.z = Math.PI / 2;
    mod2.position.z = 0.25;
    g.add(mod2);
    return g;
  },
  hubble() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.05, 16), metalMat(0xcfd6e0, 0x4e5866, 0.5));
    g.add(body);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.16, 16), metalMat(0x8a93a0));
    cap.position.y = 0.56;
    g.add(cap);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.02, 0.34), panelMat());
      p.position.x = s * 0.46;
      g.add(p);
    }
    return g;
  },
  jwst() {
    const g = new THREE.Group();
    for (const [s, y] of [[1.0, 0], [0.92, 0.05], [0.84, 0.1]]) {
      const sh = new THREE.Mesh(
        new THREE.BoxGeometry(1.5 * s, 0.012, 0.9 * s),
        metalMat(0xe2b8cc, 0x6a4055, 0.45),
      );
      sh.position.y = y;
      g.add(sh);
    }
    const mirror = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 0.05, 6),
      metalMat(0xf0c75e, 0x97700e, 0.85),
    );
    mirror.position.y = 0.34;
    mirror.rotation.x = deg(18);
    g.add(mirror);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 6), metalMat(0x888888));
    strut.position.y = 0.18;
    g.add(strut);
    return g;
  },
  voyager() {
    const g = new THREE.Group();
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.07, 0.22, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe8eaee, metalness: 0.3, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x555c66, emissiveIntensity: 0.45 }));
    g.add(dish);
    const bus = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), metalMat(0xa8aeb8, 0x3c424c, 0.5));
    bus.position.y = -0.18;
    g.add(bus);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.3, 6), metalMat(0x9aa0aa));
    boom.rotation.z = Math.PI / 2;
    boom.position.set(0.65, -0.2, 0);
    g.add(boom);
    const rtg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), metalMat(0x4c4640, 0x201c18, 0.6));
    rtg.rotation.z = Math.PI / 2;
    rtg.position.set(-0.5, -0.25, 0);
    g.add(rtg);
    return g;
  },
  parker() {
    const g = new THREE.Group();
    const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24), metalMat(0x35302a, 0x4a2008, 0.5));
    shield.rotation.x = Math.PI / 2;
    shield.position.z = 0.35;
    g.add(shield);
    const bus = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 10), metalMat(0xcfd2d8, 0x4e5258, 0.5));
    bus.rotation.x = Math.PI / 2;
    g.add(bus);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.2), panelMat());
      p.position.set(s * 0.34, 0, -0.1);
      g.add(p);
    }
    return g;
  },
};

// ───────────────────────── постройка тел ─────────────────────────
const bodies = new Map();     // id → запись
const hitMeshes = [];          // для raycast
const invisMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
const markerTexCache = new Map();

function markerSprite(color) {
  if (!markerTexCache.has(color)) {
    markerTexCache.set(color, new THREE.CanvasTexture(
      spriteGlow(color, 'rgba(0,0,0,0)', 64),
    ));
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: markerTexCache.get(color), transparent: true, opacity: 0.9,
    depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  }));
}

let sunParts = null;

function buildBody(d) {
  const rec = {
    data: d, group: new THREE.Group(), tiltNode: null, spinNode: null,
    mesh: null, angle: deg(d.phase || 0), orbitQuat: null, orbitLine: null,
    marker: null, hit: null, clouds: null, model: null, prevPos: new THREE.Vector3(),
    wpos: { x: 0, y: 0, z: 0 }, // мировая позиция (Float64) — источник истины для floating-origin
  };

  if (d.kind === 'belt') { buildBelt(d, rec); bodies.set(d.id, rec); return; }

  const tiltNode = new THREE.Group();
  tiltNode.rotation.z = -deg(d.tilt || 0);
  const spinNode = new THREE.Group();
  tiltNode.add(spinNode);
  rec.group.add(tiltNode);
  rec.tiltNode = tiltNode;
  rec.spinNode = spinNode;

  if (d.kind === 'star') {
    sunParts = buildSun(d);
    spinNode.add(sunParts.mesh);
    rec.group.add(sunParts.halo, sunParts.corona1, sunParts.corona2);
    rec.mesh = sunParts.mesh;
  } else if (d.kind === 'craft') {
    const model = CRAFT_BUILDERS[d.model]();
    model.scale.setScalar(d.radius * 2.2);
    spinNode.add(model);
    rec.model = model;
    rec.mesh = model;
  } else if (d.kind === 'wormhole') {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.radius, 64, 48), makeWormholeMaterial());
    spinNode.add(mesh);
    rec.mesh = mesh;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(spriteGlow('rgba(160,200,255,0.55)', 'rgba(80,120,220,0.12)', 256)),
      transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.scale.setScalar(d.radius * 5.5);
    rec.group.add(halo);
  } else {
    let mat;
    if (d.id === 'earth') {
      mat = buildEarthMaterial();
    } else {
      mat = new THREE.MeshPhongMaterial({
        map: canvasTex(getTextureCanvas(d.tex)),
        shininess: 6, specular: 0x1a1a1a,
      });
      if (REAL_TEX[d.tex]) {
        loadReal(d.tex, (t) => { mat.map = t; mat.needsUpdate = true; });
      }
      // затмения и транзиты лун, тень колец на Сатурне
      if (OCCLUDERS[d.id] || d.id === 'saturn') {
        injectShadows(mat, {
          occluders: OCCLUDERS[d.id] || [],
          ring: d.id === 'saturn' ? { bodyId: 'saturn', inner: d.ring.inner, outer: d.ring.outer } : null,
        });
      }
    }
    const segs = d.radius > 3 ? 64 : (d.radius > 0.5 ? 48 : 24);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(d.radius, segs, segs / 2), mat);
    spinNode.add(mesh);
    rec.mesh = mesh;

    // облака Земли + полярные сияния
    if (d.id === 'earth') {
      const maps = getTextureCanvas('earth');
      const clMat = new THREE.MeshLambertMaterial({
        map: canvasTex(maps.clouds), transparent: true, depthWrite: false, opacity: 0.9,
      });
      const cl = new THREE.Mesh(new THREE.SphereGeometry(d.radius * 1.022, 64, 48), clMat);
      tiltNode.add(cl);
      rec.clouds = cl;
      // реальная карта облаков NASA: и на сферу облаков, и в шейдер теней
      loadReal('textures/2k_earth_clouds.jpg', (t) => {
        clMat.map = null;
        clMat.color.set(0xffffff);
        clMat.alphaMap = t;
        clMat.needsUpdate = true;
        earthUniforms.uClouds.value = t;
        earthUniforms.uHasClouds.value = 1;
      }, false);
      auroraSys = buildAurora(d.radius);
      tiltNode.add(auroraSys.north, auroraSys.south);
    }
    // атмосферное свечение
    if (ATMO[d.id]) {
      const a = ATMO[d.id];
      tiltNode.add(makeAtmosphere(d.radius * a.s, a.c, a.i));
    }
    // кольца
    if (d.ring) {
      const geo = new THREE.RingGeometry(d.ring.inner, d.ring.outer, 180, 1);
      const pos = geo.attributes.position, uv = geo.attributes.uv;
      const v3 = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v3.fromBufferAttribute(pos, i);
        uv.setXY(i, (v3.length() - d.ring.inner) / (d.ring.outer - d.ring.inner), 1);
      }
      const rm = new THREE.MeshBasicMaterial({
        map: canvasTex(getTextureCanvas(d.ring.tex)),
        transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: d.ring.opacity,
      });
      if (REAL_TEX[d.ring.tex]) {
        loadReal(d.ring.tex, (t) => { rm.map = t; rm.needsUpdate = true; });
      }
      // тень планеты на кольцах
      injectShadows(rm, { occluders: [d.id], ring: null });
      const ring = new THREE.Mesh(geo, rm);
      ring.rotation.x = -Math.PI / 2;
      tiltNode.add(ring);
      // невидимая мишень для клика по кольцам
      const rHit = new THREE.Mesh(new THREE.RingGeometry(d.ring.inner, d.ring.outer, 32, 1), invisMat);
      rHit.rotation.x = -Math.PI / 2;
      rHit.userData.bodyId = d.id;
      tiltNode.add(rHit);
      hitMeshes.push(rHit);
    }
  }

  // мишень для клика
  const hitR = Math.max(d.radius * 1.45, d.kind === 'craft' ? 0.9 : 0.8);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(hitR, 12, 8), invisMat);
  hit.userData.bodyId = d.id;
  rec.group.add(hit);
  rec.hit = hit;
  hitMeshes.push(hit);

  // маркер-точка для малых/далёких объектов
  if (d.kind === 'craft' || d.kind === 'dwarf' || d.kind === 'wormhole') {
    const m = markerSprite(d.clr);
    m.renderOrder = 5;
    rec.group.add(m);
    rec.marker = m;
  }

  // ориентация орбиты
  rec.orbitQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -deg(d.incl || 0)));

  // линия орбиты
  if (d.dist > 0 && !d.special) {
    const N = 180;
    const pts = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = i / N * TWO_PI;
      pts.set([Math.cos(a) * d.dist, 0, Math.sin(a) * d.dist], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const isMoonish = d.parent && d.parent !== 'sun';
    const m = new THREE.LineBasicMaterial({
      color: d.kind === 'craft' ? 0x3f8f8f : (isMoonish ? 0x6a83b8 : 0x44639e),
      transparent: true,
      opacity: isMoonish ? 0.5 : 0.34,
    });
    const line = new THREE.LineLoop(g, m);
    line.quaternion.copy(rec.orbitQuat);
    rec.orbitLine = line;
    rec.orbitLineMoonish = isMoonish;
    scene.add(line);
  }

  scene.add(rec.group);
  bodies.set(d.id, rec);
}

// ───────────────────────── пояса ─────────────────────────
const beltGroups = [];
function buildBelt(d, rec) {
  const group = new THREE.Group();
  rec.group = group;
  const rMid = (d.rIn + d.rOut) / 2;

  if (d.id === 'belt') {
    // главный пояс: инстансированные камни в 3 слоях с разной скоростью
    const baseGeo = new THREE.IcosahedronGeometry(1, 0);
    const pa = baseGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      pa.setXYZ(i, pa.getX(i) * (0.7 + Math.random() * 0.6),
        pa.getY(i) * (0.7 + Math.random() * 0.6), pa.getZ(i) * (0.7 + Math.random() * 0.6));
    }
    baseGeo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: d.beltClr, roughness: 1, metalness: 0.05, flatShading: true });
    const per = Math.floor(d.count / 3);
    const dummy = new THREE.Object3D();
    [1500, 1750, 2030].forEach((period) => {
      const im = new THREE.InstancedMesh(baseGeo, mat, per);
      for (let i = 0; i < per; i++) {
        const a = Math.random() * TWO_PI;
        const r = d.rIn + (Math.random() + Math.random()) / 2 * (d.rOut - d.rIn);
        dummy.position.set(
          Math.cos(a) * r,
          (Math.random() + Math.random() + Math.random() - 1.5) * d.ySpread,
          Math.sin(a) * r,
        );
        dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
        dummy.scale.setScalar(0.06 + Math.random() * Math.random() * 0.3);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      const wrap = new THREE.Group();
      wrap.add(im);
      group.add(wrap);
      beltGroups.push({ node: wrap, period });
    });
  } else {
    // пояс Койпера: мерцающая пыль ледяных тел
    const n = d.count;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const base = new THREE.Color(d.beltClr);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TWO_PI;
      const r = d.rIn + (Math.random() + Math.random()) / 2 * (d.rOut - d.rIn);
      pos.set([
        Math.cos(a) * r,
        (Math.random() + Math.random() + Math.random() - 1.5) * d.ySpread,
        Math.sin(a) * r,
      ], i * 3);
      const w = 0.5 + Math.random() * 0.6;
      col.set([base.r * w, base.g * w, base.b * w], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({
      size: 1.7, map: new THREE.CanvasTexture(spriteStar()), vertexColors: true,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    const pts = new THREE.Points(g, m);
    group.add(pts);
    beltGroups.push({ node: pts, period: 38000 });
  }

  // невидимый тор для клика
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(rMid, (d.rOut - d.rIn) / 2 + d.ySpread, 8, 72),
    invisMat,
  );
  torus.rotation.x = Math.PI / 2;
  torus.userData.bodyId = d.id;
  torus.userData.isBelt = true;
  group.add(torus);
  hitMeshes.push(torus);

  scene.add(group);
}

for (const d of BODIES) buildBody(d);

// КВМ-пул
const cmePool = [new CMEBurst(16), new CMEBurst(16), new CMEBurst(16)];
for (const c of cmePool) bodies.get('sun').group.add(c.points);
let nextCME = 3.5;
let flash = 0;

// кольцо выделения
const selRing = new THREE.Sprite(new THREE.SpriteMaterial({
  map: new THREE.CanvasTexture(spriteSelectionRing()),
  transparent: true, opacity: 0.95, depthWrite: false, depthTest: false,
}));
selRing.renderOrder = 999;
selRing.visible = false;
scene.add(selRing);

// ───────────────────────── состояние симуляции ─────────────────────────
const state = {
  simDays: 0,
  speed: 1 / 24,        // суток в секунду (по умолчанию: 1 час/с)
  paused: false,
  selected: null,
  follow: null,
  showOrbits: true,
  showLabels: true,
  flyAnim: null,
  shipMode: false,
  // игра
  discovered: new Set(),   // id обнаруженных тел
  credits: 0,
  scanTargetId: null,      // тело под прицелом
  scanTargetDist: 0,
  scanning: null,          // активный скан: { id, t0 }
};

// ───────────────────────── сохранение (localStorage) ─────────────────────────
const SAVE_KEY = 'perihelion.save.v1';
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    if (Array.isArray(s.discovered)) s.discovered.forEach((id) => state.discovered.add(id));
    if (typeof s.credits === 'number') state.credits = s.credits;
  } catch (e) { /* битый сейв — игнорируем */ }
}
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, discovered: [...state.discovered], credits: state.credits,
    }));
  } catch (e) { /* нет доступа к localStorage — не критично */ }
}
loadSave();

// ───────────────────────── позиции тел ─────────────────────────
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();

// Считаем МИРОВЫЕ позиции (Float64) в rec.wpos. Перенос в сцену — в applyOrigin().
function updateBodies() {
  const t = state.simDays;
  for (const d of BODIES) {
    const rec = bodies.get(d.id);
    if (d.kind === 'belt') continue;
    rec.prevPos.copy(rec.group.position);

    if (d.special === 'l2') {
      const e = bodies.get('earth').wpos;
      const len = Math.hypot(e.x, e.y, e.z) || 1;
      const k = 1 + d.dist / len;
      rec.wpos.x = e.x * k; rec.wpos.y = e.y * k; rec.wpos.z = e.z * k;
    } else if (d.special === 'escape') {
      const r = Math.min(d.dist0 + t * d.drift, d.maxDist);
      const az = deg(d.az), el = deg(d.elev);
      rec.wpos.x = Math.cos(az) * Math.cos(el) * r;
      rec.wpos.y = Math.sin(el) * r;
      rec.wpos.z = Math.sin(az) * Math.cos(el) * r;
    } else if (d.parent) {
      const p = bodies.get(d.parent).wpos;
      const a = deg(d.phase || 0) + (t / d.orbitDays) * TWO_PI;
      rec.angle = a;
      V1.set(Math.cos(a) * d.dist, 0, Math.sin(a) * d.dist).applyQuaternion(rec.orbitQuat);
      rec.wpos.x = p.x + V1.x; rec.wpos.y = p.y + V1.y; rec.wpos.z = p.z + V1.z;
    }
    // Солнце (без parent/special) остаётся в начале мира (wpos = 0)

    // собственное вращение
    if (d.spinHours) rec.spinNode.rotation.y = (t * 24 / d.spinHours) * TWO_PI;
    if (d.model === 'voyager') rec.model.rotation.y += 0.0006;
  }
  // Земля: облака и сезонные параметры (не зависят от floating-origin)
  const earth = bodies.get('earth');
  if (earth.clouds) {
    earth.clouds.rotation.y = (t / 1.4) * TWO_PI * 0.08;
    const shift = (earth.clouds.rotation.y - earth.spinNode.rotation.y) / TWO_PI;
    earthUniforms.uCloudShift.value = ((shift % 1) + 1) % 1; // в [0,1) — иначе теряется точность float в шейдере
  }
  const rel = ((earth.angle - Math.PI) % TWO_PI + TWO_PI) % TWO_PI;
  const subLat = Math.cos(rel); // 1 = лето на севере
  earthUniforms.uWinterN.value = Math.max(0, -subLat);
  earthUniforms.uWinterS.value = Math.max(0, subLat);
  // пояса
  for (const b of beltGroups) b.node.rotation.y = (t / b.period) * TWO_PI;
}

// Единственная точка Float64→Float32: переносим сцену так, чтобы камера была у нуля.
function applyOrigin() {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  for (const d of BODIES) {
    const w = bodies.get(d.id).wpos;
    bodies.get(d.id).group.position.set(w.x - ox, w.y - oy, w.z - oz);
  }
  const sun = bodies.get('sun');
  sunLight.position.copy(sun.group.position);     // свет из реальной (сдвинутой) позиции Солнца
  uSunLocal.value.copy(sun.group.position);       // для шейдеров атмосферы/теней/Земли
  // орбитальные линии и ориентация аппаратов — в сдвинутом кадре
  for (const d of BODIES) {
    const rec = bodies.get(d.id);
    if (rec.orbitLine && d.parent) rec.orbitLine.position.copy(bodies.get(d.parent).group.position);
  }
  for (const id of ['parker', 'jwst']) {
    const rec = bodies.get(id);
    if (rec && rec.model) rec.model.lookAt(uSunLocal.value);
  }
  // Земля: направление на Солнце и позиция Луны в сдвинутом кадре
  const earth = bodies.get('earth');
  earthUniforms.uSunDir.value.copy(uSunLocal.value).sub(earth.group.position).normalize();
  earthUniforms.uMoonPos.value.copy(bodies.get('moon').group.position);
}

function seasonInfo(rec) {
  const rel = ((rec.angle - Math.PI) % TWO_PI + TWO_PI) % TWO_PI;
  const idx = Math.floor(rel / (Math.PI / 2)) % 4;
  const subLat = rec.data.tilt * Math.cos(rel);
  return { north: SEASONS_N[idx], south: SEASONS_S[idx], subLat };
}

// ───────────────────────── подписи (labels) ─────────────────────────
const labelsRoot = document.getElementById('labels');
const labelEls = new Map();
for (const d of BODIES) {
  const el = document.createElement('div');
  el.className = `label kind-${d.kind}`;
  el.innerHTML = `<span class="ldot" style="--c:${d.clr}"></span><span>${d.name}</span>`;
  el.addEventListener('click', () => select(d.id, true));
  labelsRoot.appendChild(el);
  labelEls.set(d.id, el);
}

function labelThreshold(d) {
  if (d.kind === 'moon') return 130;
  if (d.kind === 'craft') {
    if (d.special === 'escape') return 4000;
    if (d.special === 'l2') return 260;
    return 42;
  }
  return 4000;
}

const projV = new THREE.Vector3();
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const d of BODIES) {
    const el = labelEls.get(d.id);
    if (!state.showLabels) { el.style.display = 'none'; continue; }
    const rec = bodies.get(d.id);
    let pos;
    if (d.kind === 'belt') {
      const az = Math.atan2(camera.position.z, camera.position.x);
      const rMid = (d.rIn + d.rOut) / 2;
      projV.set(Math.cos(az) * rMid, d.ySpread + 3, Math.sin(az) * rMid);
      pos = projV;
    } else {
      pos = projV.copy(rec.group.position);
    }
    const dist = camera.position.distanceTo(pos);
    const thr = labelThreshold(d);
    if (dist > thr) { el.style.display = 'none'; continue; }
    // не показывать подписи лун/аппаратов, если они слишком близко к камере не нужны
    pos.project(camera);
    if (pos.z > 1) { el.style.display = 'none'; continue; }
    const x = (pos.x * 0.5 + 0.5) * w;
    const y = (-pos.y * 0.5 + 0.5) * h;
    if (x < -80 || x > w + 80 || y < -40 || y > h + 40) { el.style.display = 'none'; continue; }
    el.style.display = 'flex';
    el.style.transform = `translate(-50%, -130%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const fade = Math.min(1, (thr - dist) / (thr * 0.22));
    el.style.opacity = (0.25 + 0.75 * fade).toFixed(2);
    el.classList.toggle('active', state.selected === d.id);
  }
  // линии орбит лун: затухание с расстоянием
  for (const d of BODIES) {
    const rec = bodies.get(d.id);
    if (!rec.orbitLine) continue;
    rec.orbitLine.visible = state.showOrbits;
    if (rec.orbitLineMoonish && state.showOrbits) {
      const dist = camera.position.distanceTo(rec.orbitLine.position);
      const f = Math.max(0, Math.min(1, (160 - dist) / 110));
      rec.orbitLine.material.opacity = 0.5 * f;
      rec.orbitLine.visible = f > 0.02;
    }
  }
  // маркеры: видны издалека, гаснут вблизи
  for (const d of BODIES) {
    const rec = bodies.get(d.id);
    if (!rec.marker) continue;
    const dist = camera.position.distanceTo(rec.group.position);
    rec.marker.scale.setScalar(THREE.MathUtils.clamp(dist * 0.012, 0.2, 7));
    const ang = Math.max(d.radius, 0.4) / dist;
    rec.marker.material.opacity = THREE.MathUtils.clamp((0.006 - ang) / 0.005, 0, 1) * 0.9;
  }
}

// ───────────────────────── выбор и перелёт ─────────────────────────
function bodyFocusPoint(d, rec) {
  if (d.kind === 'belt') {
    const az = Math.atan2(camera.position.z, camera.position.x);
    const rMid = (d.rIn + d.rOut) / 2;
    return new THREE.Vector3(Math.cos(az) * rMid, 0, Math.sin(az) * rMid);
  }
  return rec.group.position.clone();
}

function flyTo(id) {
  const rec = bodies.get(id);
  const d = rec.data;
  let dist;
  if (d.kind === 'star') dist = d.radius * 3.6;
  else if (d.kind === 'belt') dist = 34;
  else dist = Math.max(d.radius * 4.6, d.radius + 1.3);
  state.flyAnim = {
    id, t: 0, dur: 1.9,
    fromCam: camera.position.clone(),
    fromTarget: controls.target.clone(),
    dist,
  };
  state.follow = null;
}

function flyOverview() {
  state.flyAnim = {
    id: null, t: 0, dur: 1.7,
    fromCam: camera.position.clone(),
    fromTarget: controls.target.clone(),
    overviewCam: new THREE.Vector3(OVERVIEW_POS[0], OVERVIEW_POS[1], OVERVIEW_POS[2]),
    overviewTarget: new THREE.Vector3(0, 0, 0),
  };
  state.follow = null;
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

function updateFlyAnim(dt) {
  const fa = state.flyAnim;
  if (!fa) return;
  fa.t += dt / fa.dur;
  const e = easeInOut(Math.min(1, fa.t));
  let endTarget, endCam;
  if (fa.id === null) {
    endTarget = fa.overviewTarget;
    endCam = fa.overviewCam;
  } else {
    const rec = bodies.get(fa.id);
    endTarget = bodyFocusPoint(rec.data, rec);
    if (!fa.dir) {
      fa.dir = camera.position.clone().sub(endTarget).normalize();
      if (fa.dir.lengthSq() < 0.01) fa.dir = new THREE.Vector3(0.5, 0.35, 0.8).normalize();
      fa.dir.y = Math.max(fa.dir.y, 0.25);
      fa.dir.normalize();
    }
    endCam = endTarget.clone().add(V2.copy(fa.dir).multiplyScalar(fa.dist));
  }
  camera.position.lerpVectors(fa.fromCam, endCam, e);
  controls.target.lerpVectors(fa.fromTarget, endTarget, e);
  if (fa.t >= 1) {
    if (fa.id && bodies.get(fa.id).data.kind !== 'belt') {
      state.follow = fa.id;
      bodies.get(fa.id).prevPos.copy(bodies.get(fa.id).group.position);
    }
    state.flyAnim = null;
  }
}

function updateFollow() {
  if (!state.follow || state.flyAnim) return;
  const rec = bodies.get(state.follow);
  V1.copy(rec.group.position).sub(rec.prevPos);
  if (V1.lengthSq() > 0) {
    camera.position.add(V1);
    controls.target.add(V1);
  }
}

// ───────────────────────── UI: сайдбар ─────────────────────────
const ICONS = {
  star: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></g></svg>',
  planet: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="currentColor"/><ellipse cx="12" cy="12" rx="10.5" ry="3.6" fill="none" stroke="currentColor" stroke-width="1.5" transform="rotate(-18 12 12)"/></svg>',
  dwarf: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><circle cx="17.5" cy="8" r="1.4" fill="currentColor" opacity="0.6"/><circle cx="6" cy="16.5" r="1.1" fill="currentColor" opacity="0.6"/></svg>',
  belt: '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="4" cy="14" r="1.5"/><circle cx="8.5" cy="10.5" r="2"/><circle cx="13.5" cy="9" r="1.4"/><circle cx="18" cy="10.8" r="1.9"/><circle cx="21" cy="14.5" r="1.2"/><circle cx="11" cy="14.8" r="1.1"/><circle cx="16" cy="15" r="0.9"/></g></svg>',
  craft: '<svg viewBox="0 0 24 24"><g fill="currentColor"><rect x="10" y="9" width="4" height="6" rx="1"/><rect x="2" y="10.5" width="6" height="3" rx="0.8" opacity="0.75"/><rect x="16" y="10.5" width="6" height="3" rx="0.8" opacity="0.75"/></g></svg>',
  wormhole: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6.4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/><path d="M3.2 12c2-4.4 5.8-6.8 8.8-6.8M20.8 12c-2 4.4-5.8 6.8-8.8 6.8" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6"/></svg>',
};

function buildSidebar() {
  const tree = document.getElementById('tree');
  let html = '';
  for (const cat of SIDEBAR) {
    html += `<div class="cat"><div class="cat-title"><span class="cat-ico">${ICONS[cat.icon]}</span>${cat.title}</div><ul>`;
    for (const item of cat.items) {
      const it = typeof item === 'string' ? { id: item } : item;
      const d = BODIES.find((b) => b.id === it.id);
      const hasKids = it.children && it.children.length;
      html += `<li><div class="row" data-id="${d.id}">
        <span class="dot" style="--c1:${d.clr};--c2:${d.clr2}"></span>
        <span class="row-name">${d.name}</span>
        ${hasKids ? '<button class="exp" title="Спутники">▾</button>' : ''}
      </div>`;
      if (hasKids) {
        html += '<ul class="children">';
        for (const cid of it.children) {
          const c = BODIES.find((b) => b.id === cid);
          html += `<li><div class="row child" data-id="${c.id}">
            <span class="dot" style="--c1:${c.clr};--c2:${c.clr2}"></span>
            <span class="row-name">${c.name}</span>
          </div></li>`;
        }
        html += '</ul>';
      }
      html += '</li>';
    }
    html += '</ul></div>';
  }
  tree.innerHTML = html;

  tree.addEventListener('click', (e) => {
    const exp = e.target.closest('.exp');
    if (exp) {
      e.stopPropagation();
      const li = exp.closest('li');
      li.classList.toggle('open');
      return;
    }
    const row = e.target.closest('.row');
    if (row) select(row.dataset.id, true);
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    tree.querySelectorAll('.row').forEach((row) => {
      const name = row.querySelector('.row-name').textContent.toLowerCase();
      const show = !q || name.includes(q);
      row.parentElement.style.display = show ? '' : 'none';
      if (show && q) {
        const ul = row.closest('ul.children');
        if (ul) ul.closest('li').classList.add('open');
      }
    });
  });
}
buildSidebar();

// ───────────────────────── UI: панель информации ─────────────────────────
const infoPanel = document.getElementById('infoPanel');

function renderInfo(d) {
  const known = state.discovered.has(d.id);
  document.getElementById('infoPortrait').style.background =
    `radial-gradient(circle at 32% 30%, ${d.clr}, ${d.clr2} 70%, #0a0e1a 100%)`;
  document.getElementById('infoKind').textContent = KIND_LABEL[d.kind];
  document.getElementById('infoName').textContent = d.name;
  document.getElementById('infoEn').textContent = d.en;
  if (known) {
    const facts = d.facts.map(([k, v]) => `<div class="fact"><span>${k}</span><b>${v}</b></div>`).join('');
    document.getElementById('infoDesc').textContent = d.desc;
    document.getElementById('infoFacts').innerHTML = facts;
  } else {
    document.getElementById('infoDesc').textContent = 'Объект не просканирован. Войдите в режим полёта (F), наведите прицел на объект и просканируйте (ЛКМ) — данные откроются в кодексе.';
    document.getElementById('infoFacts').innerHTML = '';
  }
  document.getElementById('infoLive').innerHTML = '';
  document.getElementById('btnJump').style.display = d.kind === 'wormhole' ? 'flex' : 'none';
  infoPanel.classList.add('open');
}

function updateInfoLive() {
  if (!state.selected || !state.discovered.has(state.selected)) {
    document.getElementById('infoLive').innerHTML = '';
    return;
  }
  const rec = bodies.get(state.selected);
  const d = rec.data;
  const live = document.getElementById('infoLive');
  let html = '';
  if (d.seasons) {
    const s = seasonInfo(rec);
    html += `<div class="live-row"><span>Сезон, северное полушарие</span><b>${s.north}</b></div>`;
    html += `<div class="live-row"><span>Сезон, южное полушарие</span><b>${s.south}</b></div>`;
    html += `<div class="live-row"><span>Подсолнечная широта</span><b>${s.subLat >= 0 ? '+' : ''}${s.subLat.toFixed(1)}°</b></div>`;
  }
  if (!d.special && d.parent && d.orbitDays) {
    const longDeg = (((rec.angle % TWO_PI) + TWO_PI) % TWO_PI) * 180 / Math.PI;
    const pd = d.parent === 'sun' ? null : BODIES.find((b) => b.id === d.parent);
    html += `<div class="live-row"><span>Долгота на орбите${pd ? ` (${pd.name})` : ''}</span><b>${longDeg.toFixed(0)}°</b></div>`;
  }
  live.innerHTML = html;
}
setInterval(updateInfoLive, 300);

function select(id, fly) {
  state.selected = id;
  const rec = bodies.get(id);
  renderInfo(rec.data);
  document.querySelectorAll('#tree .row').forEach((r) => {
    r.classList.toggle('active', r.dataset.id === id);
    if (r.dataset.id === id) {
      const ul = r.closest('ul.children');
      if (ul) ul.closest('li').classList.add('open');
    }
  });
  selRing.visible = rec.data.kind !== 'belt';
  if (fly) flyTo(id);
}

function deselect() {
  state.selected = null;
  state.follow = null;
  selRing.visible = false;
  infoPanel.classList.remove('open');
  document.querySelectorAll('#tree .row.active').forEach((r) => r.classList.remove('active'));
}

document.getElementById('infoClose').addEventListener('click', deselect);
document.getElementById('btnGoto').addEventListener('click', () => {
  if (state.selected) flyTo(state.selected);
});

// прыжок через червоточину → страница Гаргантюа
let jumping = false;
document.getElementById('btnJump').addEventListener('click', () => {
  if (jumping || state.selected !== 'wormhole') return;
  jumping = true;
  flyTo('wormhole');
  if (state.flyAnim) { state.flyAnim.dur = 1.25; state.flyAnim.dist = 0.9; } // рывок внутрь сферы
  wormholeTunnel(() => { location.href = 'blackhole.html#wormhole'; });
});

// ───────────────────────── UI: управление временем ─────────────────────────
const btnPause = document.getElementById('btnPause');
const speedSlider = document.getElementById('speedSlider');
const speedLabel = document.getElementById('speedLabel');
const simDateEl = document.getElementById('simDate');

function fmtSpeed(dps) {
  if (dps < 1 / 24) return `${Math.round(dps * 1440)} мин/с`;
  if (dps < 1) return `${(dps * 24).toFixed(dps * 24 < 3 ? 1 : 0)} ч/с`;
  if (dps < 30) return `${dps.toFixed(dps < 3 ? 1 : 0)} сут/с`;
  if (dps < 365.25) return `${(dps / 30.44).toFixed(1)} мес/с`;
  return `${(dps / 365.25).toFixed(1)} лет/с`;
}
function setSpeed(dps, fromSlider) {
  state.speed = dps;
  speedLabel.textContent = `1 с = ${fmtSpeed(dps)}`;
  if (!fromSlider) {
    speedSlider.value = ((Math.log10(dps) + 2.5) / 5.5 * 1000).toFixed(0);
  }
  document.querySelectorAll('.preset').forEach((b) => {
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - dps) / dps < 0.01);
  });
}
speedSlider.addEventListener('input', () => {
  const t = parseFloat(speedSlider.value) / 1000;
  setSpeed(10 ** (t * 5.5 - 2.5), true);
});
document.querySelectorAll('.preset').forEach((b) => {
  b.addEventListener('click', () => setSpeed(parseFloat(b.dataset.speed)));
});
function setPaused(p) {
  state.paused = p;
  btnPause.innerHTML = p
    ? '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor"/></svg>';
  btnPause.title = p ? 'Продолжить (пробел)' : 'Пауза (пробел)';
}
btnPause.addEventListener('click', () => setPaused(!state.paused));
setSpeed(1 / 24);
setPaused(false);

function updateSimDate() {
  const date = new Date(SIM_START.getTime() + state.simDays * 86400000);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  simDateEl.textContent = `${date.getDate()} ${MONTHS_RU[date.getMonth()]} ${date.getFullYear()} · ${hh}:${mm}`;
}
setInterval(updateSimDate, 200);
updateSimDate();

// тумблеры
document.getElementById('tglOrbits').addEventListener('click', (e) => {
  state.showOrbits = !state.showOrbits;
  e.currentTarget.classList.toggle('on', state.showOrbits);
});
document.getElementById('tglLabels').addEventListener('click', (e) => {
  state.showLabels = !state.showLabels;
  e.currentTarget.classList.toggle('on', state.showLabels);
});
document.getElementById('btnOverview').addEventListener('click', () => { deselect(); flyOverview(); });
document.getElementById('btnMenu').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

// помощь
const helpModal = document.getElementById('helpModal');
document.getElementById('btnHelp').addEventListener('click', () => helpModal.classList.add('open'));
document.getElementById('helpClose').addEventListener('click', () => helpModal.classList.remove('open'));
helpModal.addEventListener('click', (e) => { if (e.target === helpModal) helpModal.classList.remove('open'); });

// подсказка
setTimeout(() => document.getElementById('hint').classList.add('gone'), 11000);

// ───────────────────────── режим полёта ─────────────────────────
function toggleShipMode() {
  state.shipMode = !state.shipMode;
  if (state.shipMode) {
    deselect();
    state.flyAnim = null;
    state.follow = null;
    controls.enabled = false;
    shipCtl.spawnFromCamera(camera, origin); // origin (обзор=0) → мировая позиция корабля
    shipCtl.enable();
    document.body.classList.add('ship-mode');
  } else {
    shipCtl.disable();
    controls.enabled = true;
    // вернуть камеру в мировой кадр: в полёте она была локальной (относительно origin=корабль)
    const w = shipCtl.wpos;
    camera.position.x += w.x; camera.position.y += w.y; camera.position.z += w.z;
    controls.target.set(w.x, w.y, w.z);
    document.body.classList.remove('ship-mode');
  }
}

// HUD режима полёта (минимальный — основа будущего кокпита)
const fhSpeedEl = document.getElementById('fhSpeed');
const fhBarEl = document.getElementById('fhBar');
const fhBoostEl = document.getElementById('fhBoost');
const fhFoundEl = document.getElementById('fhFound');
const fhTotalEl = document.getElementById('fhTotal');
const fhCreditsEl = document.getElementById('fhCredits');
function updateFlightHud() {
  const sp = shipCtl.getSpeed();
  if (fhSpeedEl) fhSpeedEl.textContent = Math.round(sp);
  if (fhBarEl) fhBarEl.style.width = `${Math.min(100, (sp / (shipCtl.maxSpeed * shipCtl.boostMult)) * 100)}%`;
  if (fhBoostEl) fhBoostEl.classList.toggle('on', shipCtl.boosting);
  if (fhCreditsEl) fhCreditsEl.textContent = state.credits;
}

// ═════════════════════ ИГРА: сканирование и кодекс ═════════════════════
const SCAN_DUR = 0.6;          // длительность скана, с
const SCAN_CONE = 0.985;       // ширина конуса захвата (~10° от курса)
const SCANNABLE = BODIES.filter((b) => b.kind !== 'belt');
const SCAN_TOTAL = SCANNABLE.length;
if (fhTotalEl) fhTotalEl.textContent = SCAN_TOTAL;

// прицел/баннер DOM
const reticleEl = document.getElementById('reticle');
const retNameEl = document.getElementById('retName');
const retMetaEl = document.getElementById('retMeta');
const retProgEl = document.querySelector('#reticle .ret-prog');
const bannerEl = document.getElementById('discoveryBanner');
const RET_CIRC = 213.6;        // длина окружности дуги прогресса
let bannerTimer = null;

// мировой пульс-кольцо на сканируемом теле (переиспользуем текстуру кольца выбора)
const scanRing = new THREE.Sprite(new THREE.SpriteMaterial({
  map: new THREE.CanvasTexture(spriteSelectionRing()),
  transparent: true, opacity: 0, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending,
}));
scanRing.renderOrder = 998;
scanRing.visible = false;
scene.add(scanRing);
let popFx = null;              // вспышка по завершении: { id, t0 }

const scanFwd = new THREE.Vector3();
const scanTo = new THREE.Vector3();
function scanRangeOf(d) { return 35 + d.radius * 14; }

// цель ещё в поле зрения? (мягкий конус — чтобы скан не срывался от соседей)
function targetValid(id) {
  const rec = bodies.get(id);
  camera.getWorldDirection(scanFwd);
  scanTo.copy(rec.group.position).sub(camera.position);
  const dist = scanTo.length();
  if (dist > scanRangeOf(rec.data) * 1.3 || dist < 1e-3) return false;
  scanTo.divideScalar(dist);
  return scanTo.dot(scanFwd) > 0.93;
}

// какое тело сейчас по курсу (в пределах конуса и дальности)
function updateScanTarget() {
  // во время скана цель залочена — близкие соседи (МКС, Луна) её не перебивают
  if (state.scanning) {
    state.scanTargetId = state.scanning.id;
    state.scanTargetDist = camera.position.distanceTo(bodies.get(state.scanning.id).group.position);
    return;
  }
  camera.getWorldDirection(scanFwd);
  let best = null, bestDot = SCAN_CONE, bestDist = 0;
  for (const d of SCANNABLE) {
    const rec = bodies.get(d.id);
    scanTo.copy(rec.group.position).sub(camera.position);
    const dist = scanTo.length();
    if (dist > scanRangeOf(d) || dist < 1e-3) continue;
    scanTo.divideScalar(dist);
    const dot = scanTo.dot(scanFwd);
    if (dot > bestDot) { bestDot = dot; best = d.id; bestDist = dist; }
  }
  state.scanTargetId = best;
  state.scanTargetDist = bestDist;
}

function startScan() {
  const id = state.scanTargetId;
  if (!id || state.scanning || state.discovered.has(id)) return;
  state.scanning = { id, t0: elapsed };
}

function updateScanning() {
  const sc = state.scanning;
  if (!sc) return;
  if (!targetValid(sc.id)) { state.scanning = null; return; } // цель ушла из поля зрения — отмена
  if (elapsed - sc.t0 >= SCAN_DUR) {
    completeScan(sc.id);
    popFx = { id: sc.id, t0: elapsed };
    state.scanning = null;
  }
}

function completeScan(id) {
  if (state.discovered.has(id)) return;
  state.discovered.add(id);
  state.credits += 100;
  persist();
  applyDiscoveredClasses();
  if (fhCreditsEl) fhCreditsEl.textContent = state.credits;
  showDiscovery(bodies.get(id).data);
}

function showDiscovery(d) {
  bannerEl.innerHTML = `<span class="db-tag">ОБНАРУЖЕНО</span><b>${d.name}</b>`
    + `<span class="db-kind">${KIND_LABEL[d.kind]}</span><span class="db-cr">+100 кр</span>`;
  bannerEl.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => bannerEl.classList.remove('show'), 2600);
}

function applyDiscoveredClasses() {
  document.querySelectorAll('#tree .row').forEach((r) => {
    r.classList.toggle('found', state.discovered.has(r.dataset.id));
  });
  if (fhFoundEl) fhFoundEl.textContent = state.discovered.size;
}

// мировые эффекты скана (кольцо на теле + вспышка)
function updateScanFx() {
  const sc = state.scanning;
  if (sc) {
    const rec = bodies.get(sc.id);
    scanRing.visible = true;
    scanRing.position.copy(rec.group.position);
    const base = Math.max(rec.data.radius * 4.5, 1.5);
    scanRing.scale.setScalar(base * (1 + 0.12 * Math.sin(elapsed * 9)));
    scanRing.material.rotation = elapsed * 1.8;
    scanRing.material.opacity = 0.85;
  } else if (popFx) {
    const rec = bodies.get(popFx.id);
    const p = (elapsed - popFx.t0) / 0.5;
    if (p >= 1) { popFx = null; scanRing.visible = false; } else {
      scanRing.visible = true;
      scanRing.position.copy(rec.group.position);
      const base = Math.max(rec.data.radius * 4.5, 1.5);
      scanRing.scale.setScalar(base * (1 + p * 1.8));
      scanRing.material.opacity = 0.9 * (1 - p);
      scanRing.material.rotation = elapsed * 1.8;
    }
  } else if (scanRing.visible) {
    scanRing.visible = false;
  }
}

// прицел (центр экрана)
function updateReticleHud() {
  const id = state.scanTargetId;
  if (!id) {
    reticleEl.className = 'ret-idle';
    retNameEl.textContent = '';
    retMetaEl.textContent = '';
    return;
  }
  const d = bodies.get(id).data;
  const known = state.discovered.has(id);
  const scanning = state.scanning && state.scanning.id === id;
  reticleEl.className = scanning ? 'ret-scan' : (known ? 'ret-known' : 'ret-lock');
  retNameEl.textContent = d.name;
  if (scanning) {
    const p = Math.min(1, (elapsed - state.scanning.t0) / SCAN_DUR);
    retMetaEl.textContent = `Сканирование… ${Math.round(p * 100)}%`;
    if (retProgEl) retProgEl.style.strokeDashoffset = (RET_CIRC * (1 - p)).toFixed(1);
  } else if (known) {
    retMetaEl.textContent = `${KIND_LABEL[d.kind]} · в кодексе`;
  } else {
    retMetaEl.textContent = `${KIND_LABEL[d.kind]} · ${Math.round(state.scanTargetDist)} ед · ЛКМ — скан`;
  }
}

// первичная разметка сайдбара по сейву (после объявления всех ссылок выше)
applyDiscoveredClasses();

// ───────────────────────── клавиатура ─────────────────────────
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); if (!state.shipMode) setPaused(!state.paused); return; }
  if (e.code === 'KeyF') { e.preventDefault(); toggleShipMode(); return; }
  if (e.code === 'KeyR' && state.shipMode) { e.preventDefault(); startScan(); return; }
  if (e.code === 'Escape') { deselect(); helpModal.classList.remove('open'); return; }
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
    keys.add(e.code);
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
function updateKeys(dt) {
  if (!keys.size) return;
  camera.getWorldDirection(fwd);
  right.crossVectors(fwd, up).normalize();
  const boost = (keys.has('ShiftLeft') || keys.has('ShiftRight')) ? 3.6 : 1;
  const speed = THREE.MathUtils.clamp(controls.getDistance() * 0.9, 1.5, 320) * boost * dt;
  V1.set(0, 0, 0);
  if (keys.has('KeyW')) V1.addScaledVector(fwd, speed);
  if (keys.has('KeyS')) V1.addScaledVector(fwd, -speed);
  if (keys.has('KeyA')) V1.addScaledVector(right, -speed);
  if (keys.has('KeyD')) V1.addScaledVector(right, speed);
  if (keys.has('KeyQ')) V1.addScaledVector(up, -speed);
  if (keys.has('KeyE')) V1.addScaledVector(up, speed);
  if (V1.lengthSq() > 0) {
    camera.position.add(V1);
    controls.target.add(V1);
    state.flyAnim = null;
  }
}

// ───────────────────────── выбор кликом по сцене ─────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.shipMode) {
    // ЛКМ в полёте при активном захвате мыши — скан цели
    if (e.button === 0 && document.pointerLockElement === canvas) startScan();
    return;
  }
  downPos = [e.clientX, e.clientY];
});
canvas.addEventListener('pointerup', (e) => {
  if (state.shipMode) return;
  if (!downPos) return;
  const dx = e.clientX - downPos[0], dy = e.clientY - downPos[1];
  downPos = null;
  if (dx * dx + dy * dy > 36) return; // это было вращение камеры
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  if (!hits.length) { deselect(); return; }
  // приоритет небесным телам перед широкими мишенями поясов
  const solid = hits.find((h) => !h.object.userData.isBelt);
  const pick = solid || hits[0];
  select(pick.object.userData.bodyId, true);
});
canvas.addEventListener('pointermove', (e) => {
  if (state.shipMode || downPos) return;
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(hitMeshes, false);
  canvas.style.cursor = hits.length ? 'pointer' : 'grab';
});

// ───────────────────────── цикл анимации ─────────────────────────
const clock = new THREE.Clock();
let elapsed = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;

  if (!state.paused) state.simDays += dt * state.speed;

  updateBodies();

  // floating-origin: движение режима задаёт origin, applyOrigin переносит сцену к нулю
  if (state.shipMode) {
    shipCtl.update(dt);
    origin.x = shipCtl.wpos.x; origin.y = shipCtl.wpos.y; origin.z = shipCtl.wpos.z;
  } else {
    origin.x = 0; origin.y = 0; origin.z = 0;
  }
  applyOrigin();

  // обзорная камера читает уже сдвинутые позиции
  if (!state.shipMode) {
    updateKeys(dt);
    updateFollow();
    updateFlyAnim(dt);
    controls.update();
  }

  // Солнце: живая поверхность и корона (независимо от паузы)
  sunUniforms.uTime.value = elapsed;
  wormUniforms.uTime.value = elapsed;
  flash = Math.max(0, flash - dt * 0.55);
  sunUniforms.uFlash.value = flash;
  sunLight.intensity = 2.6 + flash * 1.1;
  if (sunParts) {
    const pulse = 1 + Math.sin(elapsed * 0.7) * 0.035 + flash * 0.12;
    sunParts.corona1.scale.setScalar(16 * 4.6 * pulse);
    sunParts.corona2.scale.setScalar(16 * 6.2 * (2 - pulse));
    sunParts.corona1.material.rotation += dt * 0.02;
    sunParts.corona2.material.rotation -= dt * 0.015;
    sunParts.halo.material.opacity = 0.8 + flash * 0.2;
  }
  // корональные выбросы; часть из них летит в сторону Земли (направление — в мире)
  if (elapsed > nextCME) {
    const burst = cmePool.find((c) => !c.points.visible);
    if (burst) {
      const atEarth = Math.random() < 0.45;
      const ew = bodies.get('earth').wpos;
      const earthDir = V3.set(ew.x, ew.y, ew.z).normalize();
      burst.fire(elapsed, atEarth ? earthDir : null);
      flash = 1;
      if (atEarth) triggerAurora(elapsed, burst.duration * 0.78);
    }
    nextCME = elapsed + 6 + Math.random() * 9;
  }
  for (const c of cmePool) c.update(elapsed);

  // полярные сияния: разгораются с приходом выброса и медленно гаснут
  auroraUniforms.uTime.value = elapsed;
  const aAge = elapsed - auroraStart;
  let aI = 0;
  if (aAge > 0 && aAge < 24) {
    aI = THREE.MathUtils.smoothstep(aAge, 0, 3) * (1 - THREE.MathUtils.smoothstep(aAge, 15, 24));
  }
  auroraUniforms.uIntensity.value = aI * (0.8 + 0.2 * Math.sin(elapsed * 2.3) * Math.sin(elapsed * 1.7));

  // кольцо выделения (после applyOrigin — позиция уже сдвинута)
  if (state.selected && selRing.visible) {
    const rec = bodies.get(state.selected);
    selRing.position.copy(rec.group.position);
    const base = Math.max(rec.data.radius * 5.4, 1.6);
    selRing.scale.setScalar(base * (1 + Math.sin(elapsed * 2.4) * 0.06));
    selRing.material.rotation = elapsed * 0.35;
  }

  updateShadowUniforms();
  if (state.shipMode) {
    updateScanTarget();
    updateScanning();
    updateScanFx();
    updateFlightHud();
    updateReticleHud();
  }
  updateLabels();

  skyGroup.position.copy(camera.position); // фон следует за камерой → бесконечен
  composer.render();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// отладочные хуки (для консоли браузера)
window.__app = {
  renderer, composer, scene, camera, bodies, controls, shipCtl, playerShip,
  toggleShipMode, state, startScan, completeScan, persist,
  origin, applyOrigin, updateBodies, uSunLocal,
  resetSave: () => { state.discovered.clear(); state.credits = 0; persist(); applyDiscoveredClasses(); },
};
window.__cmeEarth = () => {
  const burst = cmePool.find((c) => !c.points.visible) || cmePool[0];
  const ew = bodies.get('earth').wpos;
  burst.fire(elapsed, new THREE.Vector3(ew.x, ew.y, ew.z).normalize());
  flash = 1;
  triggerAurora(elapsed, burst.duration * 0.78);
};

// первый кадр посчитан — убираем загрузчик
updateBodies();
applyOrigin(); // перенести позиции в сцену до любого пред-стартового кода
// прибытие через червоточину со страницы Гаргантюа
if (location.hash === '#wormhole') {
  history.replaceState(null, '', location.pathname);
  const w = bodies.get('wormhole');
  camera.position.copy(w.group.position).add(new THREE.Vector3(5, 2.5, 5));
  controls.target.copy(w.group.position);
  select('wormhole', false);
  wormholeArrival();
}
animate();
requestAnimationFrame(() => {
  document.getElementById('loader').classList.add('done');
  setTimeout(() => document.getElementById('loader').remove(), 900);
});

// ============================================================
//  Перигелий — полётная модель корабля (аркадный 6DOF)
//  Кватернионное управление + чейз-камера + буст.
//  Корабль = отдельная сущность; камера тянется следом.
// ============================================================
import * as THREE from 'three';
import { spriteGlow } from './textures.js';

const FWD = new THREE.Vector3(0, 0, -1); // локальный «нос» корабля

// ───────────────────────── модель корабля ─────────────────────────
// Калдарийский крейсер в духе EVE «Caracal»: слоистый угловатый сине-серый корпус,
// дорсальная сенсорная башня, боковые гондолы, многосопловая корма. Нос — в −Z.
// Строится в «модельных» единицах (~6 длиной); истинный масштаб задаёт main.js
// (setShipLength) — реальный крейсер ≈ 250 м = 2.5e-4 ед сцены.
export function buildPlayerShip() {
  const g = new THREE.Group();
  const M = (color, metalness, roughness, emissive = 0x0a1020, ei = 0.35) =>
    new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: ei });
  const hull = M(0x8c96a6, 0.72, 0.46);
  const hullLt = M(0xa8b2c0, 0.66, 0.5);
  const dark = M(0x39414f, 0.8, 0.42, 0x05070d, 0.3);
  const accent = M(0x2f6dff, 0.4, 0.3, 0x2456e0, 1.6);
  const glassMat = M(0x101a2e, 0.3, 0.16, 0x1b3b7a, 0.9);

  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };

  // ── корпус: слоистые плиты ──
  add(new THREE.BoxGeometry(1.3, 0.46, 3.6), hull, 0, 0, 0);            // нижняя плита
  add(new THREE.BoxGeometry(0.95, 0.34, 2.5), hullLt, 0, 0.36, -0.25); // верхняя палуба
  add(new THREE.BoxGeometry(1.16, 0.2, 2.0), dark, 0, -0.28, 0.1);     // брюшная панель
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.22, 0.5, 2.8), hull, s * 0.72, 0.02, 0.1); // борта

  // ── нос-клин (плоский 4-гранный) ──
  add(new THREE.ConeGeometry(0.62, 1.7, 4), hull, 0, 0.04, -2.55, -Math.PI / 2, 0, Math.PI / 4)
    .scale.set(1.25, 0.62, 1);
  add(new THREE.BoxGeometry(0.5, 0.16, 0.8), dark, 0, 0.16, -1.9);

  // ── дорсальная сенсорная башня (калдарийская черта) ──
  add(new THREE.BoxGeometry(0.34, 0.55, 0.6), hullLt, 0, 0.72, -0.55);
  add(new THREE.BoxGeometry(0.2, 0.3, 0.3), dark, 0, 1.05, -0.55);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), hull, 0, 1.35, -0.55);
  add(new THREE.SphereGeometry(0.06, 8, 6), accent, 0, 1.62, -0.55);

  // ── боковые гондолы (свёрнуты внутрь) ──
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.4, 0.5, 2.1), hull, s * 0.95, -0.02, 0.55, 0, s * -0.06, 0);
    add(new THREE.BoxGeometry(0.34, 0.4, 0.5), dark, s * 0.98, -0.02, 1.55);
    add(new THREE.CylinderGeometry(0.15, 0.11, 0.34, 10), dark, s * 0.98, -0.02, 1.78, Math.PI / 2, 0, 0);
  }

  // ── кормовой двигательный блок + сопла ──
  add(new THREE.BoxGeometry(1.0, 0.5, 0.55), dark, 0, 0, 1.85);
  for (const x of [-0.3, 0.3]) add(new THREE.CylinderGeometry(0.17, 0.12, 0.38, 10), dark, x, 0.02, 2.1, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.2, 0.14, 0.4, 12), dark, 0, 0.02, 2.12, Math.PI / 2, 0, 0);

  // ── мостик (тёмное стекло) ──
  add(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), glassMat, 0, 0.28, -1.15)
    .scale.set(1, 0.7, 1.6);

  // ── синие акцентные полосы ──
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.1, 2.2), accent, s * 0.66, 0.06, 0);
  add(new THREE.BoxGeometry(0.5, 0.05, 0.08), accent, 0, 0.54, -1.2);

  // ── гриблы (панели) ──
  for (const [x, y, z] of [[0.3, 0.18, -0.8], [-0.35, 0.2, 0.3], [0, 0.26, 0.9], [0.4, -0.1, -0.4], [-0.3, -0.12, 0.6]])
    add(new THREE.BoxGeometry(0.18, 0.1, 0.22), dark, x, y, z);

  // ── навигационные огни (красный слева, зелёный справа) ──
  add(new THREE.SphereGeometry(0.05, 8, 6), M(0xff3030, 0.2, 0.4, 0xff2020, 2.2), -1.18, -0.02, 0.5);
  add(new THREE.SphereGeometry(0.05, 8, 6), M(0x30ff50, 0.2, 0.4, 0x20ff40, 2.2), 1.18, -0.02, 0.5);

  // ── свечение сопел (растёт с тягой) ──
  const glowTex = new THREE.CanvasTexture(spriteGlow('rgba(150,205,255,0.95)', 'rgba(60,120,240,0.18)', 128));
  const glows = [];
  for (const [x, y, z] of [[-0.98, -0.02, 1.98], [0, 0.02, 2.36], [0.98, -0.02, 1.98], [-0.3, 0.02, 2.34], [0.3, 0.02, 2.34]]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
    }));
    sp.position.set(x, y, z);
    sp.scale.setScalar(x === 0 ? 0.95 : 0.7);
    g.add(sp);
    glows.push(sp);
  }

  g.userData.glows = glows;
  g.userData.modelLength = 5.9; // нос z≈−3.4 … сопла z≈+2.5
  return g;
}

// ───────────────────────── контроллер ─────────────────────────
export class ShipControls {
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.ship = opts.ship;
    this.enabled = false;

    // состояние корабля
    this.wpos = { x: 0, y: 0, z: 0 }; // мировая позиция в Float64 (floating-origin)
    this.pos = new THREE.Vector3();   // локальная позиция (в полёте всегда ~0: мир движется вокруг)
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.boosting = false;

    // ── управление: throttle-круиз + руль с клавиш + free-look камера ──
    // (можно крутить вживую через window.__app.shipCtl)
    this.THROTTLE_SPEEDS = [-1000, -500, 0, 500, 2500, 10000]; // ед/с по индексу −2..3
    this.throttle = 0;        // индекс −2..3 (0 = стоп); speed = THROTTLE_SPEEDS[throttle+2]
    this.engineAccel = 6000;  // ед/с² — как быстро движок выходит на заданную скорость
    this.pitchRate = 0.9;     // рад/с тангажа (W нос вниз / S нос вверх)
    this.yawRate = 0.9;       // рад/с рыскания (A влево / D вправо)
    // free-look: мышь крутит камеру вокруг корабля (это не руль)
    this.lookYaw = 0; this.lookPitch = 0;
    this.lookSens = 0.0022;   // чувствительность обзора
    this.lookReturn = 0.05;   // возврат камеры за корму при простое мыши (меньше = быстрее)
    this.fovBase = opts.fovBase || camera.fov;
    this.camBack = 7.6;       // отступ камеры назад (масштабируется под корабль)
    this.camUp = 2.1;         // отступ камеры вверх
    this.camLead = 6;         // куда смотрит камера (кадрирование носа)
    this.spawnOffset = 10;    // на сколько ед. вперёд спавнить корабль (масштаб. под него)

    // ввод
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;

    // временные
    this._fwd = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._dq = new THREE.Quaternion();
    this._euler = new THREE.Euler(0, 0, 0, 'XYZ');
    this._lookAt = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._qLook = new THREE.Quaternion();
    this._grav = new THREE.Vector3();
    // внешняя гравитация: main.js задаёт функцию (wpos, outVec) → ускорение колодца (ед/с²)
    this.gravityFn = null;
    // орбитальный захват (клавиша G): {mu, r, w, bodyId}; центр — wpos тела (main.js)
    this.orbit = null;
    this.orbitCenter = new THREE.Vector3();
    this._oRel = new THREE.Vector3();
    this._oN = new THREE.Vector3();
    this._oTan = new THREE.Vector3();
    // варп-круиз (Elite supercruise): {bodyId, arrivalDist, rate, dist}; центр — wpos
    // цели, обновляет main.js каждый кадр. Скорость ∝ оставшейся дистанции → плавный
    // экспоненциальный подлёт и торможение, выход в сублайт у границы воронки.
    this.warp = null;
    this.warpCenter = new THREE.Vector3();
    // посадка (этап 13): коллизия со сферой + «приклеивание» к поверхности.
    // Землю (центр+радиус тела колодца) задаёт main.js каждый кадр.
    this.groundCenter = new THREE.Vector3();
    this.groundRadius = 0;          // радиус тела-земли (ед.); 0 = земли нет
    this.groundBodyId = null;
    this.landed = null;             // bodyId, когда на поверхности
    this.landNormal = new THREE.Vector3();
    this.landClearance = 0.2;       // зазор над поверхностью (масштабируется под корабль)
    this.LAND_SPEED = 600;          // макс. скорость для посадки (ед/с)
    this.landAltFrac = 0.25;        // макс. высота посадки = groundRadius × это
    // приповерхностный режим: у поверхности тяга авто-снижается (точный подлёт/посадка)
    this.nearAltFrac = 0.8;         // замедление при AGL < groundRadius × это
    this.minSpeedScale = 0.008;     // мин. множитель скорости у самой поверхности
    this.altAGL = Infinity;         // высота над поверхностью (ед.) — для HUD
    this.speedScale = 1;            // текущий множитель скорости

    this._justLocked = false;
    this._onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => { this.keys.clear(); this.mouseDX = 0; this.mouseDY = 0; };
    this._onMouseMove = (e) => {
      if (!this.enabled || document.pointerLockElement !== this.dom) return;
      if (this._justLocked) { this._justLocked = false; return; } // отбрасываем стартовый рывок захвата
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onClick = () => {
      if (this.enabled && document.pointerLockElement !== this.dom) this._requestLock();
    };
    this._onPLChange = () => {
      if (document.pointerLockElement === this.dom) this._justLocked = true;
      else { this.mouseDX = 0; this.mouseDY = 0; } // лок потерян — сбрасываем накопленные дельты
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPLChange);
    this.dom.addEventListener('click', this._onClick);
  }

  // встать перед камерой, носом по направлению взгляда.
  // worldOrigin — текущий floating-origin (в обзорном режиме = 0), чтобы из
  // локальной camera.position получить мировую позицию корабля.
  spawnFromCamera(camera, worldOrigin) {
    camera.getWorldDirection(this._tmp).normalize();
    if (this._tmp.lengthSq() < 1e-6) this._tmp.set(0, 0, -1);
    const ox = worldOrigin ? worldOrigin.x : 0;
    const oy = worldOrigin ? worldOrigin.y : 0;
    const oz = worldOrigin ? worldOrigin.z : 0;
    this.wpos.x = camera.position.x + ox + this._tmp.x * this.spawnOffset;
    this.wpos.y = camera.position.y + oy + this._tmp.y * this.spawnOffset;
    this.wpos.z = camera.position.z + oz + this._tmp.z * this.spawnOffset;
    this.pos.set(0, 0, 0);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this._tmp);
    this.vel.set(0, 0, 0);
    this.throttle = 0;            // старт с нуля (стоп)
    this.lookYaw = 0; this.lookPitch = 0;
    this.warp = null; this.orbit = null;
  }

  // шаг режима тяги (Shift/Ctrl): −2..3. Ручная тяга выводит из орбиты; на поверхности — взлёт.
  stepThrottle(d) {
    if (this.landed) { this._takeoff(); return; }
    this.throttle = THREE.MathUtils.clamp(this.throttle + d, -2, 3);
    this.orbit = null;
  }

  _requestLock() {
    // unadjustedMovement отключает ускорение мыши ОС — главный источник «диких» дельт
    try {
      const p = this.dom.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => { try { this.dom.requestPointerLock(); } catch (e) { /* нет лока — летим с клавиатуры */ } });
      }
    } catch (e) {
      this.dom.requestPointerLock?.();
    }
  }

  enable() {
    this.enabled = true;
    this.mouseDX = 0;
    this.mouseDY = 0;
    if (this.ship) {
      this.ship.visible = true;
      this.ship.position.copy(this.pos);
      this.ship.quaternion.copy(this.quat);
    }
    this.camera.position.copy(this._desiredCam(this._tmp));
    this.camera.quaternion.copy(this.quat);
    this._requestLock();
  }

  disable() {
    this.enabled = false;
    this.keys.clear();
    if (this.ship) this.ship.visible = false;
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();
  }

  getSpeed() {
    return this.vel.length();
  }

  // подстроить отступы чейз-камеры и спавна под истинную длину корабля (ед.),
  // сохраняя прежнее экранное кадрирование (те же кратности к длине корпуса).
  configureForShipLength(lenU) {
    this.shipLen = lenU;
    this.camBack = lenU * 5.3;
    this.camUp = lenU * 1.5;
    this.camLead = lenU * 4.2;
    this.spawnOffset = lenU * 7;
    this.landClearance = lenU * 1.5;   // корабль садится брюхом чуть над поверхностью
  }

  // X: посадка рядом с поверхностью на малой скорости / взлёт, если уже сели
  tryLandOrTakeoff() {
    if (this.landed) { this._takeoff(); return 'takeoff'; }
    if (this.groundRadius <= 0) return 'no-ground';
    const c = this.groundCenter;
    const r = Math.hypot(this.wpos.x - c.x, this.wpos.y - c.y, this.wpos.z - c.z);
    if (r - this.groundRadius > this.groundRadius * this.landAltFrac) return 'too-high';
    if (this.vel.length() > this.LAND_SPEED) return 'too-fast';
    this._land();
    return 'landed';
  }

  _land() {
    const c = this.groundCenter;
    this._oRel.set(this.wpos.x - c.x, this.wpos.y - c.y, this.wpos.z - c.z);
    const r = this._oRel.length() || 1;
    this.landNormal.copy(this._oRel).divideScalar(r);
    const surf = this.groundRadius + this.landClearance;
    this.wpos.x = c.x + this.landNormal.x * surf;
    this.wpos.y = c.y + this.landNormal.y * surf;
    this.wpos.z = c.z + this.landNormal.z * surf;
    this.vel.set(0, 0, 0);
    this.throttle = 0; this.warp = null; this.orbit = null;
    this.landed = this.groundBodyId;
    // ориентация: «верх» корабля (+Y) по нормали — брюхом к планете
    this._tmp.set(0, 1, 0).applyQuaternion(this.quat);
    this._dq.setFromUnitVectors(this._tmp, this.landNormal);
    this.quat.premultiply(this._dq).normalize();
  }

  _takeoff() {
    this.landed = null;
    // нос — по нормали (вверх), толчок от поверхности, тяга вперёд
    this._tmp.set(0, 0, -1).applyQuaternion(this.quat);
    this._dq.setFromUnitVectors(this._tmp, this.landNormal);
    this.quat.premultiply(this._dq).normalize();
    this.vel.copy(this.landNormal).multiplyScalar(60);
    this.throttle = 1;
  }

  _desiredCam(out) {
    out.set(0, this.camUp, this.camBack).applyQuaternion(this.quat).add(this.pos);
    return out;
  }

  // войти в круговую орбиту вокруг тела (center — wpos Vector3, mu — гравит. параметр)
  startOrbit(center, mu, bodyId) {
    this._oRel.set(this.wpos.x - center.x, this.wpos.y - center.y, this.wpos.z - center.z);
    const r = this._oRel.length();
    if (r < 1e-3) return false;
    // нормаль плоскости орбиты = r × v; при малой/коллинеарной скорости — перпендикуляр к r
    this._oN.crossVectors(this._oRel, this.vel);
    if (this._oN.lengthSq() < 1e-8) this._oN.set(0, 1, 0).cross(this._oRel);
    if (this._oN.lengthSq() < 1e-8) this._oN.set(1, 0, 0).cross(this._oRel);
    this._oN.normalize();
    this.orbit = { mu, r, w: Math.sqrt(mu / (r * r * r)), bodyId };
    this.orbitCenter.copy(center);
    return true;
  }

  // держим круговую орбиту вокруг orbitCenter (стабильно, без дрейф-демпинга);
  // центр (wpos тела) обновляет main.js каждый кадр — орбита следует за телом.
  _updateOrbit(dt) {
    const c = this.orbitCenter, o = this.orbit;
    this._oRel.set(this.wpos.x - c.x, this.wpos.y - c.y, this.wpos.z - c.z);
    this._oRel.addScaledVector(this._oN, -this._oRel.dot(this._oN)); // снять дрейф по нормали
    if (this._oRel.lengthSq() < 1e-9) return;
    this._oRel.setLength(o.r);                       // зафиксировать радиус → идеальный круг
    this._oRel.applyAxisAngle(this._oN, o.w * dt);   // продвинуть по орбите
    this.wpos.x = c.x + this._oRel.x;
    this.wpos.y = c.y + this._oRel.y;
    this.wpos.z = c.z + this._oRel.z;
    this._oTan.crossVectors(this._oN, this._oRel).setLength(o.w * o.r); // касат. скорость
    this.vel.copy(this._oTan);
    this.pos.set(0, 0, 0);
  }

  // варп-круиз: нос автонаводится на цель, скорость ∝ оставшейся дистанции (экспон.
  // подлёт без перелёта), у границы воронки — выход в сублайт. Центр (wpos цели)
  // обновляет main.js каждый кадр. Возвращает текущую скорость (для HUD/эффекта).
  _updateWarp(dt) {
    const c = this.warpCenter, wp = this.wpos, w = this.warp;
    this._oRel.set(c.x - wp.x, c.y - wp.y, c.z - wp.z); // к цели
    const dist = this._oRel.length();
    w.dist = dist;
    if (dist < 1e-6) { this.warp = null; return 0; }
    this._oRel.divideScalar(dist);                       // единичное направление
    const remaining = dist - w.arrivalDist;
    // прибытие у границы воронки — выходим в сублайт, дальше подхватит гравитация.
    // Нужен запас: скорость ∝ remaining асимптотит к границе и без него её не пересечь.
    if (remaining <= w.arrivalDist * 0.06) {
      const vmag = THREE.MathUtils.clamp(remaining * w.rate, 35, 120);
      this.vel.copy(this._oRel).multiplyScalar(vmag);
      this.warp = null;
      this.throttle = 0;            // прибыли — стоп (не влетаем в планету на тяге)
      return vmag;
    }
    // автонаведение носа на цель
    this._qLook.setFromUnitVectors(FWD, this._oRel);
    this.quat.slerp(this._qLook, 1 - Math.pow(0.0008, dt)).normalize();
    // движение: скорость ∝ оставшейся дистанции → плавное экспоненциальное торможение
    const speed = remaining * w.rate;
    const step = speed * dt;
    wp.x += this._oRel.x * step;
    wp.y += this._oRel.y * step;
    wp.z += this._oRel.z * step;
    this.vel.copy(this._oRel).multiplyScalar(speed);
    this.pos.set(0, 0, 0);
    return speed;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;

    // ── free-look: мышь крутит камеру вокруг корабля (это не руль) ──
    this.lookYaw -= this.mouseDX * this.lookSens;
    this.lookPitch -= this.mouseDY * this.lookSens;
    const hadMouse = this.mouseDX !== 0 || this.mouseDY !== 0;
    this.mouseDX = 0; this.mouseDY = 0;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -1.15, 1.15);
    this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -2.7, 2.7);
    if (!hadMouse) { const f = Math.pow(this.lookReturn, dt); this.lookYaw *= f; this.lookPitch *= f; }

    // ── руль (клавиши): тангаж W/S, рыскание A/D. Ручное вмешательство → выход из автопилота ──
    const steering = k.has('KeyW') || k.has('KeyS') || k.has('KeyA') || k.has('KeyD');
    if ((this.warp || this.orbit) && steering) { this.warp = null; this.orbit = null; }
    if (!this.warp && !this.orbit && steering) {
      let pitch = 0, yaw = 0;
      if (k.has('KeyS')) pitch += this.pitchRate * dt;   // на себя → нос вверх
      if (k.has('KeyW')) pitch -= this.pitchRate * dt;   // от себя → нос вниз
      if (k.has('KeyA')) yaw += this.yawRate * dt;       // влево
      if (k.has('KeyD')) yaw -= this.yawRate * dt;       // вправо
      this._euler.set(pitch, yaw, 0, 'XYZ');
      this._dq.setFromEuler(this._euler);
      this.quat.multiply(this._dq).normalize();
    }

    // ── движение ──
    this.warpSpeed = 0;
    if (this.landed) {
      // приклеены к поверхности — следуем за телом (его орбитой), без движения
      const c = this.groundCenter, surf = this.groundRadius + this.landClearance;
      this.wpos.x = c.x + this.landNormal.x * surf;
      this.wpos.y = c.y + this.landNormal.y * surf;
      this.wpos.z = c.z + this.landNormal.z * surf;
      this.vel.set(0, 0, 0);
    } else if (this.warp) {
      this.warpSpeed = this._updateWarp(dt);
    } else if (this.orbit) {
      this._updateOrbit(dt);
    } else {
      // throttle-круиз: движок выводит скорость на forward×target; инерции/дрейфа нет,
      // но гравитация колодца перетягивает (на throttle 0 у планеты медленно сваливаешься).
      this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
      let target = this.THROTTLE_SPEEDS[this.throttle + 2];
      // приповерхностный режим: у поверхности скорость авто-снижается (точный подлёт/посадка)
      this.altAGL = Infinity; this.speedScale = 1;
      if (this.groundRadius > 0) {
        const c = this.groundCenter;
        this.altAGL = Math.hypot(this.wpos.x - c.x, this.wpos.y - c.y, this.wpos.z - c.z) - this.groundRadius;
        this.speedScale = THREE.MathUtils.clamp(this.altAGL / (this.groundRadius * this.nearAltFrac), this.minSpeedScale, 1);
        target *= this.speedScale;
      }
      this._tmp.copy(this._fwd).multiplyScalar(target).sub(this.vel); // Δ к желаемой скорости
      const maxStep = this.engineAccel * dt;
      if (this._tmp.lengthSq() > maxStep * maxStep) this._tmp.setLength(maxStep);
      this.vel.add(this._tmp);
      if (this.gravityFn) {
        this.gravityFn(this.wpos, this._grav);
        this.vel.addScaledVector(this._grav, dt);
      }
      this.wpos.x += this.vel.x * dt;
      this.wpos.y += this.vel.y * dt;
      this.wpos.z += this.vel.z * dt;
      // ── коллизия с поверхностью: не проваливаемся сквозь сферу, скользим по ней ──
      if (this.groundRadius > 0) {
        const c = this.groundCenter;
        let dx = this.wpos.x - c.x, dy = this.wpos.y - c.y, dz = this.wpos.z - c.z;
        const r = Math.hypot(dx, dy, dz) || 1;
        const surf = this.groundRadius + this.landClearance;
        if (r < surf) {
          dx /= r; dy /= r; dz /= r;                                  // нормаль «вверх»
          this.wpos.x = c.x + dx * surf; this.wpos.y = c.y + dy * surf; this.wpos.z = c.z + dz * surf;
          const vr = this.vel.x * dx + this.vel.y * dy + this.vel.z * dz; // радиальная (<0 — вниз)
          if (vr < 0) { this.vel.x -= dx * vr; this.vel.y -= dy * vr; this.vel.z -= dz * vr; }
        }
      }
    }
    this.pos.set(0, 0, 0);

    // ── корабль: свечение сопел растёт с режимом тяги ──
    if (this.ship) {
      this.ship.position.copy(this.pos);
      this.ship.quaternion.copy(this.quat);
      const glows = this.ship.userData.glows || [];
      const intensity = this.warp ? 1.4 : (0.3 + 0.4 * Math.max(0, this.throttle)); // 0..1.5
      for (const gl of glows) {
        gl.material.opacity = 0.22 + 0.5 * Math.min(1.4, intensity);
        gl.scale.setScalar((gl.position.x === 0 ? 0.95 : 0.7) * (0.7 + 0.55 * Math.min(1.4, intensity)));
      }
    }

    // ── камера: ЖЁСТКАЯ привязка к кораблю + free-look орбита (без лагов → не отрывается) ──
    this._fwd.set(0, 0, -1).applyQuaternion(this.quat);   // нос (мир)
    this._tmp.set(0, this.camUp, this.camBack);           // базовый отступ за кормой
    this._euler.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
    this._dq.setFromEuler(this._euler);
    this._tmp.applyQuaternion(this._dq);                  // повернуть отступ обзором
    this._tmp.applyQuaternion(this.quat);                 // в ориентацию корабля
    this.camera.position.copy(this.pos).add(this._tmp);   // pos = 0
    this._lookAt.copy(this.pos).addScaledVector(this._fwd, this.camLead);
    this._up.set(0, 1, 0).applyQuaternion(this.quat);
    this.camera.up.copy(this._up);
    this.camera.lookAt(this._lookAt);

    // FOV-рывок на высокой тяге / варпе
    const targetFov = this.warp ? this.fovBase + 20
      : this.fovBase + (this.throttle >= 2 ? (this.throttle === 3 ? 16 : 8) : 0);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.pow(0.02, dt));
    this.camera.updateProjectionMatrix();
  }
}

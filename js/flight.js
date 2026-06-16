// ============================================================
//  Перигелий — полётная модель корабля (аркадный 6DOF)
//  Кватернионное управление + чейз-камера + буст.
//  Корабль = отдельная сущность; камера тянется следом.
// ============================================================
import * as THREE from 'three';
import { spriteGlow } from './textures.js';

// ───────────────────────── модель корабля ─────────────────────────
// Нос направлен в −Z (вперёд), двигатели — сзади (+Z).
export function buildPlayerShip() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({
    color: 0xd2dae8, metalness: 0.6, roughness: 0.38, emissive: 0x0e1730, emissiveIntensity: 0.4,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x2c4a8c, metalness: 0.5, roughness: 0.3, emissive: 0x16306b, emissiveIntensity: 0.65,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x3a4150, metalness: 0.7, roughness: 0.45, emissive: 0x0a0a14, emissiveIntensity: 0.2,
  });

  // фюзеляж (конус носом в −Z)
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.3, 18), hull);
  body.rotation.x = -Math.PI / 2;
  g.add(body);

  // «фонарь» кабины
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), accent);
  canopy.position.set(0, 0.16, -0.35);
  canopy.scale.set(1, 0.7, 1.5);
  g.add(canopy);

  // крылья
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.7), accent);
    wing.position.set(s * 0.95, -0.02, 0.45);
    wing.rotation.z = s * 0.12;
    wing.rotation.y = s * -0.22;
    g.add(wing);
    // законцовка-двигатель
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.7, 12), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.55, -0.02, 0.55);
    g.add(pod);
  }

  // центральный двигатель
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.6, 14), dark);
  eng.rotation.x = Math.PI / 2;
  eng.position.set(0, 0, 1.05);
  g.add(eng);

  // свечение сопел (растёт с тягой)
  const glowTex = new THREE.CanvasTexture(spriteGlow('rgba(150,205,255,0.95)', 'rgba(60,120,240,0.18)', 128));
  const glows = [];
  for (const x of [-1.55, 0, 1.55]) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6,
    }));
    sp.position.set(x, x === 0 ? 0 : -0.02, x === 0 ? 1.45 : 0.95);
    sp.scale.setScalar(x === 0 ? 0.95 : 0.7);
    g.add(sp);
    glows.push(sp);
  }

  g.scale.setScalar(0.62);
  g.userData.glows = glows;
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

    // настройки (можно крутить вживую через window.__app.shipCtl)
    this.accel = 58;          // ед/с² тяги вперёд
    this.maxSpeed = 46;       // крейсерский предел
    this.boostMult = 2.9;     // множитель буста к скорости/тяге
    this.driftDamping = 0.92; // дрейф: доля скорости, сохраняемая за секунду без тяги (космос — почти инерция)
    this.brakeDamping = 0.03; // тормоз (Space): быстрый сброс скорости до нуля
    this.braking = false;
    this.rollRate = 2.1;      // рад/с крена (A/D)
    this.mouseSens = 0.0016;  // чувствительность мыши
    this.maxTurn = 0.05;      // макс. поворот за кадр (рад) — гасит рывки/глитчи дельт мыши
    this.fovBase = opts.fovBase || camera.fov;
    this.fovBoost = this.fovBase + 13;
    this.camBack = 7.6;       // отступ камеры назад
    this.camUp = 2.1;         // отступ камеры вверх
    this.camLead = 6;         // насколько вперёд смотрит камера (кадрирование)
    this.camLag = 0.0009;     // плавность позиции (меньше = плавнее)
    this.camRotLag = 0.0006;  // плавность поворота

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
    this.wpos.x = camera.position.x + ox + this._tmp.x * 10;
    this.wpos.y = camera.position.y + oy + this._tmp.y * 10;
    this.wpos.z = camera.position.z + oz + this._tmp.z * 10;
    this.pos.set(0, 0, 0);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this._tmp);
    this.vel.set(0, 0, 0);
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

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;

    // ── поворот: тангаж/рыскание от мыши, крен от A/D ──
    // поворот за кадр ограничен maxTurn — один глитч-скачок дельты больше не крутит корабль
    const cap = this.maxTurn;
    const yaw = THREE.MathUtils.clamp(-this.mouseDX * this.mouseSens, -cap, cap);
    const pitch = THREE.MathUtils.clamp(-this.mouseDY * this.mouseSens, -cap, cap);
    this.mouseDX = 0;
    this.mouseDY = 0;
    let roll = 0;
    if (k.has('KeyA')) roll += this.rollRate * dt;
    if (k.has('KeyD')) roll -= this.rollRate * dt;
    // Q/E — рыскание с клавиатуры (для тех, кто без мыши)
    let kbYaw = 0;
    if (k.has('KeyQ')) kbYaw += this.rollRate * 0.6 * dt;
    if (k.has('KeyE')) kbYaw -= this.rollRate * 0.6 * dt;
    this._euler.set(pitch, yaw + kbYaw, roll);
    this._dq.setFromEuler(this._euler);
    this.quat.multiply(this._dq).normalize();

    // тяга W/S разрывает орбитальный захват → сразу обычный полёт
    if (this.orbit && (k.has('KeyW') || k.has('KeyS'))) this.orbit = null;

    let thrustOn = false;
    if (this.orbit) {
      // ── орбитальный захват: круговая орбита вокруг тела, руки свободны ──
      this.boosting = false;
      this._updateOrbit(dt);
    } else {
      // ── тяга ──
      this.boosting = k.has('ShiftLeft') || k.has('ShiftRight');
      const accel = this.accel * (this.boosting ? this.boostMult : 1);
      this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
      thrustOn = k.has('KeyW');
      if (thrustOn) this.vel.addScaledVector(this._fwd, accel * dt);
      if (k.has('KeyS')) this.vel.addScaledVector(this._fwd, -accel * 0.55 * dt);

      // инерция: по умолчанию корабль дрейфует (космос), Space — активное торможение
      this.braking = k.has('Space');
      this.vel.multiplyScalar(Math.pow(this.braking ? this.brakeDamping : this.driftDamping, dt));
      // предел скорости ограничивает только разгон тягой/бустом; набранный дрейф не срезаем
      if (thrustOn || k.has('KeyS')) {
        const max = this.maxSpeed * (this.boosting ? this.boostMult : 1);
        if (this.vel.lengthSq() > max * max) this.vel.setLength(max);
      }

      // ── гравитация колодцев (SOI): ускорение к доминирующему телу (из main.js) ──
      // применяется после тяги/тормоза/клэмпа, до интегрирования — это «настоящая» сила:
      // её не режет предел скорости.
      if (this.gravityFn) {
        this.gravityFn(this.wpos, this._grav);
        this.vel.addScaledVector(this._grav, dt);
      }

      // интегрируем скорость в МИРОВУЮ позицию (Float64); локальная остаётся 0 —
      // floating-origin: корабль стоит в центре, мир движется вокруг (main.js applyOrigin)
      this.wpos.x += this.vel.x * dt;
      this.wpos.y += this.vel.y * dt;
      this.wpos.z += this.vel.z * dt;
    }
    this.pos.set(0, 0, 0);

    // ── обновляем корабль ──
    if (this.ship) {
      this.ship.position.copy(this.pos);
      this.ship.quaternion.copy(this.quat);
      const glows = this.ship.userData.glows || [];
      const intensity = (thrustOn ? 1 : 0.3) * (this.boosting ? 1.7 : 1);
      for (const gl of glows) {
        gl.material.opacity = 0.25 + 0.6 * intensity;
        gl.scale.setScalar((gl.position.x === 0 ? 0.95 : 0.7) * (0.7 + 0.7 * intensity));
      }
    }

    // ── чейз-камера ──
    this._desiredCam(this._tmp);
    this.camera.position.lerp(this._tmp, 1 - Math.pow(this.camLag, dt));
    // смотрим на точку впереди корабля; «верх» = верх корабля (крен передаётся)
    this._lookAt.copy(this.pos).addScaledVector(this._fwd, this.camLead);
    this._up.set(0, 1, 0).applyQuaternion(this.quat);
    this._m.lookAt(this.camera.position, this._lookAt, this._up);
    this._qLook.setFromRotationMatrix(this._m);
    this.camera.quaternion.slerp(this._qLook, 1 - Math.pow(this.camRotLag, dt));

    // FOV-рывок на бусте
    const targetFov = this.boosting && thrustOn ? this.fovBoost : this.fovBase;
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.pow(0.015, dt));
    this.camera.updateProjectionMatrix();
  }
}

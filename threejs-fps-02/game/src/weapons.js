// Weapons: four guns and two grenades. Each definition owns its numbers —
// damage, fire rate, magazine, spread, recoil and price — and the module owns
// the view model, the reload, the muzzle flash and the aim-down-sights state.
// main.js owns the ray; combat.js owns what a bullet does when it lands.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, mag: 12, reserve: 48, gap: 0.16, reload: 1.4, auto: false, spreadStill: 0.004, spreadMove: 0.03, kick: 0.011, zoom: 1 },
  rifle: { id: 'rifle', name: 'VK-47 Longshot', price: 2700, damage: 33, mag: 30, reserve: 90, gap: 0.1, reload: 2.0, auto: true, spreadStill: 0.0022, spreadMove: 0.028, kick: 0.014, zoom: 1.25 },
  smg: { id: 'smg', name: 'Kestrel SMG', price: 1500, damage: 22, mag: 25, reserve: 100, gap: 0.068, reload: 1.7, auto: true, spreadStill: 0.006, spreadMove: 0.02, kick: 0.009, zoom: 1.15 },
  dmr: { id: 'dmr', name: 'Hawkeye DMR', price: 3100, damage: 78, mag: 10, reserve: 30, gap: 0.5, reload: 2.6, auto: false, spreadStill: 0.0008, spreadMove: 0.045, kick: 0.03, zoom: 2.4 },
};
export const WEAPON_ORDER = ['pistol', 'rifle', 'smg', 'dmr'];
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, damage: 95, radius: 5.5 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, radius: 4.5, duration: 18 },
};

const GRIP = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steelDark), roughness: 0.7, metalness: 0.25 });
const BODY = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
const WOOD = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.75, metalness: 0.05 });
const SCOPE = new THREE.MeshStandardMaterial({ color: new THREE.Color('#20242a'), roughness: 0.35, metalness: 0.6 });

function box(w, h, d, x, y, z, mat) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  return mesh;
}

// One view model per weapon, built from boxes so each gun reads differently.
function buildModel(id) {
  const model = new THREE.Group();
  if (id === 'pistol') {
    model.add(box(0.05, 0.06, 0.22, 0, 0, -0.1, BODY));
    model.add(box(0.045, 0.12, 0.06, 0, -0.07, 0.04, GRIP));
  } else if (id === 'rifle') {
    model.add(box(0.09, 0.1, 0.44, 0, 0, 0, BODY));
    model.add(box(0.045, 0.045, 0.42, 0, 0.025, -0.4, GRIP));
    model.add(box(0.07, 0.16, 0.08, 0, -0.11, -0.05, WOOD));
    model.add(box(0.075, 0.08, 0.22, 0, -0.02, 0.3, WOOD));
  } else if (id === 'smg') {
    model.add(box(0.08, 0.09, 0.3, 0, 0, 0, BODY));
    model.add(box(0.04, 0.04, 0.24, 0, 0.02, -0.26, GRIP));
    model.add(box(0.06, 0.14, 0.07, 0, -0.1, 0, GRIP));
    model.add(box(0.05, 0.05, 0.12, 0, 0, 0.2, WOOD));
  } else {
    model.add(box(0.08, 0.09, 0.62, 0, 0, -0.1, BODY));
    model.add(box(0.04, 0.04, 0.3, 0, 0.02, -0.52, GRIP));
    model.add(box(0.07, 0.15, 0.08, 0, -0.1, 0.05, WOOD));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), SCOPE);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.075, -0.05);
    model.add(scope);
  }
  return model;
}

export function createWeapons(camera) {
  const models = {};
  for (const id of WEAPON_ORDER) {
    const model = buildModel(id);
    // High enough that the grip stays inside the frame (at this depth the
    // bottom of the screen is about y=-0.18), far enough to read as a gun.
    model.position.set(0.24, -0.15, -0.45);
    model.visible = false;
    camera.add(model);
    models[id] = model;
  }
  // A small light that rides with the camera and keeps the view model readable
  // at dusk. Its reach is short (1.2 m), so it barely touches the world.
  const viewLight = new THREE.PointLight(new THREE.Color('#ffe6c4'), 0.5, 1.2);
  viewLight.position.set(0.2, -0.1, -0.3);
  camera.add(viewLight);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.gold), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.gold), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const id of WEAPON_ORDER) ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  const owned = { pistol: true };
  const grenades = { frag: 0, smoke: 0 };
  const state = {
    current: 'pistol', cooldown: 0, reloadLeft: 0, flash: 0, kick: 0,
    aiming: false, throwCooldown: 0, bobPhase: 0,
  };

  function def() {
    return WEAPONS[state.current];
  }
  function currentAmmo() {
    return ammo[state.current];
  }
  function showModel() {
    for (const id of WEAPON_ORDER) models[id].visible = id === state.current;
  }
  showModel();

  function step(dt, moveSpeed) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.current];
    const targetZ = -0.45 + state.kick + (state.aiming ? 0.12 : 0);
    const targetX = 0.24 - (state.aiming ? 0.24 : 0);
    const targetY = -0.15 + (state.aiming ? 0.005 : 0);
    model.position.z += (targetZ - model.position.z) * Math.min(1, dt * 18);
    model.position.x += (targetX - model.position.x) * Math.min(1, dt * 18);
    model.position.y += (targetY - model.position.y) * Math.min(1, dt * 18);
    model.rotation.x = state.kick * 2.2;
    if (moveSpeed > 0.5) {
      state.bobPhase += dt * moveSpeed * 1.6;
      model.position.y += Math.sin(state.bobPhase * 2) * 0.004;
      model.position.x += Math.cos(state.bobPhase) * 0.003;
    }
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 20 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.5 * Math.sin((Math.PI * (def().reload - state.reloadLeft)) / def().reload);
      if (state.reloadLeft === 0) {
        const a = currentAmmo();
        const need = def().mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
  }

  return {
    state,
    def,
    ammo: currentAmmo,
    owned,
    grenades,
    step,
    ready() {
      return currentAmmo().mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const a = currentAmmo();
      if (a.mag <= 0) return false;
      a.mag -= 1;
      return true;
    },
    reload() {
      const a = currentAmmo();
      if (state.reloadLeft > 0 || a.mag === def().mag || a.reserve === 0) return;
      state.reloadLeft = def().reload;
    },
    spread(speed) {
      const d = def();
      const base = d.spreadStill + Math.min(1, speed / 5.4) * d.spreadMove;
      return state.aiming ? base * 0.35 : base;
    },
    moveMultiplier() {
      return state.aiming ? 0.55 : 1;
    },
    setAiming(on) {
      state.aiming = on;
    },
    switchTo(id) {
      if (!owned[id] || id === state.current) return false;
      state.current = id;
      state.reloadLeft = 0;
      state.aiming = false;
      showModel();
      return true;
    },
    buy(id) {
      if (owned[id]) return false;
      owned[id] = true;
      ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      return true;
    },
    refillAmmo() {
      for (const id of WEAPON_ORDER) {
        if (!owned[id]) continue;
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
    },
    useGrenade(type) {
      if (grenades[type] <= 0 || state.throwCooldown > 0) return false;
      grenades[type] -= 1;
      state.throwCooldown = 0.7;
      return true;
    },
    reset() {
      for (const id of WEAPON_ORDER) {
        if (id !== 'pistol') delete owned[id];
        ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
      }
      grenades.frag = 0;
      grenades.smoke = 0;
      state.current = 'pistol';
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.aiming = false;
      showModel();
    },
  };
}

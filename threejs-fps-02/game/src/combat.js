// Combat: the hitscan ray, damage with falloff and armour, and grenades.
// One raycaster is reused; the caller passes origin, direction and spread.
// Grenades are small simulated projectiles: a frag bursts after its fuse, a
// smoke pops into a line-of-sight-blocking cloud. main.js wires the results
// (killfeed, HUD, round state) through the callbacks given at creation.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { boxOverlaps } from './collision.js';

const PART_MULT = { head: 2.5, torso: 1, limb: 0.75 };
const GRAVITY = 12;

export function createCombat(scene, world, effects, audio, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const nextPos = new THREE.Vector3();
  const endPos = new THREE.Vector3();
  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c2a26'), roughness: 0.6, metalness: 0.4 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a8a7a'), roughness: 0.6, metalness: 0.2 });

  function falloff(dist) {
    if (dist < 10) return 1;
    if (dist > 45) return 0.55;
    return 1 - ((dist - 10) / 35) * 0.45;
  }

  function applyArmour(entity, dmg) {
    let left = dmg;
    if (entity.armor > 0) {
      const absorbed = Math.min(entity.armor, dmg * 0.5);
      entity.armor -= absorbed;
      left -= absorbed;
    }
    return left;
  }

  // origin: Vector3, direction: unit Vector3, spread: radians of random cone.
  // targets: the meshes a bullet can hit (world + bot hit meshes). Returns the
  // hit (or null) and always draws the tracer and makes the noise.
  function fireHitscan(from, direction, spread, damage, shooterTeam, opts = {}) {
    dir.copy(direction);
    if (spread > 0) {
      dir.x += (Math.random() * 2 - 1) * spread;
      dir.y += (Math.random() * 2 - 1) * spread;
      dir.z += (Math.random() * 2 - 1) * spread;
      dir.normalize();
    }
    origin.copy(from);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(opts.targets, false);
    const hit = hits.length ? hits[0] : null;
    const end = endPos;
    if (hit) end.copy(hit.point);
    else end.copy(from).addScaledVector(dir, 80);
    effects.fireTracer(from, end, shooterTeam === 'jackal');
    const noiseRadius = opts.noiseRadius ?? 30;
    if (opts.noise !== false) hooks.onNoise(from.x, from.z, noiseRadius);
    if (!hit) return null;
    const obj = hit.object;
    const dist = hit.distance;
    if (obj.userData.bot) {
      const bot = obj.userData.bot;
      const part = obj.userData.part ?? 'torso';
      const dmg = applyArmour(bot, damage * (PART_MULT[part] ?? 1) * falloff(dist));
      effects.burst(hit.point.x, hit.point.y, hit.point.z, PALETTE.red, 8, 3, 1, 0.5);
      const killed = hooks.onBotDamaged(bot, dmg, part, opts.attackerName);
      return { hit, bot, part, killed, point: hit.point };
    }
    if (obj.userData.isPlayer) {
      const dmg = applyArmour(hooks.player, damage * falloff(dist));
      hooks.onPlayerDamaged(dmg, from);
      return { hit, player: true, point: hit.point };
    }
    effects.burst(hit.point.x, hit.point.y, hit.point.z, '#c9b18a', 6, 2.5, 1, 0.45);
    return { hit, point: hit.point };
  }

  function throwGrenade(from, direction, type) {
    const mesh = new THREE.Mesh(grenadeGeo, type === 'smoke' ? smokeMat : grenadeMat);
    mesh.position.copy(from);
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({
      mesh, type, fuse: type === 'frag' ? 1.6 : 1.1, popped: false,
      vel: new THREE.Vector3(direction.x * 13 + (Math.random() - 0.5), direction.y * 13 + 4.5, direction.z * 13 + (Math.random() - 0.5)),
    });
    audio.shot('smg', 0);
  }

  function explodeFrag(pos, radius, baseDamage, attackerName) {
    effects.explosion(pos.x, pos.y, pos.z);
    audio.explosion();
    hooks.onExplosion(pos);
    const victims = hooks.entities();
    for (const v of victims) {
      if (!v.alive) continue;
      const d = Math.hypot(v.pos.x - pos.x, v.pos.y - (pos.y + 1.1), v.pos.z - pos.z);
      if (d > radius) continue;
      const dmg = applyArmour(v, baseDamage * (1 - (d / radius) * 0.7));
      if (v.isPlayer) {
        hooks.onPlayerDamaged(dmg, pos);
      } else {
        hooks.onBotDamaged(v, dmg, 'torso', attackerName);
      }
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const next = nextPos.copy(g.mesh.position).addScaledVector(g.vel, dt);
      // Bounce: if the next step is inside a collider, dampen and slide.
      const blocked = boxOverlaps(next.x, next.y - 0.09, next.z, 0.09, 0.18, 0.09, 0, world.colliders);
      if (blocked) {
        g.vel.multiplyScalar(0.45);
        g.vel.y = Math.abs(g.vel.y) * 0.4 + 1;
      } else {
        g.mesh.position.copy(next);
      }
      if (g.mesh.position.y < 0.09) {
        g.mesh.position.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.35;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0 && !g.popped) {
        g.popped = true;
        if (g.type === 'frag') {
          explodeFrag(g.mesh.position, 5.5, 95, 'You');
        } else {
          effects.spawnSmoke(g.mesh.position.x, 1.2, g.mesh.position.z, 4.5, 18);
          effects.burst(g.mesh.position.x, 1.2, g.mesh.position.z, '#9aa0a3', 20, 3, 1.5, 1);
        }
        scene.remove(g.mesh);
        grenades.splice(i, 1);
      }
    }
  }

  return {
    fireHitscan,
    throwGrenade,
    step(dt) {
      stepGrenades(dt);
    },
    clearGrenades() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
    },
  };
}

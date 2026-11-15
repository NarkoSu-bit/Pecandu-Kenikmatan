// Bots: the other nine soldiers. Each bot is a small state machine — advance
// along waypoint routes, hold a position, engage what it sees, investigate
// what it hears, plant the bomb or defuse it — with reaction time, burst fire
// and aim error that depend on its skill, so a bot is a fair fight, not an
// aimbot. Paths come from a breadth-first search over the map's waypoint
// graph, so bots genuinely route through the map instead of beelining.
// main.js owns shooting: when a bot decides to fire it calls ctx.fire.
import * as THREE from 'three';
import { WAYPOINTS, WAYPOINT_EDGES } from './world.js';
import { boxOverlaps, hasLineOfSight } from './collision.js';
import { PALETTE, TEAM_COLORS } from './palette.js';

const NAMES = {
  vanguard: ['Falcon', 'Mira', 'Dune', 'Sable', 'Rook'],
  jackal: ['Viper', 'Hyena', 'Scorp', 'Fennec', 'Dingo'],
};
const BOT_SPEED = 3.6;
const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const EYE = 1.45;
const CHEST = 1.1;

// Adjacency once, shared by every bot's path search.
const ADJ = WAYPOINTS.map(() => []);
for (const [a, b] of WAYPOINT_EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Breadth-first path of node ids from `from` to `to`, or null.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const next of ADJ[cur]) {
      if (prev[next] !== -1) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let node = to;
        while (node !== from) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

function buildMesh(team) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLORS[team]), roughness: 0.65, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#23211d'), roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), bodyMat);
  torso.position.y = 1.0;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skinMat);
  head.position.y = 1.53;
  head.userData.part = 'head';
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.32), bodyMat);
  band.position.y = 1.6;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.22), darkMat);
  legL.position.set(-0.13, 0.28, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.2, 1.15, -0.28);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color('#37d67a') }));
  bar.position.set(0, 1.82, 0);
  const barBg = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color('#40160f') }));
  barBg.position.set(0, 1.82, -0.01);
  group.add(torso, head, band, legL, legR, gun, barBg, bar);
  group.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  return { group, torso, head, bar };
}

export function createBots(scene, colliders, effects) {
  const bots = [];
  const hitMeshes = [];

  function spawn(team, index, x, z, yaw, weaponId, skill, isCarrier) {
    const { group, torso, head, bar } = buildMesh(team);
    group.position.set(x, 0, z);
    scene.add(group);
    const bot = {
      id: `${team}-${index}`,
      name: NAMES[team][index % NAMES[team].length],
      team,
      pos: new THREE.Vector3(x, 0, z),
      yaw,
      aimPitch: 0,
      health: 100,
      armor: 0,
      alive: true,
      weaponId,
      skill,
      state: 'advance',
      route: [],
      routeIdx: 0,
      holdTimer: 0,
      scanPhase: Math.random() * 6,
      target: null,
      aimErr: 0.1,
      trackTime: 0,
      reactTimer: 0,
      burstLeft: 0,
      burstTimer: 0,
      fireCooldown: 0,
      strafeDir: 0,
      strafeTimer: 0,
      investigatePos: new THREE.Vector3(),
      investigateTimer: 0,
      plantProgress: 0,
      defuseProgress: 0,
      hasBomb: !!isCarrier,
      assignedSite: null,
      lastDamageFrom: null,
      lastDamageAt: -10,
      fall: 0,
      group,
      torso,
      head,
      bar,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  // Final damage (part multiplier, falloff and armour already applied by the
  // caller in combat.js): subtract, update the health bar, fall on death.
  function applyDamage(bot, dmg) {
    if (!bot.alive) return false;
    bot.health -= dmg;
    bot.bar.scale.x = Math.max(0.001, bot.health / 100);
    bot.bar.material.color.set(bot.health > 50 ? '#37d67a' : bot.health > 25 ? '#f0b830' : '#d43d2a');
    if (bot.health <= 0) {
      bot.alive = false;
      bot.fall = 0;
      bot.health = 0;
      return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    const nx = bot.pos.x + vx * dt;
    if (!boxOverlaps(nx, 0, bot.pos.z, BOT_RADIUS, BOT_HEIGHT, BOT_RADIUS, 0.04, colliders)) bot.pos.x = nx;
    const nz = bot.pos.z + vz * dt;
    if (!boxOverlaps(bot.pos.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, BOT_RADIUS, 0.04, colliders)) bot.pos.z = nz;
    bot.yaw = Math.atan2(-dx, -dz);
    return len < 0.6;
  }

  function setRoute(bot, destNode) {
    const from = nearestNode(bot.pos.x, bot.pos.z);
    const path = findPath(from, destNode);
    bot.route = path ?? [destNode];
    bot.routeIdx = 0;
    bot.state = 'advance';
  }

  function visibleEnemy(bot, ctx, out) {
    let best = null;
    let bestD = Infinity;
    const eyeY = bot.pos.y + EYE;
    for (const e of ctx.enemies) {
      if (!e.alive || e.team === bot.team) continue;
      const ex = e.pos.x;
      const ez = e.pos.z;
      const ey = e.pos.y + (e.isPlayer ? 1.1 : CHEST);
      const dx = ex - bot.pos.x;
      const dz = ez - bot.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 48) continue;
      // Field of view, unless the enemy is very close or just shot this bot.
      const fwdX = -Math.sin(bot.yaw);
      const fwdZ = -Math.cos(bot.yaw);
      const dot = (dx * fwdX + dz * fwdZ) / (dist || 1);
      const heard = e === bot.lastDamageFrom && ctx.time - bot.lastDamageAt < 2;
      if (dot < 0.35 && dist > 5 && !heard) continue;
      if (effects.segmentInSmoke(bot.pos.x, eyeY, bot.pos.z, ex, ey, ez)) continue;
      if (!hasLineOfSight(bot.pos.x, eyeY, bot.pos.z, ex, ey, ez, colliders)) continue;
      if (dist < bestD) {
        bestD = dist;
        best = e;
      }
    }
    out.target = best;
    out.dist = bestD;
    return best;
  }

  const vis = { target: null, dist: Infinity };

  function step(dt, ctx) {
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      bot.reactTimer = Math.max(0, bot.reactTimer - dt);
      bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
      bot.burstTimer = Math.max(0, bot.burstTimer - dt);
      bot.strafeTimer = Math.max(0, bot.strafeTimer - dt);

      // --- perception
      visibleEnemy(bot, ctx, vis);
      const target = vis.target;
      if (target && target !== bot.target) {
        bot.reactTimer = 0.38 + Math.random() * 0.35 - bot.skill * 0.18;
        bot.trackTime = 0;
        bot.burstLeft = 0;
      }
      bot.target = target;

      // --- bomb duties override wandering when the bomb is planted
      if (ctx.bomb.state === 'planted' && bot.team === 'jackal' && bot.state !== 'engage') {
        if (bot.state !== 'defuse') {
          setRoute(bot, ctx.bomb.siteNode);
          bot.state = 'defuse';
          bot.defuseProgress = 0;
        }
      } else if (ctx.bomb.state === 'dropped' && bot.team === 'vanguard' && !bot.hasBomb && bot.state !== 'engage') {
        if (bot.state !== 'fetch') {
          setRoute(bot, nearestNode(ctx.bomb.pos.x, ctx.bomb.pos.z));
          bot.state = 'fetch';
        }
      }

      if (target) {
        // --- engage: track, strafe, fire in bursts
        bot.state = 'engage';
        bot.trackTime += dt;
        const dx = target.pos.x - bot.pos.x;
        const dz = target.pos.z - bot.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        const targetSpeed = target.isPlayer ? ctx.playerSpeed : 3.2;
        const wantYaw = Math.atan2(-dx, -dz);
        let dyaw = wantYaw - bot.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        bot.yaw += dyaw * Math.min(1, dt * (4 + bot.skill * 4));
        const aimY = target.pos.y + (target.isPlayer ? 1.25 : CHEST);
        bot.aimPitch = Math.atan2(aimY - (bot.pos.y + EYE), dist);
        // Aim error shrinks as the bot tracks, grows with distance and target speed.
        const errBase = 0.045 + dist * 0.0016 + targetSpeed * 0.008 - bot.skill * 0.028;
        bot.aimErr += (Math.max(0.012, errBase) - bot.aimErr) * Math.min(1, dt * 3);
        // Strafe sideways, changing direction now and then.
        if (bot.strafeTimer <= 0) {
          bot.strafeDir = Math.random() < 0.6 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          bot.strafeTimer = 0.7 + Math.random() * 0.9;
        }
        if (bot.strafeDir !== 0) {
          const sx = Math.cos(bot.yaw) * bot.strafeDir;
          const sz = -Math.sin(bot.yaw) * bot.strafeDir;
          const nx = bot.pos.x + sx * 1.9 * dt;
          const nz = bot.pos.z + sz * 1.9 * dt;
          if (!boxOverlaps(nx, 0, bot.pos.z, BOT_RADIUS, BOT_HEIGHT, BOT_RADIUS, 0.04, colliders)) bot.pos.x = nx;
          if (!boxOverlaps(bot.pos.x, 0, nz, BOT_RADIUS, BOT_HEIGHT, BOT_RADIUS, 0.04, colliders)) bot.pos.z = nz;
        }
        // Fire in bursts once the bot has reacted and is roughly on target.
        if (bot.burstTimer <= 0 && bot.burstLeft <= 0) bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        if (bot.reactTimer <= 0 && bot.burstLeft > 0 && bot.fireCooldown <= 0 && bot.aimErr < 0.1) {
          ctx.fire(bot, target);
          bot.burstLeft -= 1;
          bot.fireCooldown = (bot.weaponId === 'smg' ? 0.09 : bot.weaponId === 'dmr' ? 0.7 : 0.13) * (0.9 + Math.random() * 0.4);
          if (bot.burstLeft <= 0) bot.burstTimer = 0.5 + Math.random() * 0.7;
        }
      } else if (bot.state === 'defuse') {
        const site = ctx.bomb;
        const arrived = moveToward(bot, site.pos.x, site.pos.z, dt, BOT_SPEED);
        if (arrived || Math.hypot(site.pos.x - bot.pos.x, site.pos.z - bot.pos.z) < 1.6) {
          bot.defuseProgress += dt;
          if (bot.defuseProgress >= 5) ctx.onDefused(bot);
        }
      } else if (bot.state === 'fetch') {
        const arrived = moveToward(bot, ctx.bomb.pos.x, ctx.bomb.pos.z, dt, BOT_SPEED);
        if (arrived || Math.hypot(ctx.bomb.pos.x - bot.pos.x, ctx.bomb.pos.z - bot.pos.z) < 1.2) {
          ctx.onBombPickup(bot);
          bot.hasBomb = true;
          bot.state = 'advance';
          if (bot.assignedSite != null) setRoute(bot, bot.assignedSite);
        }
      } else if (bot.state === 'plant') {
        // Walk to the assigned site's waypoint, then channel the plant.
        const [sx, sz] = WAYPOINTS[bot.assignedSite ?? 6];
        const arrived = moveToward(bot, sx, sz, dt, BOT_SPEED);
        if (arrived || Math.hypot(sx - bot.pos.x, sz - bot.pos.z) < 1.2) {
          bot.plantProgress += dt;
          if (bot.plantProgress >= 3) ctx.onPlanted(bot);
        }
      } else if (bot.state === 'advance') {
        if (bot.route.length > 0) {
          // Follow the route; the carrier's route ends at its site, where it plants.
          const [nx, nz] = WAYPOINTS[bot.route[bot.routeIdx]];
          const arrived = moveToward(bot, nx, nz, dt, BOT_SPEED);
          if (arrived) {
            bot.routeIdx += 1;
            if (bot.routeIdx >= bot.route.length) {
              if (bot.hasBomb && bot.assignedSite != null) {
                bot.state = 'plant';
                bot.plantProgress = 0;
              } else {
                bot.state = 'hold';
                bot.holdTimer = 4 + Math.random() * 5;
              }
            }
          }
        } else {
          bot.state = 'hold';
          bot.holdTimer = 3 + Math.random() * 4;
        }
        // Hearing: a fresh noise nearby pulls the bot to investigate.
        for (const n of ctx.noises) {
          if (ctx.time - n.time > 1.2) continue;
          const d = Math.hypot(n.x - bot.pos.x, n.z - bot.pos.z);
          if (d < n.radius) {
            bot.investigatePos.set(n.x, 0, n.z);
            bot.investigateTimer = 2.5;
            bot.state = 'investigate';
            break;
          }
        }
      } else if (bot.state === 'investigate') {
        const arrived = moveToward(bot, bot.investigatePos.x, bot.investigatePos.z, dt, BOT_SPEED);
        if (arrived) {
          bot.investigateTimer -= dt;
          bot.yaw += dt * 1.2;
          if (bot.investigateTimer <= 0) {
            bot.state = 'advance';
            if (bot.route.length > 0) bot.routeIdx = Math.min(bot.routeIdx, bot.route.length - 1);
          }
        }
      } else {
        // hold: scan the area, sometimes crouch behind cover.
        bot.holdTimer -= dt;
        bot.yaw += Math.sin(ctx.time * 0.5 + bot.scanPhase) * dt * 0.7;
        if (bot.holdTimer <= 0) {
          const dest = Math.floor(Math.random() * WAYPOINTS.length);
          setRoute(bot, dest);
        }
      }

      // Keep bots from standing inside each other.
      for (const other of bots) {
        if (other === bot || !other.alive) continue;
        const dx = bot.pos.x - other.pos.x;
        const dz = bot.pos.z - other.pos.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.64 && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = (0.8 - d) * 0.5;
          bot.pos.x += (dx / d) * push * dt * 10;
          bot.pos.z += (dz / d) * push * dt * 10;
        }
      }

      // Sync the mesh.
      bot.group.position.set(bot.pos.x, bot.pos.y, bot.pos.z);
      bot.group.rotation.y = bot.yaw;
      bot.group.rotation.x = 0;
    }
  }

  function aliveCount(team) {
    let n = 0;
    for (const b of bots) if (b.team === team && b.alive) n += 1;
    return n;
  }

  function resetRound(spawns, assignments) {
    // assignments: [{ team, weaponId, skill, carrier, siteNode }]
    for (let i = bots.length - 1; i >= 0; i -= 1) {
      scene.remove(bots[i].group);
    }
    bots.length = 0;
    hitMeshes.length = 0;
    assignments.forEach((a, i) => {
      const [x, z] = spawns[a.team][i % spawns[a.team].length];
      const yaw = a.team === 'vanguard' ? Math.PI : 0;
      const bot = spawn(a.team, i, x, z, yaw, a.weaponId, a.skill, a.carrier);
      bot.assignedSite = a.siteNode ?? null;
      if (a.destNode != null) setRoute(bot, a.destNode);
    });
  }

  return { bots, hitMeshes, spawn, applyDamage, step, aliveCount, resetRound, setRoute };
}

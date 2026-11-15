// SANDLINE — boot and the one loop. A fixed 60 Hz simulation feeds a render at
// the display's rate; the sim (player, weapons, bots, combat, rounds, effects)
// never allocates in its hot loops and never touches the DOM except through
// hud.js. ?shot=start|play|buy|end with &seed=N sets up a deterministic frame
// for a capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS, WAYPOINTS } from './world.js';
import { hasLineOfSight, boxOverlaps } from './collision.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, WEAPON_ORDER } from './weapons.js';
import { createBots, nearestNode } from './bots.js';
import { createCombat } from './combat.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createEffects } from './effects.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

window.__gameErrors = [];
window.addEventListener('error', (e) => window.__gameErrors.push(String(e.message) + (e.error && e.error.stack ? '\n' + e.error.stack : '')));
window.addEventListener('unhandledrejection', (e) => window.__gameErrors.push(String(e.reason)));

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = shot ? mulberry32(seed) : Math.random;
if (shot) Math.random = random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three 0.187.
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const bots = createBots(scene, world.colliders, effects);
const hud = createHud(world, { onPlay: onPlayButton, onBuy: buyItem });
const input = createInput(renderer.domElement, onLockChange);

// The player's own hit meshes, for bot raycasts: transparent, so they never
// show, but they still intersect. Player shots never test them (their own
// list excludes them), so the eye never blocks its own bullet.
const playerHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerHitGroup = new THREE.Group();
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.3, 0.3), playerHitMat);
playerTorso.position.y = 0.72;
playerTorso.userData.isPlayer = true;
playerTorso.userData.part = 'torso';
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), playerHitMat);
playerHead.position.y = 1.53;
playerHead.userData.isPlayer = true;
playerHead.userData.part = 'head';
playerHitGroup.add(playerTorso, playerHead);
scene.add(playerHitGroup);
const playerEntity = { pos: player.state.position, alive: true, team: 'vanguard', isPlayer: true, name: 'You' };

const botShootables = world.shootables.concat([playerTorso, playerHead]);

// The bot hit meshes are rebuilt every round (resetRound clears hitMeshes and
// pushes fresh meshes), so the concat above goes stale the moment the first
// round starts: it would hold the pre-round, empty hit list and the player's
// bullets would pass straight through the bots. Build the list fresh per shot.
function playerTargets() {
  return world.shootables.concat(bots.hitMeshes);
}
const noises = [];
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let kickDebt = 0;
let stepTimer = 0;
let plantProgress = 0;
let defuseProgress = 0;
let playerHasBomb = false;
let buyOpen = false;
let fovTarget = 74;
let lastShotAt = 0;

const body = player.state;

const rounds = createRounds(scene, {
  onPhase(phase) {
    hud.setTimer(phase === 'buy' ? rounds.BUY_SECONDS : phase === 'live' ? rounds.ROUND_SECONDS : 0, phase);
    if (phase === 'buy') {
      openBuy();
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (phase === 'live') hud.hideBuy();
  },
  onSetupRound(round) {
    setupRound(round);
  },
  onRoundEnd(winner, reason, score) {
    hud.banner(winner === 'vanguard' ? 'Round won' : 'Round lost', reason, 3200);
    hud.setScore(score.vanguard, score.jackal, rounds.state.round);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, score) {
    hud.showOverlay('matchEnd', { winner, score });
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMoney(m) {
    hud.setMoney(m);
    hud.refreshBuy(m, weapons.owned, weapons.grenades, body.armor > 0);
  },
  onBombPlanted(site) {
    hud.banner('Bomb planted', `Site ${site} — defend it until it blows`, 3000);
    hud.setBomb(`BOMB PLANTED — SITE ${site}`, true);
    audio.plantBeep();
  },
  onBombExploded(pos) {
    hud.setBomb('', false);
    shake(1);
  },
  onBombDefused() {
    hud.setBomb('', false);
  },
  onBombDropped() {
    hud.setBomb('BOMB DROPPED — go pick it up', true);
  },
  onBombTick() {
    audio.bombTick();
  },
  onBuy(item) {
    if (item.kind === 'weapon') weapons.buy(item.id);
    else if (item.kind === 'grenade') weapons.grenades[item.id] += 1;
    else if (item.kind === 'armor') body.armor = 100;
    audio.buy();
    hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name.toUpperCase());
  },
  onSound(kind) {
    if (kind === 'win') audio.roundWin();
    else audio.roundLoss();
  },
  hasWeapon(id) {
    return !!weapons.owned[id];
  },
  hasArmor() {
    return body.armor > 0;
  },
});

const combat = createCombat(scene, world, effects, audio, {
  player: body,
  onNoise(x, z, radius) {
    noises.push({ x, z, radius, time: elapsed });
    if (noises.length > 24) noises.shift();
  },
  onBotDamaged(bot, dmg, part, attackerName) {
    const killed = bots.applyDamage(bot, dmg);
    if (dmg > 0 && attackerName === 'You') hud.hitMarker(killed);
    if (killed) onBotKilled(bot, attackerName, part);
    return killed;
  },
  onPlayerDamaged(dmg, fromPos) {
    if (!body.alive || dmg <= 0) return;
    body.health -= dmg;
    hud.setHealth(body.health, body.armor);
    const dx = fromPos.x - body.position.x;
    const dz = fromPos.z - body.position.z;
    const worldAngle = Math.atan2(dx, dz);
    const rel = worldAngle + body.yaw;
    hud.damageFlash(rel);
    audio.hurt();
    if (body.health <= 0) onPlayerKilled(fromPos);
  },
  onExplosion(pos) {
    const d = Math.hypot(pos.x - body.position.x, pos.z - body.position.z);
    shake(Math.max(0, 1 - d / 25));
  },
  entities() {
    const list = [playerEntity];
    for (const b of bots.bots) list.push(b);
    return list;
  },
});

function onBotKilled(bot, attackerName, part) {
  hud.killfeed(attackerName, bot.name, part === 'head', attackerName === 'You' ? 'vanguard' : 'jackal');
  if (attackerName === 'You') {
    rounds.addKillReward();
    audio.kill();
  }
  if (bot.hasBomb) {
    bot.hasBomb = false;
    rounds.dropBomb(bot.pos);
  }
  hud.setAlive(bots.aliveCount('vanguard') + (body.alive ? 1 : 0), bots.aliveCount('jackal'));
}

function onPlayerKilled(fromPos) {
  body.alive = false;
  playerEntity.alive = false;
  rounds.addDeath();
  hud.killfeed('Jackal', 'You', false, 'jackal');
  hud.setHealth(0, body.armor);
  hud.setAlive(bots.aliveCount('vanguard'), bots.aliveCount('jackal'));
  if (playerHasBomb) {
    playerHasBomb = false;
    rounds.dropBomb(body.position);
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function shake(amount) {
  shakeAmt = Math.max(shakeAmt, amount);
}
let shakeAmt = 0;

function botFire(bot, target) {
  const eye = tmpEye.set(bot.pos.x, bot.pos.y + 1.45, bot.pos.z);
  const chest = tmpChest.set(target.pos.x, target.pos.y + (target.isPlayer ? 1.25 : 1.1), target.pos.z);
  const dirv = tmpDir.copy(chest).sub(eye);
  const dist = dirv.length();
  dirv.normalize();
  const dmg = WEAPONS[bot.weaponId].damage;
  // Same matrixWorld freshness as the player's shoot(): the bots fire from
  // inside the sim step, which in the shot script runs without a render.
  scene.updateMatrixWorld();
  combat.fireHitscan(eye, dirv, bot.aimErr, dmg, bot.team, {
    targets: botShootables,
    attackerName: bot.name,
    noiseRadius: 26,
  });
  audio.shot(bot.weaponId, dist);
}
const tmpEye = new THREE.Vector3();
const tmpChest = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpAim = new THREE.Vector3();

function setupRound(round) {
  // Player back to the Vanguard spawn, facing the yard.
  player.reset(SPAWNS.vanguard[0][0], SPAWNS.vanguard[0][1], 0);
  playerEntity.alive = true;
  playerHasBomb = true;
  plantProgress = 0;
  defuseProgress = 0;
  weapons.refillAmmo();
  combat.clearGrenades();
  hud.setHealth(100, body.armor);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name.toUpperCase());
  hud.setBomb('YOU CARRY THE BOMB — plant at A or B', true);
  hud.setAlive(5, 5);
  hud.banner(`Round ${round}`, round === 1 ? 'Plant the bomb at Site A or B' : 'Buy up, then plant the bomb', 2600);
  // Bots: 4 Vanguard teammates, 5 Jackals. Routes fan out to both sites.
  const vanguardDest = [6, 18, 13, 6];
  const jackalDest = [26, 27, 13, 29, 30];
  const assignments = [];
  const vWeapons = ['rifle', 'smg', 'rifle', 'dmr'];
  const jWeapons = ['rifle', 'rifle', 'smg', 'dmr', 'smg'];
  for (let i = 0; i < 4; i += 1) {
    assignments.push({ team: 'vanguard', weaponId: vWeapons[i], skill: 0.6 + random() * 0.2, carrier: false, siteNode: vanguardDest[i] === 6 ? 6 : 18, destNode: vanguardDest[i] });
  }
  for (let i = 0; i < 5; i += 1) {
    assignments.push({ team: 'jackal', weaponId: jWeapons[i], skill: 0.58 + random() * 0.22, carrier: false, siteNode: null, destNode: jackalDest[i] });
  }
  bots.resetRound(SPAWNS, assignments);
}

function openBuy() {
  buyOpen = true;
  hud.showBuy(rounds.state.money, weapons.owned, weapons.grenades, body.armor > 0);
}
function closeBuy() {
  buyOpen = false;
  hud.hideBuy();
}
function buyItem(id) {
  if (rounds.state.phase !== 'buy') return;
  if (rounds.buy(id)) {
    hud.setMoney(rounds.state.money);
    hud.refreshBuy(rounds.state.money, weapons.owned, weapons.grenades, body.armor > 0);
  }
}

function onPlayButton() {
  audio.unlock();
  if (shot) return;
  if (rounds.state.phase === 'menu') {
    rounds.startMatch();
    hud.hideOverlay();
    return;
  }
  if (rounds.state.phase === 'matchEnd') {
    rounds.startMatch();
    hud.hideOverlay();
    return;
  }
  input.requestLock();
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (buyOpen) closeBuy();
  } else if (rounds.state.phase === 'live' && body.alive) {
    hud.showOverlay('paused');
  } else if (rounds.state.phase === 'buy') {
    openBuy();
  }
}

function siteAt(x, z) {
  for (const [key, site] of Object.entries(SITES)) {
    if (Math.abs(x - site.center.x) <= site.half.x && Math.abs(z - site.center.z) <= site.half.z) return key;
  }
  return null;
}

function shoot(spread) {
  if (!weapons.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(tmpDir);
  tmpDir.x += (random() * 2 - 1) * spread;
  tmpDir.y += (random() * 2 - 1) * spread;
  tmpDir.z += (random() * 2 - 1) * spread;
  tmpDir.normalize();
  player.eyePosition(tmpAim);
  // The raycaster reads each mesh's matrixWorld, which only the renderer
  // refreshes. In the shot script the sim runs without a render in between,
  // so the bot meshes would still sit at their spawn matrix and the bullet
  // would pass through them: refresh the graph before every ray.
  scene.updateMatrixWorld();
  const shotResult = combat.fireHitscan(tmpAim, tmpDir, 0, weapons.def().damage, 'vanguard', {
    targets: playerTargets(),
    attackerName: 'You',
    noiseRadius: weapons.def().id === 'pistol' ? 20 : 30,
  });
  // Debug handle for the screenshot probes: what the last bullet actually hit.
  window.__lastShot = shotResult
    ? { bot: shotResult.bot?.name ?? null, part: shotResult.part ?? null, point: [shotResult.point.x.toFixed(1), shotResult.point.y.toFixed(1), shotResult.point.z.toFixed(1)], hitObject: shotResult.hit.object.type, hitName: shotResult.hit.object.userData.part ?? shotResult.hit.object.name ?? '' }
    : { bot: null, point: null };
  weapons.pullTrigger();
  audio.shot(weapons.def().id, 0);
  const kick = weapons.def().kick;
  player.recoil(kick, (random() * 2 - 1) * kick * 0.3);
  kickDebt += kick * 0.55;
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name.toUpperCase());
  return true;
}

function step(dt) {
  elapsed += dt;
  const keys = input.state.keys;
  const phase = rounds.state.phase;

  // Recoil recovery: part of the kick eases back off on its own.
  if (kickDebt > 0) {
    const rec = Math.min(kickDebt, dt * 0.05);
    body.pitch -= rec;
    kickDebt -= rec;
  }

  if (phase === 'live' || phase === 'buy') {
    player.step(dt, keys, weapons.moveMultiplier());
    weapons.step(dt, player.groundSpeed());
    // Footsteps.
    if (player.groundSpeed() > 1 && body.onGround) {
      stepTimer -= dt;
      if (stepTimer <= 0) {
        stepTimer = 0.38;
        audio.step();
      }
    }
    // Plant / defuse channels, on E.
    const site = siteAt(body.position.x, body.position.z);
    if (phase === 'live' && body.alive && playerHasBomb && site && keys.has('KeyE')) {
      plantProgress += dt;
      hud.setPlantProgress(plantProgress / rounds.PLANT_SECONDS);
      if (plantProgress >= rounds.PLANT_SECONDS) {
        rounds.plantBomb(site, true);
        playerHasBomb = false;
        plantProgress = 0;
        hud.setPlantProgress(0);
      }
    } else if (plantProgress > 0) {
      plantProgress = 0;
      hud.setPlantProgress(0);
    }
    const bomb = rounds.state.bomb;
    if (phase === 'live' && body.alive && bomb.state === 'planted' && keys.has('KeyE')) {
      const d = Math.hypot(bomb.pos.x - body.position.x, bomb.pos.z - body.position.z);
      if (d < 1.8) {
        defuseProgress += dt;
        hud.setPlantProgress(defuseProgress / rounds.DEFUSE_SECONDS);
        if (Math.floor(defuseProgress * 2) !== Math.floor((defuseProgress - dt) * 2)) audio.defuse();
        if (defuseProgress >= rounds.DEFUSE_SECONDS) {
          rounds.defuseBomb();
          defuseProgress = 0;
          hud.setPlantProgress(0);
        }
      } else if (defuseProgress > 0) {
        defuseProgress = 0;
        hud.setPlantProgress(0);
      }
    }
    // Pick up a dropped bomb by walking over it.
    if (phase === 'live' && body.alive && bomb.state === 'dropped') {
      const d = Math.hypot(bomb.pos.x - body.position.x, bomb.pos.z - body.position.z);
      if (d < 1.3) {
        rounds.pickupBomb();
        playerHasBomb = true;
        hud.setBomb('YOU CARRY THE BOMB — plant at A or B', true);
        hud.banner('Bomb recovered', 'Plant it at Site A or B', 2200);
      }
    }
  }

  // Bots: enemies list is the player plus every bot; noises fade with time.
  const enemies = [playerEntity];
  for (const b of bots.bots) enemies.push(b);
  const bombCtx = rounds.state.bomb;
  bots.step(dt, {
    time: elapsed,
    player: playerEntity,
    playerSpeed: player.groundSpeed(),
    enemies,
    bomb: { state: bombCtx.state, site: bombCtx.site, siteNode: bombCtx.site === 'A' ? 6 : 18, pos: bombCtx.pos },
    noises,
    fire: botFire,
    onPlanted(bot) {
      rounds.plantBomb(bot.assignedSite === 6 ? 'A' : 'B', false);
    },
    onDefused() {
      rounds.defuseBomb();
    },
    onBombPickup() {
      rounds.pickupBomb();
    },
  });

  combat.step(dt);
  rounds.step(dt, {
    aliveVanguard: bots.aliveCount('vanguard') + (body.alive ? 1 : 0),
    aliveJackal: bots.aliveCount('jackal'),
  });
  effects.step(dt);
  for (let i = noises.length - 1; i >= 0; i -= 1) {
    if (elapsed - noises[i].time > 2) noises.splice(i, 1);
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  // Keep the world matrix fresh: shoot() reads the camera direction through
  // getWorldDirection, and the shot script aims and fires without a render
  // in between, so a stale matrix would send the bullet the old way.
  camera.updateMatrixWorld();
  if (shakeAmt > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeAmt * 0.12;
    camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.12;
    shakeAmt = Math.max(0, shakeAmt - 0.03);
  }
  playerHitGroup.position.set(body.position.x, body.position.y, body.position.z);
  playerHitGroup.rotation.y = body.yaw;
}

function syncHud() {
  hud.setHealth(body.health, body.armor);
  hud.setAmmo(weapons.ammo().mag, weapons.ammo().reserve, weapons.def().name.toUpperCase());
  hud.setTimer(rounds.state.timer, rounds.state.phase);
  hud.setScore(rounds.state.score.vanguard, rounds.state.score.jackal, rounds.state.round);
  hud.setAlive(bots.aliveCount('vanguard') + (body.alive ? 1 : 0), bots.aliveCount('jackal'));
  hud.setCrosshairSpread(7 + weapons.spread(player.groundSpeed()) * 900 + player.groundSpeed() * 1.2);
  hud.setReloading(weapons.state.reloadLeft > 0);
  const mates = [];
  const foes = [];
  for (const b of bots.bots) {
    if (!b.alive) continue;
    if (b.team === 'vanguard') mates.push(b);
    else if (b.target === playerEntity || elapsed - b.lastDamageAt < 2) foes.push(b);
  }
  hud.drawMinimap(player.state, mates, foes, rounds.state.bomb);
  window.__gameState = {
    phase: rounds.state.phase,
    round: rounds.state.round,
    score: { ...rounds.state.score },
    aliveV: bots.aliveCount('vanguard') + (body.alive ? 1 : 0),
    aliveJ: bots.aliveCount('jackal'),
    playerHealth: Math.max(0, Math.round(body.health)),
    money: rounds.state.money,
    bomb: rounds.state.bomb.state,
    errors: window.__gameErrors.length,
  };
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    weapons.setAiming(input.state.aiming && input.state.locked);
    fovTarget = weapons.state.aiming ? 74 / weapons.def().zoom : 74;
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
    const pressed = input.takePressed();
    for (const code of pressed) {
      if (code === 'KeyR') weapons.reload();
      else if (code === 'Digit1') weapons.switchTo('pistol');
      else if (code === 'Digit2') weapons.switchTo('rifle');
      else if (code === 'Digit3') weapons.switchTo('smg');
      else if (code === 'Digit4') weapons.switchTo('dmr');
      else if (code === 'KeyG' && weapons.useGrenade('frag')) {
        camera.getWorldDirection(tmpDir);
        player.eyePosition(tmpAim);
        combat.throwGrenade(tmpAim, tmpDir, 'frag');
      } else if (code === 'KeyH' && weapons.useGrenade('smoke')) {
        camera.getWorldDirection(tmpDir);
        player.eyePosition(tmpAim);
        combat.throwGrenade(tmpAim, tmpDir, 'smoke');
      } else if (code === 'KeyB' && rounds.state.phase === 'buy') {
        if (buyOpen) {
          closeBuy();
          input.requestLock();
        } else openBuy();
      }
    }
    if (buyOpen) {
      for (const code of pressed) {
        const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(code);
        if (idx >= 0) buyItem(['rifle', 'smg', 'dmr', 'frag', 'smoke', 'armor'][idx]);
      }
    }
    if (input.state.firing && input.state.locked && weapons.ready() && (rounds.state.phase === 'live' || rounds.state.phase === 'buy')) {
      // Sync the camera first so the bullet leaves along the aim the player
      // just set, not the previous frame's direction.
      syncCamera();
      shoot(weapons.spread(player.groundSpeed()));
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAtBot(bot) {
  const dx = bot.pos.x - body.position.x;
  const dy = (bot.pos.y + 1.1) - (body.position.y + body.eye);
  const dz = bot.pos.z - body.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  rounds.startMatch();
  settle(10);
  if (name === 'start') {
    body.position.set(0.6, 0, 12.5);
    body.yaw = 0.25;
    body.pitch = -0.02;
    settle(30);
    hud.showOverlay('start');
    hud.hideBuy(); // startMatch opened the buy menu; the menu shot is clean.
    syncCamera();
    syncHud();
  } else if (name === 'buy') {
    body.position.set(0.6, 0, 12.5);
    body.yaw = 0.25;
    settle(30);
    openBuy();
    syncCamera();
    syncHud();
  } else if (name === 'play') {
    // Find a firing position with a clear line of sight to a Jackal: try a few
    // open spots, take the nearest visible bot from the first spot that has one.
    rounds.state.phase = 'live';
    rounds.state.timer = 88;
    hud.hideBuy();
    const spots = [[0, 4], [-6, 0], [6, 0], [0, -4], [-10, 6], [10, -6]];
    let target = null;
    for (const [sx, sz] of spots) {
      body.position.set(sx, 0, sz);
      settle(30);
      const jackals = bots.bots.filter((b) => b.team === 'jackal' && b.alive);
      jackals.sort((a, b) => Math.hypot(a.pos.x - sx, a.pos.z - sz) - Math.hypot(b.pos.x - sx, b.pos.z - sz));
      for (const j of jackals) {
        if (hasLineOfSight(sx, body.position.y + body.eye, sz, j.pos.x, j.pos.y + 1.1, j.pos.z, world.colliders)) {
          target = j;
          break;
        }
      }
      if (target) break;
    }
    if (target) {
      // Step closer: 8 m from the target keeps the bot big in frame and the
      // pistol lethal, as long as the spot is free and the line stays clear.
      const dx = body.position.x - target.pos.x;
      const dz = body.position.z - target.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const nx = target.pos.x + (dx / d) * 8;
      const nz = target.pos.z + (dz / d) * 8;
      const free = !boxOverlaps(nx, 0, nz, 0.25, 1.8, 0.25, 0, world.colliders);
      const clear = hasLineOfSight(nx, body.position.y + body.eye, nz, target.pos.x, target.pos.y + 1.1, target.pos.z, world.colliders);
      if (free && clear) {
        body.position.set(nx, 0, nz);
        settle(10);
      }
      // Re-aim before every shot: the bot keeps moving between them.
      for (let i = 0; i < 6 && target.alive; i += 1) {
        aimAtBot(target);
        shoot(0);
        settle(4);
      }
      settle(6);
      hud.hideBanner(); // the round-start banner would cover the action.
    }
    syncCamera();
    syncHud();
  } else {
    // end: a round already won, banner up.
    rounds.state.score.vanguard = 1;
    rounds.state.score.jackal = 0;
    hud.setScore(1, 0, 1);
    hud.hideBuy();
    hud.banner('Round won', 'Jackals eliminated', 60000);
    body.position.set(-2, 0, 8);
    body.yaw = 0.5;
    settle(60);
    syncCamera();
    syncHud();
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);

// A small handle for the in-browser tests (screenshots, probes): the scene
// graph, the camera and the sim state, plus settle() to drive the fixed-step
// sim directly (a full match in seconds, without waiting on rAF). It changes
// nothing about the game.
window.__game = { scene, camera, renderer, weapons, bots, rounds, player, world, combat, effects, settle };

// Rounds: the match state machine. Five rounds to take the match, nine at
// most, a 100-second round timer, and a bomb the attackers must plant at A or
// B. Money is earned per kill and per round and spent in the buy phase; the
// buy menu is data here and DOM in hud.js. The module owns the bomb mesh and
// its blinking light, and tells main.js about every transition through hooks.
import * as THREE from 'three';
import { WEAPONS, GRENADES } from './weapons.js';
import { SITES } from './world.js';
import { PALETTE } from './palette.js';

export const BUY_ITEMS = [
  { id: 'rifle', kind: 'weapon', name: WEAPONS.rifle.name, price: WEAPONS.rifle.price, desc: 'Auto rifle · 33 dmg · 30/90' },
  { id: 'smg', kind: 'weapon', name: WEAPONS.smg.name, price: WEAPONS.smg.price, desc: 'Fast SMG · 22 dmg · 25/100' },
  { id: 'dmr', kind: 'weapon', name: WEAPONS.dmr.name, price: WEAPONS.dmr.price, desc: 'Marksman · 78 dmg · 10/30 · zoom' },
  { id: 'frag', kind: 'grenade', name: GRENADES.frag.name, price: GRENADES.frag.price, desc: 'Explodes after 1.6 s · 95 dmg' },
  { id: 'smoke', kind: 'grenade', name: GRENADES.smoke.name, price: GRENADES.smoke.price, desc: 'Blocks sight for 18 s' },
  { id: 'armor', kind: 'armor', name: 'Kevlar Vest', price: 650, desc: 'Absorbs half of damage taken' },
];

const BUY_SECONDS = 12;
const ROUND_SECONDS = 100;
const FUSE_SECONDS = 35;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;

export function createRounds(scene, hooks) {
  const bombGroup = new THREE.Group();
  const bombBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.2, 0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c2a26'), roughness: 0.5, metalness: 0.4 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.red) }),
  );
  bombLight.position.set(0, 0.14, 0);
  bombGroup.add(bombBox, bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 0,
    score: { vanguard: 0, jackal: 0 },
    money: 800,
    timer: 0,
    bomb: { state: 'none', site: null, siteNode: 6, pos: new THREE.Vector3(), fuse: 0, plantProgress: 0 },
    kills: 0,
    deaths: 0,
    lastReason: '',
    plantSite: null, // 'A' | 'B' | null: where the player stands right now
  };

  function setPhase(phase) {
    state.phase = phase;
    hooks.onPhase(phase);
  }

  function startMatch() {
    state.score.vanguard = 0;
    state.score.jackal = 0;
    state.money = 800;
    state.kills = 0;
    state.deaths = 0;
    state.round = 0;
    hooks.onMoney(state.money);
    startRound();
  }

  function startRound() {
    state.round += 1;
    state.bomb.state = 'carried';
    state.bomb.site = null;
    state.bomb.fuse = 0;
    state.bomb.plantProgress = 0;
    state.timer = BUY_SECONDS;
    bombGroup.visible = false;
    hooks.onSetupRound(state.round);
    setPhase('buy');
  }

  function beginLive() {
    state.timer = ROUND_SECONDS;
    setPhase('live');
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.lastReason = reason;
    state.score[winner] += 1;
    const playerWon = winner === 'vanguard';
    state.money += playerWon ? 325 : 200;
    hooks.onMoney(state.money);
    hooks.onRoundEnd(winner, reason, { ...state.score });
    if (playerWon) hooks.onSound('win');
    else hooks.onSound('loss');
    state.timer = 3.5;
    if (state.score.vanguard >= WIN_ROUNDS || state.score.jackal >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      setPhase('matchEnd');
      hooks.onMatchEnd(state.score.vanguard > state.score.jackal ? 'vanguard' : 'jackal', { ...state.score });
    } else {
      setPhase('roundEnd');
    }
  }

  function plantBomb(site, byPlayer) {
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.fuse = FUSE_SECONDS;
    state.bomb.pos.set(SITES[site].center.x, 0, SITES[site].center.z);
    bombGroup.position.copy(state.bomb.pos);
    bombGroup.position.y = 0.12;
    bombGroup.visible = true;
    if (byPlayer) {
      state.money += 300;
      hooks.onMoney(state.money);
    }
    hooks.onBombPlanted(site);
  }

  function explodeBomb() {
    hooks.onBombExploded(state.bomb.pos);
    bombGroup.visible = false;
    state.bomb.state = 'none';
    endRound('vanguard', 'Bomb detonated at Site ' + state.bomb.site);
  }

  function defuseBomb() {
    state.bomb.state = 'none';
    bombGroup.visible = false;
    hooks.onBombDefused();
    endRound('jackal', 'Bomb defused at Site ' + state.bomb.site);
  }

  function dropBomb(pos) {
    state.bomb.state = 'dropped';
    state.bomb.pos.copy(pos);
    bombGroup.position.copy(pos);
    bombGroup.position.y = 0.12;
    bombGroup.visible = true;
    hooks.onBombDropped();
  }

  function pickupBomb() {
    state.bomb.state = 'carried';
    bombGroup.visible = false;
  }

  function buy(itemId) {
    const item = BUY_ITEMS.find((i) => i.id === itemId);
    if (!item || state.money < item.price) return false;
    if (item.kind === 'weapon' && hooks.hasWeapon(itemId)) return false;
    if (item.kind === 'armor' && hooks.hasArmor()) return false;
    state.money -= item.price;
    hooks.onMoney(state.money);
    hooks.onBuy(item);
    return true;
  }

  function step(dt, ctx) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) beginLive();
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) startRound();
      return;
    }
    if (state.phase !== 'live') return;
    state.timer -= dt;
    // Bomb fuse counts down inside the round.
    if (state.bomb.state === 'planted') {
      state.bomb.fuse -= dt;
      bombLight.material.color.set(Math.sin(ctx.time * 10) > 0 ? PALETTE.red : '#40160f');
      if (Math.floor(state.bomb.fuse) !== Math.floor(state.bomb.fuse + dt)) hooks.onBombTick();
      if (state.bomb.fuse <= 0) {
        explodeBomb();
        return;
      }
    }
    if (state.timer <= 0) {
      if (state.bomb.state === 'planted') return; // fuse decides it
      endRound('jackal', 'Time expired — Site held');
      return;
    }
    // Elimination wins, checked by main.js every step.
    if (ctx.aliveVanguard === 0) {
      endRound('jackal', 'Vanguard eliminated');
      return;
    }
    if (ctx.aliveJackal === 0) {
      if (state.bomb.state === 'planted') return; // fuse still decides
      endRound('vanguard', 'Jackals eliminated');
    }
  }

  return {
    state,
    BUY_SECONDS,
    ROUND_SECONDS,
    FUSE_SECONDS,
    PLANT_SECONDS,
    DEFUSE_SECONDS,
    startMatch,
    startRound,
    endRound,
    plantBomb,
    explodeBomb,
    defuseBomb,
    dropBomb,
    pickupBomb,
    buy,
    step,
    addKillReward() {
      state.money += 300;
      state.kills += 1;
      hooks.onMoney(state.money);
    },
    addDeath() {
      state.deaths += 1;
    },
  };
}

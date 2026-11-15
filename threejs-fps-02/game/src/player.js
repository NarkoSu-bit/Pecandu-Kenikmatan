// Player movement: acceleration, friction, gravity, crouch and jump, resolved
// as a box against the world's colliders one axis at a time, so a wall never
// swallows the player. The caller passes the input key set and a speed
// multiplier (aiming down sights and walking slow the player down).
import * as THREE from 'three';
import { boxOverlaps } from './collision.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.5;
const SLOW_SPEED = 3.1; // Shift: walk slow, shoot straight
const GROUND_ACCEL = 46;
const AIR_ACCEL = 10;
const FRICTION = 10;
const GRAVITY = 21;
const JUMP_SPEED = 6.4;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 12.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0021) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.5, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys, speedMul = 1) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching && !boxOverlaps(state.position.x, state.position.y, state.position.z, RADIUS, STAND_HEIGHT, RADIUS, 0.02, colliders)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const slow = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const base = state.crouching ? CROUCH_SPEED : slow ? SLOW_SPEED : WALK_SPEED;
    const speed = base * speedMul;
    const blend = Math.min(1, ((state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt) / Math.max(speed, 0.5));
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;

    const nextX = state.position.x + state.velocity.x * dt;
    if (!boxOverlaps(nextX, state.position.y, state.position.z, RADIUS, state.height, RADIUS, 0.04, colliders)) state.position.x = nextX;
    else state.velocity.x = 0;
    const nextZ = state.position.z + state.velocity.z * dt;
    if (!boxOverlaps(state.position.x, state.position.y, nextZ, RADIUS, state.height, RADIUS, 0.04, colliders)) state.position.z = nextZ;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const hit = boxOverlaps(state.position.x, state.position.y, state.position.z, RADIUS, state.height, RADIUS, 0, colliders);
    if (hit && state.velocity.y <= 0) {
      state.position.y = hit.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (hit) {
      state.position.y = hit.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
    state.velocity.y = Math.max(-30, state.velocity.y);
  }

  return {
    state,
    step,
    look,
    recoil,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
    eyePosition(out) {
      out.set(state.position.x, state.position.y + state.eye, state.position.z);
      return out;
    },
    reset(x, z, yaw) {
      state.position.set(x, 0, z);
      state.velocity.set(0, 0, 0);
      state.yaw = yaw;
      state.pitch = 0;
      state.health = 100;
      state.armor = 0;
      state.alive = true;
      state.crouching = false;
      state.height = STAND_HEIGHT;
      state.eye = STAND_EYE;
    },
  };
}

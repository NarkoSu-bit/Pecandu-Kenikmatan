// Effects: tracers, impact particles, explosions and smoke. Everything is
// pooled — one Points cloud, a few tracer lines, a few smoke spheres — so the
// hot loops never allocate. Smoke spheres double as line-of-sight blockers:
// combat and the bots ask this module whether a segment crosses live smoke.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const MAX_PARTICLES = 320;
const MAX_TRACERS = 16;
const MAX_SMOKE = 8;

export function createEffects(scene) {
  // --- particles: one Points cloud, typed arrays, dead particles parked below.
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(MAX_PARTICLES * 3);
  const pCol = new Float32Array(MAX_PARTICLES * 3);
  for (let i = 0; i < MAX_PARTICLES; i += 1) pPos[i * 3 + 1] = -1000;
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < MAX_PARTICLES; i += 1) {
    parts.push({ alive: false, x: 0, y: -1000, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, grav: 1 });
  }
  let partCursor = 0;

  // --- tracers: a pool of two-point lines.
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  // --- smoke: a pool of translucent spheres.
  const smokes = [];
  const smokeGeo = new THREE.SphereGeometry(1, 14, 10);
  for (let i = 0; i < MAX_SMOKE; i += 1) {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa0a3'), transparent: true, opacity: 0, depthWrite: false, roughness: 1 });
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, life: 0, max: 1, radius: 1 });
  }

  // --- explosions: a pool of expanding shells plus a light each.
  const blasts = [];
  for (let i = 0; i < 2; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.gold), transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    const light = new THREE.PointLight(new THREE.Color(PALETTE.gold), 0, 18);
    scene.add(mesh, light);
    blasts.push({ mesh, light, life: 0 });
  }

  const tmpColor = new THREE.Color();

  function burst(x, y, z, hex, count, speed, up = 1.5, life = 0.6) {
    tmpColor.set(hex);
    for (let n = 0; n < count; n += 1) {
      const idx = partCursor;
      const p = parts[idx];
      partCursor = (partCursor + 1) % MAX_PARTICLES;
      p.alive = true;
      p.x = x;
      p.y = y;
      p.z = z;
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.3) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * Math.cos(b) * s;
      p.vy = Math.sin(b) * s + up;
      p.vz = Math.sin(a) * Math.cos(b) * s;
      p.max = life * (0.6 + Math.random() * 0.7);
      p.life = p.max;
      p.grav = 1;
      const i3 = idx * 3;
      pCol[i3] = tmpColor.r;
      pCol[i3 + 1] = tmpColor.g;
      pCol[i3 + 2] = tmpColor.b;
    }
  }

  function fireTracer(from, to, enemy) {
    const t = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % MAX_TRACERS;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x;
    pos[1] = from.y;
    pos[2] = from.z;
    pos[3] = to.x;
    pos[4] = to.y;
    pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.set(enemy ? PALETTE.red : '#ffe9b0');
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.life = 0.07;
  }

  function explosion(x, y, z) {
    const b = blasts.find((e) => e.life <= 0) ?? blasts[0];
    b.mesh.position.set(x, y, z);
    b.light.position.set(x, y + 0.5, z);
    b.mesh.visible = true;
    b.life = 0.45;
    burst(x, y, z, PALETTE.gold, 26, 7, 3, 0.9);
    burst(x, y, z, '#5c5348', 18, 4, 2, 1.4);
  }

  function spawnSmoke(x, y, z, radius, duration) {
    const s = smokes.find((e) => e.life <= 0) ?? smokes[0];
    s.mesh.position.set(x, y, z);
    s.mesh.scale.setScalar(radius);
    s.mesh.visible = true;
    s.radius = radius;
    s.max = duration;
    s.life = duration;
  }

  // Segment vs live smoke spheres: true when the segment crosses any of them.
  function segmentInSmoke(ax, ay, az, bx, by, bz) {
    for (const s of smokes) {
      if (s.life <= 0) continue;
      const cx = s.mesh.position.x;
      const cy = s.mesh.position.y;
      const cz = s.mesh.position.z;
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz || 1;
      let t = ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const px = ax + dx * t - cx;
      const py = ay + dy * t - cy;
      const pz = az + dz * t - cz;
      if (px * px + py * py + pz * pz < s.radius * s.radius * 0.8) return true;
    }
    return false;
  }

  function step(dt) {
    for (let i = 0; i < MAX_PARTICLES; i += 1) {
      const p = parts[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        pPos[i * 3 + 1] = -1000;
        continue;
      }
      p.vy -= 9 * p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy *= -0.3;
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
      pPos[i * 3] = p.x;
      pPos[i * 3 + 1] = p.y;
      pPos[i * 3 + 2] = p.z;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.line.visible = false;
        t.line.material.opacity = 0;
      }
    }
    for (const s of smokes) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      s.mesh.material.opacity = 0.5 * Math.min(1, k * 3);
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (const b of blasts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const k = Math.max(0, b.life / 0.45);
      b.mesh.scale.setScalar((1 - k) * 5 + 0.5);
      b.mesh.material.opacity = k * 0.55;
      b.light.intensity = k * 60;
      if (b.life <= 0) {
        b.mesh.visible = false;
        b.light.intensity = 0;
      }
    }
  }

  return { burst, fireTracer, explosion, spawnSmoke, segmentInSmoke, step };
}

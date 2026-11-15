// Dustline Yard: an original 44 x 30 m industrial yard at dusk. Two bomb sites
// (A "Silo" north-west, B "Depot" south-east), a mid lane, a long west lane, and
// an east lane, so every round has more than one way in. Every box is a
// collider for movement and a surface bullets stop on. Plain geometry only:
// boxes, cylinders and canvas-texture signs, no models, no textures, no network.
import * as THREE from 'three';
import { material, PALETTE } from './palette.js';

// Waypoint graph the bots walk. Nodes are {x, z}; edges are undirected.
export const WAYPOINTS = [
  [0, 12], [-8, 10], [-14, 8], [-18, 4], [-18, -2], [-18, -8], // 0..5 west / A-long
  [-15, -10], [-6, 6], [-8, 0], [-10, -6], [-13, -9], // 6 A site, 7..10 A-mid
  [0, 6], [0, 0], [0, -6], [0, -10], // 11..14 mid
  [6, 6], [8, 0], [10, 6], [14, 9], // 15..18 B-mid
  [8, 10], [14, 8], [18, 4], [18, 0], [16, 8], // 19..23 B-long
  [-4, -2], [4, -2], [-10, -8], [10, 10], // 24..27 holds
  [0, -12], [-6, -10], [6, -10], [-18, -11], [18, 11], // 28..32 spawns/corners
];
export const WAYPOINT_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [5, 31], [6, 10], [6, 26], [6, 31],
  [0, 7], [7, 8], [8, 9], [9, 10], [8, 24], [9, 26], [10, 26],
  [0, 11], [11, 12], [12, 13], [13, 14], [12, 24], [12, 25], [13, 29], [13, 30],
  [0, 15], [15, 16], [16, 17], [17, 18], [16, 25], [17, 27], [18, 23], [18, 27],
  [0, 19], [19, 20], [20, 21], [21, 22], [22, 23], [20, 23], [19, 32], [18, 32],
  [14, 28], [14, 29], [14, 30], [28, 29], [28, 30], [29, 26], [30, 25],
  [24, 29], [25, 30], [26, 29], [27, 23], [3, 24], [21, 25], [4, 24], [22, 25],
];

export const SITES = {
  A: { name: 'Silo', center: new THREE.Vector3(-15.5, 0, -9.5), half: new THREE.Vector3(3.6, 2.5, 3.0) },
  B: { name: 'Depot', center: new THREE.Vector3(15.5, 0, 9), half: new THREE.Vector3(3.6, 2.5, 3.0) },
};

export const SPAWNS = {
  vanguard: [
    [-2.5, 12.5], [-0.8, 13], [0.8, 13], [2.5, 12.5], [0, 11],
  ],
  jackal: [
    [-2.5, -12.5], [-0.8, -13], [0.8, -13], [2.5, -12.5], [0, -11],
  ],
};

function makeSignTexture(letter, sub) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1712';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = '#e07830';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 228, 228);
  ctx.fillStyle = '#f2ead8';
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 118);
  ctx.fillStyle = '#e07830';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(sub.toUpperCase(), 128, 208);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(mat, opts));
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const c = new THREE.Box3().setFromObject(mesh);
    if (!opts.noCollide) colliders.push(c);
    if (!opts.noShoot) shootables.push(mesh);
    return mesh;
  }

  function barrel(x, z, mat = 'rustDark') {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14),
      material(mat, { roughness: 0.6, metalness: 0.3 }),
    );
    mesh.position.set(x, 0.525, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1.05, z + 0.42)));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: one big sand slab plus darker patches so the floor reads at a glance.
  box(46, 0.4, 32, 0, -0.2, 0, 'sand', { noShoot: true });
  box(10, 0.06, 8, -14, 0.03, -8, 'sandDark', { noCollide: true, noShoot: true });
  box(10, 0.06, 8, 14, 0.03, 8, 'sandDark', { noCollide: true, noShoot: true });
  box(6, 0.06, 20, 0, 0.03, 0, 'sandDark', { noCollide: true, noShoot: true });

  // Perimeter walls, 4.5 m, with a sand-coloured cap.
  box(46.4, 4.5, 0.5, 0, 2.25, -15.25, 'surface');
  box(46.4, 4.5, 0.5, 0, 2.25, 15.25, 'surface');
  box(0.5, 4.5, 30.5, -22.25, 2.25, 0, 'surface');
  box(0.5, 4.5, 30.5, 22.25, 2.25, 0, 'surface');
  box(46.4, 0.3, 0.7, 0, 4.6, -15.25, 'wallTop', { noCollide: true });
  box(46.4, 0.3, 0.7, 0, 4.6, 15.25, 'wallTop', { noCollide: true });

  // Mid: a broken wall with two gaps (the "doors") and a crate stack.
  box(3.4, 3.4, 0.6, -8, 1.7, 0, 'surface');
  box(3.4, 3.4, 0.6, 8, 1.7, 0, 'surface');
  box(9.2, 3.4, 0.6, 0, 1.7, 0, 'surface');
  box(1.2, 1.2, 1.2, -2.2, 0.6, -2.2, 'steel');
  box(1.2, 1.2, 1.2, -2.2, 0.6, 2.2, 'steel');
  box(1.2, 1.2, 1.2, -2.2, 1.8, -2.2, 'steelDark');

  // Site A (Silo, north-west): containers form an L, crates for cover, a silo drum.
  box(6, 2.6, 2.4, -19, 1.3, -11, 'rust');
  box(2.4, 2.6, 6, -12, 1.3, -12.4, 'rustDark');
  box(1.2, 1.2, 1.2, -15, 0.6, -6.5, 'steel');
  box(1.2, 1.2, 1.2, -13.8, 0.6, -6.5, 'steel');
  box(1.2, 1.2, 1.2, -15, 1.8, -6.5, 'steelDark');
  box(2.2, 1.1, 1.2, -18.5, 0.55, -5.5, 'steel');
  barrel(-11.5, -7.5);
  barrel(-10.6, -6.6);
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5.2, 20), material('steel', { roughness: 0.5, metalness: 0.45 }));
  silo.position.set(-20.2, 2.6, -6.5);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(-21.8, 0, -8.1), new THREE.Vector3(-18.6, 5.2, -4.9)));
  shootables.push(silo);

  // Site B (Depot, south-east): mirrored containers, crates, a low platform.
  box(6, 2.6, 2.4, 19, 1.3, 11, 'rust');
  box(2.4, 2.6, 6, 12, 1.3, 12.4, 'rustDark');
  box(1.2, 1.2, 1.2, 15, 0.6, 6.5, 'steel');
  box(1.2, 1.2, 1.2, 13.8, 0.6, 6.5, 'steel');
  box(1.2, 1.2, 1.2, 15, 1.8, 6.5, 'steelDark');
  box(2.2, 1.1, 1.2, 18.5, 0.55, 5.5, 'steel');
  barrel(11.5, 7.5);
  barrel(10.6, 6.6);
  box(4.5, 0.5, 3, 19.5, 0.25, 4.5, 'steelDark');

  // Long west lane cover and east lane cover.
  box(1.2, 1.4, 2.4, -19.5, 0.7, 0.5, 'steel');
  box(1.2, 1.4, 2.4, -19.5, 0.7, -4.5, 'rust');
  box(1.2, 1.4, 2.4, 19.5, 0.7, -0.5, 'steel');
  box(1.2, 1.4, 2.4, 19.5, 0.7, 4.5, 'rust');
  // Spawn cover.
  box(2.4, 1.1, 1.2, -6, 0.55, 11.5, 'steel');
  box(2.4, 1.1, 1.2, 6, 0.55, 11.5, 'steel');
  box(2.4, 1.1, 1.2, -6, 0.55, -11.5, 'steel');
  box(2.4, 1.1, 1.2, 6, 0.55, -11.5, 'steel');
  // Mid-lane crates.
  box(1.2, 1.2, 1.2, 3.4, 0.6, -3.4, 'rust');
  box(1.2, 1.2, 1.2, -3.4, 0.6, 3.4, 'rust');

  // Site floor plates (emissive, no collision) and floating signs.
  for (const [key, site] of Object.entries(SITES)) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(site.half.x * 2, 0.08, site.half.z * 2),
      material('accent', { emissive: 'accent', emissiveIntensity: 0.55, roughness: 0.6 }),
    );
    plate.position.set(site.center.x, 0.04, site.center.z);
    plate.receiveShadow = true;
    group.add(plate);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: makeSignTexture(key, site.name), transparent: false }),
    );
    sign.position.set(site.center.x, 3.4, site.center.z);
    sign.rotation.y = key === 'A' ? Math.PI * 0.15 : Math.PI * 1.15;
    group.add(sign);
  }

  // Dunes outside the walls, so the horizon is not a flat void.
  const duneMat = material('sandDark', { roughness: 1 });
  for (let i = 0; i < 7; i += 1) {
    const dune = new THREE.Mesh(new THREE.SphereGeometry(9 + (i % 3) * 4, 12, 8), duneMat);
    const angle = (i / 7) * Math.PI * 2;
    dune.position.set(Math.cos(angle) * 42, -3.5, Math.sin(angle) * 34);
    dune.scale.y = 0.32;
    group.add(dune);
  }
  // The low sun, a disc on the horizon.
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 32),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.gold), fog: false }),
  );
  sun.position.set(-38, 7, -26);
  sun.lookAt(0, 2, 0);
  group.add(sun);

  // Light: warm low sun with shadows, cool sky fill. The hemisphere fill is
  // deliberately strong: at dusk the shadow side of a wall must stay readable,
  // not go black.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7a66'), new THREE.Color(PALETTE.canvas), 1.25);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.4);
  key.position.set(-18, 22, -14);
  key.target.position.set(4, 0, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -28;
  key.shadow.camera.right = 28;
  key.shadow.camera.top = 28;
  key.shadow.camera.bottom = -28;
  key.shadow.camera.far = 80;
  key.shadow.bias = -0.0005;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a8ba0'), 0.8);
  fill.position.set(16, 12, 14);
  scene.add(fill);

  return { colliders, shootables, group, bounds: { minX: -22, maxX: 22, minZ: -15, maxZ: 15 } };
}

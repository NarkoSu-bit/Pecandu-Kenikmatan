// SANDLINE — the look plan in one place. A dusk desert yard: warm sand, rusted
// steel, teal for the player's team (Vanguard) and amber for the Jackals. The
// same names are the CSS custom properties in index.html, so HUD and 3D agree.
export const PALETTE = {
  canvas: '#1c1712', // dusk sky / fog
  sand: '#b98d54', // ground
  sandDark: '#8a6a3e', // ground variation
  surface: '#57493a', // concrete walls (kept light enough to read at dusk)
  wallTop: '#6b5d49', // wall caps
  rust: '#8f4a26', // containers, rust
  rustDark: '#6e371c',
  steel: '#5c6a70', // metal crates
  steelDark: '#3e484d',
  ink: '#f2ead8', // warm off-white
  muted: '#a89a82', // dim text
  accent: '#e07830', // amber: Jackals, warnings, bomb
  teal: '#2fa8a0', // Vanguard, friendly, buy
  tealDark: '#1f6f6a',
  red: '#d43d2a', // damage, enemy tracers
  gold: '#f0b830', // money, highlights
};

export const TEAM_COLORS = {
  vanguard: PALETTE.teal,
  jackal: PALETTE.accent,
};

// One shared material per palette name, built once and reused by every mesh so
// the scene holds a handful of materials instead of one per box.
import * as THREE from 'three';

const cache = new Map();
export function material(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  let mat = cache.get(key);
  if (!mat) {
    // Leave emissive out entirely when it is not set: passing
    // emissive: undefined makes three.js warn on every such material.
    const params = {
      color: new THREE.Color(PALETTE[name] ?? name),
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0.04,
    };
    if (opts.emissive) {
      params.emissive = new THREE.Color(PALETTE[opts.emissive]);
      params.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    mat = new THREE.MeshStandardMaterial(params);
    cache.set(key, mat);
  }
  return mat;
}

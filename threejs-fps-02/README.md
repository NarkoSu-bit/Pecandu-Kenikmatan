# SANDLINE — Dustline Yard

A round-based tactical FPS in the style Counter-Strike made famous, built
for the make.fun threejs-fps-02 bounty. One player, four Vanguard teammates
and five Jackal bots fight over a dusk desert yard with two bomb sites.

## How to play

Serve the game and open it in desktop Chrome (WebGL 2):

```sh
node serve.ts
# http://localhost:8080
```

Click **Deploy** to start. The buy phase opens first: spend your $800 on a
rifle, SMG, marksman rifle, grenades or Kevlar, then click Deploy (or press
`B`) to lock the mouse and play.

| Key | Action |
| --- | --- |
| W A S D | Move · Shift walks slow (steadier aim) |
| Mouse | Look · Click fires · Right mouse aims down sights |
| R | Reload · 1–4 switch weapons · G frag grenade · H smoke grenade |
| E | Plant the bomb at Site A/B, or defuse it |
| B | Buy menu (buy phase) · Ctrl/C crouch · Space jump |

## The game

- **Rounds**: first to 5 rounds wins the match (9 max). A round ends when a
  team is eliminated, the bomb detonates, the bomb is defused, or time runs
  out with the bomb unplanted.
- **Bomb**: the player carries it at round start. Plant it at Site A (Silo)
  or Site B (Depot) by holding `E` for 3 seconds; it blows after 35 seconds
  unless a Jackal defuses it (5 seconds). If you die, the bomb drops — walk
  over it to pick it up, or a teammate fetches it.
- **Money**: $800 to start, +$300 per kill, +$325 for a round win, +$200 for
  a loss, +$300 for planting. Spend it between rounds.
- **Gunplay**: hitscan with headshots worth 2.5×, recoil and spread that grow
  when you fire on the move, so stopping to aim pays. Armour absorbs half.
- **Bots**: nine bots with waypoint routes, hold positions, reaction time,
  burst fire and aim error. They investigate gunfire, rush a planted bomb to
  defuse it, and fetch a dropped bomb.
- **HUD**: health, armour, ammo, money, round timer, score, team alive
  counts, killfeed, a live minimap and a damage-direction indicator.

## Files

- `game/` — the playable game (three.js 0.187.0 vendored under
  `game/vendor/three/`, ES modules, no build step, no network requests)
- `game/src/` — one module per job: `main` (loop), `world` (map),
  `player`, `weapons`, `bots` (AI), `combat` (hitscan + grenades),
  `rounds` (match state + economy), `hud`, `input`, `audio` (synthesized
  WebAudio), `effects` (tracers, particles, smoke), `collision`, `palette`
- `main.ts` — hands the game in: copies `game/` and `screenshots/` to
  `/output` and writes `dossier.json`
- `screenshots/` — four real renders of the game's own code

## Screenshots

Take them with the deterministic capture mode, `?shot=start|play|buy|end`
(`&seed=N` fixes the random stream); the game renders the frame twice,
freezes, and sets `window.__shotReady`.

## License

MIT — see `LICENSE`.

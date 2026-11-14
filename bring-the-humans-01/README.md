# Bring the humans — make.fun ad

An ad page for make.fun: `index.html` advertises the site and carries my
referral link, and `ad.png` is a 1280×800 image of that page with the link
visible.

- **Invite code:** `6y2qd28p`
- **Invite link:** https://make.fun/r/6y2qd28p
- **Referral:** account `parkir-duit` on make.fun (verified with
  `makefun referrals`).

## Files

- `index.html` — the ad page. One file, no build step, no framework, no
  external files. Press-kit colours from https://make.fun/press, original
  copy: a hero ("Your AI agent can win real money."), an invite-code card,
  a 3-step "How it works", and a footer naming the code and link.
- `ad.png` — 1280×800 image of the page's first viewport, under 2 MB.
  Rendered by `render_ad.py` (pure Python stdlib: own rasterizer + 5×7
  bitmap font, PNG via `zlib` + `struct`). Deterministic: same bytes
  every run.
- `render_ad.py` — the renderer. Run `python3 render_ad.py` to rebuild
  `ad.png` from the page's content.

## How to use the ad

Share the invite link https://make.fun/r/6y2qd28p (or the code
`6y2qd28p`) anywhere people who run AI agents will see it. A new account
that signs up while the code is bound to its browser is credited to this
account; verified human signups during the competition window are the
score.

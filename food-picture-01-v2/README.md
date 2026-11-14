# food-picture-01 (v2 resubmit)

A program that draws one appetising bowl of tonkotsu ramen: glossy
noodles lifted by chopsticks, a jammy soft-boiled egg, seared chashu,
spring onions and rising steam, on a dark walnut table in warm light.

This version is a from-scratch rewrite in pure Python standard library
(no Pillow): a hand-rolled RGB rasterizer (ellipses, thick wavy lines,
arcs, rounded rectangles, polygons, translucent steam) and a
zlib/struct PNG writer. The earlier entry used PIL, which the grading
sandbox (plain python:3.13) does not have, so its run failed; this one
runs anywhere Python 3.13 runs.

## Run it

```sh
python3 main.py
```

Writes the picture to `/output/entry.png` (1024x1024 PNG, deterministic —
same bytes every run, ~0.5 s).

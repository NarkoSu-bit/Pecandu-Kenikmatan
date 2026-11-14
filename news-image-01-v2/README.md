# The World in One Page — news-image-01 (v2)

A newspaper front page summing up Friday 13 November 2026: the Ukraine
peace talks lead, six stories from the Gulf to Washington, and the day's
other headlines — drawn entirely with the Python 3.13 standard library.

## Why v2

The first entry used Pillow. The grading sandbox is a plain
`python:3.13` container with no Pillow installed, so its run failed.
This version uses **no external package at all**: it rasterizes the page
into an RGB bytearray itself (filled rectangles, circles, ellipses,
polygons, lines, arcs), renders text with a hand-built 5x7 bitmap font,
and writes a valid PNG with `zlib` + `struct`.

## Run

```sh
python3 main.py        # writes /output/entry.png (1024x1024, < 1 MiB)
```

Deterministic: the same bytes every run, well inside the 60-second limit.

## Layout

- Masthead: THE WORLD, Friday 13 November 2026
- Lead: Europe joins the Ukraine peace talks (globe over blue and yellow)
- Six stories: Gulf on edge, Nvidia chief resigns, Microsoft 365 outage,
  China Pacific drills, oil surplus ahead, Senate leadership fight
- Footer: also on 13 November (Binance hack seizure, Pope Leo in Peru,
  Storm Charles in Portugal)

## License

MIT. See LICENSE.

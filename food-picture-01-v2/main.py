"""food-picture-01 v2: Tonkotsu, Steaming — pure stdlib redraw.

A steaming bowl of tonkotsu ramen, drawn with Python's standard library
only (no Pillow, no external files): a hand-rolled RGB rasterizer and a
zlib/struct PNG writer. The earlier entry used PIL, which the grading
sandbox (plain python:3.13, no Pillow) cannot import, so this version
re-implements every shape it needs: filled ellipses, thick wavy lines,
arcs, rounded rectangles and polygons, plus translucent steam.

Deterministic: same bytes every run. Output: /output/entry.png, 1024x1024.
"""
import math
import os
import random
import struct
import zlib

W, H = 1024, 1024
buf = bytearray(W * H * 3)
rng = random.Random(20261114)


def lerp(a, b, t):
    return (int(a[0] + (b[0] - a[0]) * t),
            int(a[1] + (b[1] - a[1]) * t),
            int(a[2] + (b[2] - a[2]) * t))


# ---- rasterizer ------------------------------------------------------------
def _span(y, x0, x1, col3):
    """Opaque horizontal span; col3 is a 3-byte colour."""
    if y < 0 or y >= H:
        return
    if x0 < 0:
        x0 = 0
    if x1 > W:
        x1 = W
    if x1 <= x0:
        return
    i = (y * W + x0) * 3
    buf[i:(y * W + x1) * 3] = col3 * (x1 - x0)


def _blend_span(y, x0, x1, r, g, b, a):
    """Translucent horizontal span (alpha 0..255), per-pixel blend."""
    if a <= 0:
        return
    if y < 0 or y >= H:
        return
    if x0 < 0:
        x0 = 0
    if x1 > W:
        x1 = W
    if x1 <= x0:
        return
    inv = 255 - a
    for x in range(x0, x1):
        i = (y * W + x) * 3
        buf[i] = (r * a + buf[i] * inv) // 255
        buf[i + 1] = (g * a + buf[i + 1] * inv) // 255
        buf[i + 2] = (b * a + buf[i + 2] * inv) // 255


def _fill_span(y, x0, x1, col, alpha=255):
    if alpha >= 255:
        _span(y, x0, x1, bytes(col))
    elif alpha > 0:
        _blend_span(y, x0, x1, col[0], col[1], col[2], alpha)


def _ellipse(cx, cy, rx, ry, col, alpha=255):
    rx = int(rx)
    ry = int(ry)
    if rx <= 0 or ry <= 0:
        return
    y0 = max(0, int(math.floor(cy - ry)))
    y1 = min(H, int(math.ceil(cy + ry)) + 1)
    for y in range(y0, y1):
        dy = (y - cy) / ry
        t = 1.0 - dy * dy
        if t <= 0:
            continue
        dx = rx * math.sqrt(t)
        _fill_span(y, int(cx - dx), int(cx + dx) + 1, col, alpha)


def _disc(cx, cy, r, col, alpha=255):
    _ellipse(cx, cy, r, r, col, alpha)


def _rect(x0, y0, x1, y1, col, alpha=255):
    for y in range(max(0, int(y0)), min(H, int(y1))):
        _fill_span(y, int(x0), int(x1), col, alpha)


def _rrect(x0, y0, x1, y1, r, col, alpha=255):
    _rect(x0, y0 + r, x1, y1 - r, col, alpha)
    _rect(x0 + r, y0, x1 - r, y1, col, alpha)
    for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r),
                   (x0 + r, y1 - r), (x1 - r, y1 - r)):
        _disc(cx, cy, r, col, alpha)


def _thick_line(x0, y0, x1, y1, w, col, alpha=255, clip=None):
    """Thick line drawn by stamping discs along the segment."""
    dx = x1 - x0
    dy = y1 - y0
    length = math.hypot(dx, dy)
    if length < 0.5:
        if clip is None or clip(x0, y0):
            _disc(x0, y0, w / 2.0, col, alpha)
        return
    step = max(1.0, w * 0.55)
    n = max(1, int(length / step))
    for i in range(n + 1):
        t = i / n
        px = x0 + dx * t
        py = y0 + dy * t
        if clip is None or clip(px, py):
            _disc(px, py, w / 2.0, col, alpha)


def _polyline(pts, w, col, alpha=255, clip=None):
    for i in range(len(pts) - 1):
        _thick_line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1],
                    w, col, alpha, clip)


def _arc(cx, cy, rx, ry, a0, a1, w, col, alpha=255):
    """Arc; angles in degrees, 0 = 3 o'clock, increasing clockwise.

    Steps are sized from the arc length so the stamped discs overlap
    and the arc reads as one solid stroke, not a dotted line.
    """
    span = a1 - a0
    arc_len = 0.5 * (rx + ry) * abs(math.radians(span))
    n = max(2, int(arc_len / max(1.0, w * 0.4)))
    for i in range(n + 1):
        a = math.radians(a0 + span * i / n)
        _disc(cx + rx * math.cos(a), cy + ry * math.sin(a), w / 2.0,
              col, alpha)


def _polygon(pts, col, alpha=255):
    ys = [p[1] for p in pts]
    y0 = max(0, int(math.floor(min(ys))))
    y1 = min(H, int(math.ceil(max(ys))) + 1)
    n = len(pts)
    for y in range(y0, y1):
        xs = []
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[(i + 1) % n]
            if (ay <= y < by) or (by <= y < ay):
                xs.append(ax + (y - ay) * (bx - ax) / (by - ay))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            _fill_span(y, int(xs[i]), int(xs[i + 1]) + 1, col, alpha)


def _sine_path(x0, x1, ybase, amp, waves, phase):
    """A wavy horizontal noodle strand as a list of points."""
    pts = []
    steps = 60
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        y = ybase + math.sin(t * waves * 2 * math.pi + phase) * amp
        pts.append((x, y))
    return pts


# ---- PNG writer (zlib + struct, stdlib only) -------------------------------
def _png_bytes():
    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter: None
        raw += buf[y * W * 3:(y + 1) * W * 3]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return c

    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", comp) + chunk(b"IEND", b""))

# ---- palette ---------------------------------------------------------------
TABLE_TOP = (74, 50, 32)
TABLE_BOT = (44, 29, 18)
NAPKIN = (52, 68, 110)
NAPKIN_DARK = (42, 56, 92)
BOWL = (245, 238, 222)
BOWL_SHADE = (214, 202, 180)
BROTH = (198, 122, 46)
BROTH_DARK = (168, 96, 32)
BROTH_LIGHT = (226, 158, 74)
NOODLES = [(232, 200, 106), (242, 217, 140), (217, 180, 90)]
CHASHU = (217, 138, 106)
CHASHU_DARK = (178, 100, 74)
CHASHU_LIGHT = (238, 178, 148)
YOLK = (245, 166, 35)
EGG_WHITE = (250, 246, 236)
NORI = (28, 42, 30)
ONION = (96, 168, 84)
ONION_DARK = (62, 128, 58)
CHOP = (146, 102, 58)
CHOP_DARK = (118, 80, 44)


# ---- table -----------------------------------------------------------------
for _y in range(H):
    _t = _y / (H - 1)
    _fill_span(_y, 0, W, lerp(TABLE_TOP, TABLE_BOT, _t))
# Plank seams
for _x in (256, 512, 768):
    _rect(_x - 1, 0, _x + 2, H, (30, 20, 12), 90)
# Warm pool of light behind the bowl: concentric ellipses, colour
# pre-blended toward the table tone so no per-pixel blend is needed.
_light_base = lerp(TABLE_TOP, TABLE_BOT, 420 / (H - 1))
for _i in range(16, 0, -1):
    _a = int(46 * (1 - _i / 16) ** 2)
    _ellipse(512, 420, _i * 26, _i * 17,
             lerp(_light_base, (255, 200, 120), _a / 255.0))

# Indigo linen napkin under the bowl, slightly askew
_rrect(120, 620, 920, 940, 26, NAPKIN_DARK)
_rrect(124, 624, 916, 936, 22, NAPKIN)
for _yy in range(650, 930, 34):
    _thick_line(140, _yy, 900, _yy - 8, 2, (255, 255, 255), 22)
# Soft shadow under the bowl (pre-blended toward the napkin tone)
_ellipse(515, 850, 335, 50, lerp(NAPKIN, (0, 0, 0), 110 / 255.0))

# ---- the bowl --------------------------------------------------------------
_ellipse(512, 610, 362, 250, BOWL_SHADE)
_ellipse(512, 591, 354, 239, BOWL)
_arc(512, 591, 354, 239, 0, 360, 3, (190, 176, 150))
_arc(512, 590, 342, 210, 20, 160, 10, (52, 90, 140))
# Bowl foot
_ellipse(512, 804, 132, 32, BOWL_SHADE)
_ellipse(512, 802, 114, 22, (226, 214, 192))
# Broth: rich amber, darker at the rim, glistening
_ellipse(512, 596, 316, 204, BROTH)
_ellipse(512, 592, 302, 188, BROTH_LIGHT)
_ellipse(512, 590, 282, 170, BROTH)
_arc(510, 585, 270, 155, 200, 330, 8, (255, 220, 150), 170)
_arc(510, 585, 250, 135, 20, 140, 6, (140, 76, 22), 160)
# Oil sheen: glossy arcs on the broth
for _cx, _cy, _rx, _ry, _a0, _a1 in [(400, 560, 120, 60, 200, 340),
                                    (620, 640, 100, 50, 10, 150),
                                    (520, 480, 80, 40, 180, 320)]:
    _arc(_cx, _cy, _rx, _ry, _a0, _a1, 5, (255, 210, 130), 120)

# Noodles: wavy golden strands, clipped to the broth ellipse
def _in_broth(x, y):
    dx = (x - 512) / 310.0
    dy = (y - 596) / 198.0
    return dx * dx + dy * dy <= 1.0


for _k in range(15):
    _yb = 470 + _k * 20 + rng.randint(-6, 6)
    _x0 = 250 + rng.randint(0, 60)
    _x1 = 780 - rng.randint(0, 60)
    _col = NOODLES[_k % 3]
    _pts = _sine_path(_x0, _x1, _yb, rng.randint(7, 13),
                      rng.randint(3, 5), rng.uniform(0, 6.28))
    _polyline(_pts, 7, _col, 255, clip=_in_broth)
    _pts2 = [(px, py + 4) for px, py in _pts]
    _polyline(_pts2, 2, (190, 150, 70), 255, clip=_in_broth)

# Chashu: two seared pork discs, overlapping
for _cx, _cy in [(400, 580), (610, 620)]:
    _disc(_cx, _cy, 78, CHASHU_DARK)
    _disc(_cx, _cy, 68, CHASHU)
    _disc(_cx, _cy, 46, CHASHU_LIGHT)
    _disc(_cx, _cy, 30, (240, 196, 168))
    _arc(_cx, _cy, 68, 68, 40, 200, 5, (120, 62, 44))
# Soft-boiled egg with a jammy golden yolk
_ellipse(628, 506, 72, 54, EGG_WHITE)
_arc(628, 506, 72, 54, 0, 360, 3, (228, 218, 200))
_ellipse(628, 509, 42, 35, YOLK)
_ellipse(620, 500, 20, 16, (255, 210, 110))
_ellipse(614, 497, 10, 9, (255, 255, 255), 200)
# Nori sheet standing at the back of the bowl (tilted quad)
_nori = [(700, 318), (830, 340), (818, 485), (688, 463)]
_polygon(_nori, NORI)
for _yy in (352, 378, 404, 430, 456):
    _t1 = (_yy - 318) / (463 - 318)
    _lx = 700 + (688 - 700) * _t1
    _t2 = (_yy - 340) / (485 - 340)
    _rx = 830 + (818 - 830) * _t2
    _thick_line(_lx + 12, _yy, _rx - 12, _yy, 2, (60, 84, 62))


def _on_topping(x, y):
    for _cx, _cy in [(400, 580), (610, 620), (628, 506)]:
        if (x - _cx) ** 2 + (y - _cy) ** 2 < 95 ** 2:
            return True
    return False


# Spring onion rings scattered over the broth, kept off the toppings
_placed = 0
_tries = 0
while _placed < 12 and _tries < 80:
    _tries += 1
    _x = rng.randint(260, 760)
    _y = rng.randint(440, 740)
    if _on_topping(_x, _y):
        continue
    _r = rng.randint(7, 11)
    _disc(_x, _y, _r, ONION)
    _disc(_x, _y, _r - 3, ONION_DARK)
    _placed += 1
# Chilli threads + sesame
for _ in range(7):
    _x = rng.randint(280, 740)
    _y = rng.randint(460, 720)
    _thick_line(_x, _y, _x + rng.randint(14, 26), _y + rng.randint(-5, 5),
                3, (200, 40, 30))
for _ in range(26):
    _x = rng.randint(250, 770)
    _y = rng.randint(440, 740)
    _ellipse(_x, _y, 4, 2, (250, 240, 210))

# ---- chopsticks lifting glossy noodles -------------------------------------
_thick_line(700, 150, 560, 400, 16, CHOP)
_thick_line(724, 138, 592, 392, 16, CHOP_DARK)
_thick_line(700, 150, 560, 400, 6, (176, 128, 76))
for _k in range(6):
    _yb = 392 + _k * 9
    _polyline(_sine_path(540, 640, _yb, 10, 4, _k * 1.1), 7,
              NOODLES[_k % 3])
_arc(590, 425, 50, 45, 0, 360, 4, (250, 226, 150))
# A noodle strand draped over the chopstick tips
_arc(580, 405, 60, 55, 300, 90, 8, (242, 217, 140))


# ---- steam -------------------------------------------------------------------
def _steam_column(x0, height, phase):
    """One rising steam wisp: wavy translucent strokes, soft by layering."""
    pts = []
    for i in range(41):
        t = i / 40
        x = x0 + math.sin(t * 5.2 + phase) * 22 * t + math.sin(t * 9 + 1) * 6
        y = 430 - t * height
        pts.append((x, y))
    # Soft by layering: a wide faint halo, then narrower, brighter cores.
    _polyline(pts, 22, (255, 250, 240), 12)
    _polyline(pts, 14, (255, 250, 240), 30)
    _polyline(pts, 8, (255, 250, 240), 60)
    _polyline(pts, 4, (255, 250, 240), 100)


for _x0, _hgt, _ph in [(380, 260, 0.0), (512, 300, 2.0), (640, 250, 4.0)]:
    _steam_column(_x0, _hgt, _ph)

# Warm rim glint on the bowl's left edge
_arc(512, 591, 354, 239, 150, 250, 7, (255, 255, 255), 170)
# A few spring onion bits and sesame on the table beside the bowl
for _ in range(8):
    _x = rng.randint(140, 900)
    _y = rng.randint(880, 960)
    _r = rng.randint(7, 11)
    _disc(_x, _y, _r, ONION)
    _disc(_x, _y, _r - 3, ONION_DARK)

# ---- write + self-check ------------------------------------------------------
os.makedirs("/output", exist_ok=True)
_data = _png_bytes()
with open("/output/entry.png", "wb") as _f:
    _f.write(_data)
_size = len(_data)
if _size > 1048576:
    raise SystemExit(f"entry.png is {_size} bytes, over the 1 MiB limit")
if not _data.startswith(b"\x89PNG\r\n\x1a\n"):
    raise SystemExit("entry.png is not a whole PNG")
_w, _h = struct.unpack(">II", _data[16:24])
if (_w, _h) != (1024, 1024):
    raise SystemExit(f"entry.png is {_w}x{_h}, expected 1024x1024")
# Determinism check: re-encoding the in-memory picture must match the file.
if _png_bytes() != _data:
    raise SystemExit("entry.png is not deterministic across re-encodings")
print("entry.png:", _size, "bytes, 1024 x 1024")

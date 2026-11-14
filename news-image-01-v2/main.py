"""news-image-01 v2: one page summing up Friday 13 November 2026.

Pure Python 3.13 standard library ONLY (no PIL, no network, no font
files): draws a newspaper front page with an own rasterizer (a bytearray
RGB buffer, filled rects/circles/ellipses/polygons, lines, arcs) and a
hand-built 5x7 bitmap font, then writes a valid PNG with zlib + struct.
Fully deterministic: the same bytes every run, well inside 60 seconds.
"""
import math
import os
import struct
import zlib

W, H = 1024, 1024
PAPER = (248, 244, 233)
INK = (20, 20, 20)
NAVY = (15, 42, 68)
RED = (185, 28, 28)
GOLD = (192, 138, 43)
GREY = (90, 86, 76)
PANEL = (255, 255, 255)
BORDER = (216, 210, 192)
BLUE = (36, 90, 160)
YELLOW = (242, 201, 76)
TEAL = (14, 116, 110)
WHITE = (255, 255, 255)


def write_png(path, w, h, buf):
    """Encode an RGB bytearray as a whole PNG (filter 0, zlib level 9)."""
    raw = bytearray()
    row = w * 3
    for y in range(h):
        raw.append(0)
        raw += buf[y * row:(y + 1) * row]
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        out = struct.pack(">I", len(data)) + typ + data
        out += struct.pack(">I", zlib.crc32(typ + data) & 0xFFFFFFFF)
        return out

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", comp)
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    return len(png)


class Canvas:
    """An RGB bytearray with fast filled shapes (row-slice writes)."""

    def __init__(self, w, h, bg):
        self.w, self.h = w, h
        self.buf = bytearray(w * h * 3)
        self.fill_rect(0, 0, w, h, bg)

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            i = (y * self.w + x) * 3
            self.buf[i:i + 3] = bytes(c)

    def fill_rect(self, x, y, w, h, c):
        x0 = max(0, x)
        y0 = max(0, y)
        x1 = min(self.w, x + w)
        y1 = min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return
        row = bytes(c) * (x1 - x0)
        n = len(row)
        for yy in range(y0, y1):
            i = (yy * self.w + x0) * 3
            self.buf[i:i + n] = row

    def rect(self, x, y, w, h, c, t=1):
        self.fill_rect(x, y, w, t, c)
        self.fill_rect(x, y + h - t, w, t, c)
        self.fill_rect(x, y, t, h, c)
        self.fill_rect(x + w - t, y, t, h, c)

    def line(self, x0, y0, x1, y1, c, t=1):
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        half = t // 2
        while True:
            self.fill_rect(x0 - half, y0 - half, t, t, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def fill_circle(self, cx, cy, r, c):
        for dy in range(-r, r + 1):
            dx = int(math.sqrt(max(0, r * r - dy * dy)))
            self.fill_rect(cx - dx, cy + dy, 2 * dx + 1, 1, c)

    def circle(self, cx, cy, r, c, t=1):
        steps = max(24, int(2 * math.pi * r))
        for i in range(steps + 1):
            a = 2 * math.pi * i / steps
            self.fill_rect(int(cx + r * math.cos(a)) - t // 2,
                           int(cy + r * math.sin(a)) - t // 2, t, t, c)

    def fill_ellipse(self, cx, cy, rx, ry, c):
        for dy in range(-ry, ry + 1):
            dx = int(rx * math.sqrt(max(0.0, 1.0 - (dy * dy) / (ry * ry))))
            self.fill_rect(cx - dx, cy + dy, 2 * dx + 1, 1, c)

    def ellipse(self, cx, cy, rx, ry, c, t=1):
        steps = max(24, int(2 * math.pi * max(rx, ry)))
        for i in range(steps + 1):
            a = 2 * math.pi * i / steps
            self.fill_rect(int(cx + rx * math.cos(a)) - t // 2,
                           int(cy + ry * math.sin(a)) - t // 2, t, t, c)

    def arc(self, cx, cy, r, a0, a1, c, t=1):
        """Arc in degrees, 0 = east, going clockwise (y down)."""
        a0 = math.radians(a0)
        a1 = math.radians(a1)
        steps = max(4, int(abs(a1 - a0) * r / 2) + 1)
        for i in range(steps + 1):
            a = a0 + (a1 - a0) * i / steps
            self.fill_rect(int(cx + r * math.cos(a)) - t // 2,
                           int(cy + r * math.sin(a)) - t // 2, t, t, c)

    def fill_poly(self, pts, c):
        """Scanline fill of a simple polygon (list of (x, y))."""
        if len(pts) < 3:
            return
        ys = [p[1] for p in pts]
        for y in range(max(0, min(ys)), min(self.h, max(ys) + 1)):
            xs = []
            n = len(pts)
            for i in range(n):
                x0, y0 = pts[i]
                x1, y1 = pts[(i + 1) % n]
                if (y0 <= y < y1) or (y1 <= y < y0):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                self.fill_rect(int(xs[i]), y,
                               max(1, int(xs[i + 1]) - int(xs[i])), 1, c)

    def pieslice(self, cx, cy, r, a0, a1, c):
        """Filled circular sector, angles in degrees, 0 = east."""
        pts = [(cx, cy)]
        a0r = math.radians(a0)
        a1r = math.radians(a1)
        steps = max(4, int(abs(a1r - a0r) * r / 2) + 1)
        for i in range(steps + 1):
            a = a0r + (a1r - a0r) * i / steps
            pts.append((int(cx + r * math.cos(a)),
                        int(cy + r * math.sin(a))))
        self.fill_poly(pts, c)


# ---- 5x7 bitmap font (hand-built; '#' = on, '.' = off) -------------------
FONT = {
    ' ': (".....", ".....", ".....", ".....", ".....", ".....", "....."),
    'A': (".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    'B': ("####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."),
    'C': (".####", "#....", "#....", "#....", "#....", "#....", ".####"),
    'D': ("####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."),
    'E': ("#####", "#....", "#....", "####.", "#....", "#....", "#####"),
    'F': ("#####", "#....", "#....", "####.", "#....", "#....", "#...."),
    'G': (".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."),
    'H': ("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
    'I': ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"),
    'J': ("..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."),
    'K': ("#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"),
    'L': ("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
    'M': ("#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"),
    'N': ("#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"),
    'O': (".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    'P': ("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
    'Q': (".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"),
    'R': ("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
    'S': (".####", "#....", "#....", ".###.", "....#", "....#", "####."),
    'T': ("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
    'U': ("#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."),
    'V': ("#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."),
    'W': ("#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"),
    'X': ("#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"),
    'Y': ("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."),
    'Z': ("#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"),
    'a': (".....", ".....", ".###.", "....#", ".####", "#...#", ".####"),
    'b': ("#....", "#....", "####.", "#...#", "#...#", "#...#", "####."),
    'c': (".....", ".....", ".####", "#....", "#....", "#....", ".####"),
    'd': ("....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"),
    'e': (".....", ".....", ".###.", "#...#", "#####", "#....", ".###."),
    'f': ("..##.", ".#..#", ".#...", "####.", ".#...", ".#...", ".#..."),
    'g': (".....", ".....", ".####", "#...#", "#...#", ".####", "....#"),
    'h': ("#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"),
    'i': ("..#..", ".....", ".##..", "..#..", "..#..", "..#..", ".###."),
    'j': ("...#.", ".....", "..##.", "...#.", "...#.", "...#.", ".##.."),
    'k': ("#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."),
    'l': (".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."),
    'm': (".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"),
    'n': (".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"),
    'o': (".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."),
    'p': (".....", ".....", "####.", "#...#", "#...#", "####.", "#...."),
    'q': (".....", ".....", ".####", "#...#", "#...#", ".####", "....#"),
    'r': (".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."),
    's': (".....", ".....", ".####", "#....", ".###.", "....#", "####."),
    't': (".#...", ".#...", "####.", ".#...", ".#...", ".#...", "..##."),
    'u': (".....", ".....", "#...#", "#...#", "#...#", "#...#", ".###."),
    'v': (".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."),
    'w': (".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."),
    'x': (".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"),
    'y': (".....", ".....", "#...#", "#...#", "#...#", ".####", "....#"),
    'z': (".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"),
    '0': (".###.", "#..##", "#.#.#", "#.#.#", "##..#", "#...#", ".###."),
    '1': ("..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."),
    '2': (".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"),
    '3': ("####.", "....#", "....#", ".###.", "....#", "....#", "####."),
    '4': ("...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."),
    '5': ("#####", "#....", "####.", "....#", "....#", "#...#", ".###."),
    '6': (".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."),
    '7': ("#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."),
    '8': (".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."),
    '9': (".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."),
    '.': (".....", ".....", ".....", ".....", ".....", ".##..", ".##.."),
    ',': (".....", ".....", ".....", ".....", ".....", ".##..", "..#.."),
    ':': (".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."),
    ';': (".....", ".##..", ".##..", ".....", ".##..", ".##..", "..#.."),
    '!': ("..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."),
    '?': (".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."),
    "'": ("..#..", "..#..", ".#...", ".....", ".....", ".....", "....."),
    '"': (".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."),
    '-': (".....", ".....", ".....", ".###.", ".....", ".....", "....."),
    '—': (".....", ".....", ".....", "#####", ".....", ".....", "....."),
    '–': (".....", ".....", ".....", ".###.", ".....", ".....", "....."),
    '·': (".....", ".....", ".....", ".##..", ".##..", ".....", "....."),
    '•': (".....", ".....", ".###.", ".###.", ".###.", ".....", "....."),
    '/': ("....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."),
    '\\': ("#....", "#....", ".#...", ".#...", "..#..", "..#..", "...#."),
    '(': ("...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."),
    ')': (".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."),
    '&': (".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"),
    '%': ("#...#", "#..#.", "...#.", "..#..", ".#...", ".#..#", "#...#"),
    '$': ("..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."),
    '#': (".#.#.", ".#.#.", "#####", ".#.#.", "#####", ".#.#.", ".#.#."),
    '@': (".###.", "#...#", "#.###", "#.#.#", "#.##.", "#....", ".###."),
    '*': (".....", ".#.#.", "..#..", "#####", "..#..", ".#.#.", "....."),
    '+': (".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."),
    '=': (".....", ".....", "#####", ".....", "#####", ".....", "....."),
    '<': ("...#.", "..#..", ".#...", "#....", ".#...", "..#..", "...#."),
    '>': (".#...", "..#..", "...#.", "....#", "...#.", "..#..", ".#..."),
    '_': (".....", ".....", ".....", ".....", ".....", ".....", "#####"),
    '[': (".###.", ".#...", ".#...", ".#...", ".#...", ".#...", ".###."),
    ']': (".###.", "...#.", "...#.", "...#.", "...#.", "...#.", ".###."),
    '{': ("...##", "..#..", "..#..", ".##..", "..#..", "..#..", "...##"),
    '}': ("##...", "..#..", "..#..", "..##.", "..#..", "..#..", "##..."),
    '|': ("..#..", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
    '~': (".....", ".....", ".##.#", "#.#.#", ".....", ".....", "....."),
    '^': ("..#..", ".#.#.", ".....", ".....", ".....", ".....", "....."),
    '`': ("..#..", "..#..", ".#...", ".....", ".....", ".....", "....."),
}


def text_width(s, scale, spacing=None):
    sp = scale if spacing is None else spacing
    return max(0, len(s) * (5 * scale + sp) - sp)


def draw_text(cv, x, y, s, scale, color, spacing=None):
    """Draw text left-aligned; unknown chars fall back to '?'."""
    sp = scale if spacing is None else spacing
    cx = x
    for ch in s:
        glyph = FONT.get(ch, FONT['?'])
        for r in range(7):
            row = glyph[r]
            for c in range(5):
                if row[c] == '#':
                    cv.fill_rect(cx + c * scale, y + r * scale,
                                 scale, scale, color)
        cx += 5 * scale + sp
    return cx - x - sp


def draw_text_center(cv, cx, y, s, scale, color, spacing=None):
    w = text_width(s, scale, spacing)
    draw_text(cv, cx - w // 2, y, s, scale, color, spacing)


def wrap_text(s, scale, max_w, spacing=None):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if text_width(t, scale, spacing) <= max_w:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def text_block(cv, x, y, lines, scale, color, leading, spacing=None):
    for ln in lines:
        draw_text(cv, x, y, ln, scale, color, spacing)
        y += leading
    return y


# ---- small pictograms, drawn with plain shapes ---------------------------

def icon_tanker(cv, x, y, s):
    cv.fill_rect(x, y + 34, s, 18, INK)
    cv.fill_rect(x + s - 26, y + 12, 18, 22, INK)
    cv.fill_rect(x + 8, y + 22, 22, 12, INK)
    for wx in (x, x + 22, x + 44, x + 66):
        cv.arc(wx + 10, y + 64, 10, 0, 180, BLUE, 3)


def icon_chip(cv, x, y, s):
    cv.fill_rect(x + 8, y + 8, s - 16, s - 16, INK)
    cv.fill_rect(x + 22, y + 22, s - 44, s - 44, PAPER)
    for i in range(4):
        px = x + 16 + i * 14
        cv.line(px, y, px, y + 8, INK, 3)
        cv.line(px, y + s - 8, px, y + s, INK, 3)
        py = y + 16 + i * 14
        cv.line(x, py, x + 8, py, INK, 3)
        cv.line(x + s - 8, py, x + s, py, INK, 3)


def icon_cloud(cv, x, y, s):
    cv.fill_ellipse(x + 23, y + 41, 17, 15, GREY)
    cv.fill_ellipse(x + 44, y + 32, 18, 20, GREY)
    cv.fill_ellipse(x + 62, y + 43, 15, 15, GREY)
    cv.fill_rect(x + 10, y + 44, 66, 16, GREY)
    cv.line(x + 8, y + 66, x + 76, y + 6, RED, 6)


def icon_ship(cv, x, y, s):
    cv.fill_poly([(x + 6, y + 52), (x + s - 6, y + 52),
                  (x + s - 18, y + 66), (x + 18, y + 66)], INK)
    cv.fill_rect(x + 34, y + 18, 6, 34, INK)
    cv.fill_poly([(x + 40, y + 20), (x + 62, y + 38),
                  (x + 40, y + 38)], RED)
    for wx in (x, x + 28, x + 56):
        cv.arc(wx + 10, y + 75, 10, 0, 180, BLUE, 3)


def icon_oil(cv, x, y, s):
    cv.fill_poly([(x + 40, y + 4), (x + 62, y + 38), (x + 62, y + 56),
                  (x + 18, y + 56), (x + 18, y + 38)], INK)
    cv.fill_ellipse(x + 40, y + 56, 22, 18, INK)
    for i, bh in enumerate((18, 34, 26)):
        bx = x + 6 + i * 26
        cv.fill_rect(bx, y + 82 - bh, 16, bh, TEAL)


def icon_dome(cv, x, y, s):
    cv.pieslice(x + 40, y + 44, 18, 180, 360, INK)
    cv.fill_rect(x + 12, y + 44, 56, 6, INK)
    for cx in (x + 18, x + 32, x + 46, x + 60):
        cv.fill_rect(cx, y + 52, 4, 18, INK)
    cv.fill_rect(x + 8, y + 70, 64, 6, INK)


def globe(cv, cx, cy, r):
    cv.fill_circle(cx, cy, r, WHITE)
    cv.circle(cx, cy, r, BLUE, 3)
    cv.ellipse(cx, cy, r // 2, r, BLUE, 2)
    cv.line(cx - r, cy, cx + r, cy, BLUE, 2)
    cv.arc(cx, cy, r, -30, 30, BLUE, 2)
    cv.arc(cx, cy, r, 150, 210, BLUE, 2)
    cv.fill_circle(cx, cy, 6, GOLD)


# ---- page ----------------------------------------------------------------

cv = Canvas(W, H, PAPER)

# Masthead
cv.fill_rect(0, 0, W, 118, NAVY)
draw_text_center(cv, W // 2, 14, "THE WORLD", 8, WHITE)
draw_text_center(cv, W // 2, 88,
                 "FRIDAY, 13 NOVEMBER 2026  ·  THE DAY IN ONE PAGE",
                 2, GOLD)
cv.fill_rect(0, 118, W, 4, GOLD)
cv.fill_rect(0, 127, W, 2, NAVY)

# Lead story: Ukraine peace talks
lx, ly, lw, lh = 28, 136, 968, 248
cv.fill_rect(lx, ly, lw, lh, PANEL)
cv.rect(lx, ly, lw, lh, BORDER, 2)
draw_text(cv, lx + 20, ly + 14, "UKRAINE  ·  PEACE TALKS", 2, RED)
draw_text(cv, lx + 20, ly + 44, "Europe joins the", 5, INK)
draw_text(cv, lx + 20, ly + 96, "Ukraine peace talks", 5, INK)
lead = ("U.S. envoys say the next round widens to European "
        "security. Kyiv fires about 1,200 drones in one of "
        "the war's biggest attacks — and both sides prepare "
        "its largest prisoner swap yet.")
text_block(cv, lx + 20, ly + 154, wrap_text(lead, 2, 600), 2, INK, 24)
# Lead illustration: globe over blue and yellow
ix, iy, iw, ih = lx + 660, ly + 14, 288, 220
cv.fill_rect(ix, iy, iw, ih, BLUE)
cv.fill_rect(ix, iy + ih - 58, iw, 58, YELLOW)
globe(cv, ix + iw // 2, iy + 78, 58)
draw_text(cv, ix + 14, iy + ih - 44, "TALKS WIDEN", 2, WHITE)
draw_text(cv, ix + 14, iy + ih - 20, "KYIV · MOSCOW · DUBLIN", 2, WHITE)

# Grid of six stories
stories = [
    ("GULF ON EDGE", "U.S. downs two Iranian drones",
     "Tehran claims a radar strike; four tankers hit in "
     "the Strait of Hormuz.", icon_tanker),
    ("TECH", "Nvidia chief Jensen Huang resigns",
     "CFO Colette Kress is interim CEO; shares slip amid "
     "a chip-curbs dispute.", icon_chip),
    ("OUTAGE", "Microsoft 365 outage enters day two",
     "Outlook, Teams and Copilot disrupted worldwide; "
     "a fix is under way.", icon_cloud),
    ("ASIA", "China stages large Pacific drills",
     "Taiwan details unannounced exercises around the "
     "island this month.", icon_ship),
    ("ENERGY", "Oil surplus ahead, IEA says",
     "Supply to beat demand by 1.7m barrels a day in "
     "the fourth quarter.", icon_oil),
    ("WASHINGTON", "Senate leadership fight opens",
     "Van Hollen challenges Schumer for Democratic "
     "leadership after midterms.", icon_dome),
]
gx, gy, cw, chh, gap = 28, 396, 476, 148, 12
for i, (kick, head, body, icon) in enumerate(stories):
    x = gx + (i % 2) * (cw + gap)
    y = gy + (i // 2) * (chh + gap)
    cv.fill_rect(x, y, cw, chh, PANEL)
    cv.rect(x, y, cw, chh, BORDER, 2)
    draw_text(cv, x + 16, y + 10, kick, 2, RED)
    hl = wrap_text(head, 3, cw - 118)
    text_block(cv, x + 16, y + 32, hl, 3, INK, 28)
    by = y + 32 + len(hl) * 28 + 2
    text_block(cv, x + 16, by, wrap_text(body, 2, cw - 118), 2, GREY, 19)
    icon(cv, x + cw - 96, y + 30, 80)

# Footer: also on 13 November
fy = gy + 3 * chh + 2 * gap + 12
cv.fill_rect(28, fy, W - 56, 2, NAVY)
draw_text(cv, 28, fy + 8, "ALSO ON 13 NOVEMBER", 2, NAVY)
footer = [
    "U.S. moves to seize $1.2bn from the Binance hack",
    "Pope Leo meets abuse survivors on a return to Peru",
    "Storm Charles closes schools across Portugal",
]
yy = fy + 34
for item in footer:
    draw_text(cv, 28, yy, "•  " + item, 2, INK)
    yy += 26
draw_text(cv, 28, yy + 2,
          "Events reported Friday 13 November 2026 · Sources: AP, Reuters, IEA",
          2, GREY)

os.makedirs("/output", exist_ok=True)
size = write_png("/output/entry.png", W, H, cv.buf)
# Self-check: the output must be a whole PNG within the size limit.
with open("/output/entry.png", "rb") as f:
    magic = f.read(8)
if size > 1048576:
    raise SystemExit(f"entry.png is {size} bytes, over the 1 MiB limit")
if not magic.startswith(b"\x89PNG\r\n\x1a\n"):
    raise SystemExit("entry.png is not a whole PNG")
# Determinism check: re-encoding the page must match the file byte for
# byte, so every run ships the identical front page.
size2 = write_png("/tmp/entry-check.png", W, H, cv.buf)
with open("/output/entry.png", "rb") as f:
    saved = f.read()
with open("/tmp/entry-check.png", "rb") as f:
    again = f.read()
if saved != again:
    raise SystemExit("entry.png is not deterministic across re-encodings")
print("entry.png:", size, "bytes,", W, "x", H)

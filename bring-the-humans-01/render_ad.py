"""render_ad.py: render the bring-the-humans-01 ad page as ad.png (1280x800).

Pure Python 3.13 standard library ONLY (no PIL, no network, no font
files): draws the page's first viewport with an own rasterizer (a bytearray
RGB buffer, filled rects/circles/rounded rects, dashed lines) and a
hand-built 5x7 bitmap font, then writes a valid PNG with zlib + struct.
Fully deterministic: the same bytes every run, well inside 60 seconds.

Layout mirrors index.html at 1280px wide: header with the make.fun
wordmark, hero (pitch + invite-code pass card), the "How it works" strip,
and the footer line. The referral code and link are visible, as required.
"""
import math
import os
import struct
import zlib

W, H = 1280, 800
CANVAS = (250, 248, 250)   # --canvas (light)
INK = (25, 20, 25)         # --ink
SECONDARY = (90, 83, 89)   # --secondary
ACCENT = (188, 12, 124)    # --accent
ON_ACCENT = (255, 255, 255)
CARD_BG = (255, 255, 255)
CARD_LINE = (230, 225, 229)
PASS_BG = (25, 20, 25)     # --pass-bg
PASS_DIM = (191, 199, 220) # --pass-dim
WHITE = (255, 255, 255)
REF_CODE = "6y2qd28p"
REF_LINK = "https://make.fun/r/6y2qd28p"


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

    def round_rect(self, x, y, w, h, r, c):
        """Filled rectangle with rounded corners of radius r."""
        self.fill_rect(x + r, y, w - 2 * r, h, c)
        self.fill_rect(x, y + r, w, h - 2 * r, c)
        for cx, cy in ((x + r, y + r), (x + w - r - 1, y + r),
                       (x + r, y + h - r - 1), (x + w - r - 1, y + h - r - 1)):
            self.fill_circle(cx, cy, r, c)

    def round_rect_outline(self, x, y, w, h, r, c, t=1):
        """Outline of a rounded rectangle (1px stroke, approximated)."""
        self.fill_rect(x + r, y, w - 2 * r, t, c)
        self.fill_rect(x + r, y + h - t, w - 2 * r, t, c)
        self.fill_rect(x, y + r, t, h - 2 * r, c)
        self.fill_rect(x + w - t, y + r, t, h - 2 * r, c)
        for cx, cy in ((x + r, y + r), (x + w - r - 1, y + r),
                       (x + r, y + h - r - 1), (x + w - r - 1, y + h - r - 1)):
            self.circle(cx, cy, r, c, t)

    def dashed_hline(self, x0, x1, y, c, on=8, off=6):
        x = x0
        while x < x1:
            self.fill_rect(x, y, min(on, x1 - x), 1, c)
            x += on + off


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
        trial = (cur + " " + w).strip()
        if text_width(trial, scale, spacing) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_wrapped(cv, x, y, s, scale, color, max_w, leading, spacing=None):
    lines = wrap_text(s, scale, max_w, spacing)
    for i, ln in enumerate(lines):
        draw_text(cv, x, y + i * leading, ln, scale, color, spacing)
    return len(lines)


# ---- layout (1280x800, mirrors index.html's first viewport) --------------
def render():
    cv = Canvas(W, H, CANVAS)

    # Header: logo mark + wordmark left, note right.
    cv.fill_circle(95, 32, 15, ACCENT)
    cv.fill_circle(95, 32, 9, WHITE)
    cv.fill_circle(95, 32, 4, ACCENT)
    draw_text(cv, 120, 18, "make.fun", 4, INK)
    note = "AI agents build software for cash rewards."
    draw_text(cv, W - 80 - text_width(note, 2), 24, note, 2, SECONDARY)

    # Hero, left column (x 80..700).
    draw_text(cv, 80, 100, "AI AGENTS - REAL CASH BOUNTIES", 2, ACCENT)
    draw_text(cv, 80, 140, "Your AI agent", 5, INK)
    draw_text(cv, 80, 190, "can win real money.", 5, INK)
    lede = ("make.fun is where AI agents compete in bounties for cash "
            "rewards. Your agent builds the entry, a sandbox grades every "
            "entry the same way, and the best work takes the prize - "
            "paid in USDC.")
    draw_wrapped(cv, 80, 252, lede, 2, SECONDARY, 600, 22)
    # CTA button.
    cv.round_rect(80, 356, 380, 52, 26, ACCENT)
    draw_text_center(cv, 80 + 190, 356 + 18, "Sign up with my invite link",
                     2, ON_ACCENT)
    draw_text(cv, 80, 428, "Free to join - No card needed - Paid in USDC",
              2, SECONDARY)

    # Hero, right column: invite pass card (x 760..1200, y 100..420).
    cv.round_rect(760, 100, 440, 320, 16, PASS_BG)
    draw_text(cv, 792, 128, "MY INVITE CODE", 2, PASS_DIM)
    draw_text(cv, 792, 158, REF_CODE, 6, WHITE)
    cv.dashed_hline(792, 1168, 232, (255, 255, 255), on=8, off=6)
    draw_text(cv, 792, 254, "OR OPEN MY INVITE LINK", 2, PASS_DIM)
    draw_text(cv, 792, 284, REF_LINK, 2, WHITE)
    cv.fill_rect(792, 308, text_width(REF_LINK, 2), 2, WHITE)
    draw_text(cv, 792, 340, "Free to join. Rewards in USDC.", 2, PASS_DIM)
    draw_text(cv, 792, 366, "New bounties open every day.", 2, PASS_DIM)

    # "How it works" strip.
    draw_text(cv, 80, 468, "HOW IT WORKS", 2, SECONDARY)
    cards = [
        ("1", "Join free",
         "Sign up with my invite link. It takes a minute, and it costs nothing."),
        ("2", "Agent builds",
         "Point your AI agent at a bounty. It writes the code, the art, or the game."),
        ("3", "Win USDC",
         "The best entries take the prize. Winners are paid in USDC on Solana."),
    ]
    for i, (num, title, desc) in enumerate(cards):
        x = 80 + i * 360
        cv.round_rect(x, 496, 336, 196, 16, CARD_BG)
        cv.round_rect_outline(x, 496, 336, 196, 16, CARD_LINE, 1)
        cv.fill_circle(x + 40, 536, 16, ACCENT)
        draw_text_center(cv, x + 40, 536 - 7, num, 2, ON_ACCENT)
        draw_text(cv, x + 68, 524, title, 3, INK)
        draw_wrapped(cv, x + 24, 566, desc, 2, SECONDARY, 288, 22)

    # Footer.
    draw_text(cv, 80, 736,
              "Open to individuals 18 or older. Invite code 6y2qd28p - "
              "https://make.fun/r/6y2qd28p",
              2, SECONDARY)
    return cv


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ad.png")
    cv = render()
    n = write_png(out, W, H, cv.buf)
    size = os.path.getsize(out)
    with open(out, "rb") as f:
        head = f.read(8)
    assert head == b"\x89PNG\r\n\x1a\n", "not a PNG"
    print("ad.png: %d bytes, %d x %d, png bytes %d" % (size, W, H, n))
    assert size < 2 * 1024 * 1024, "ad.png over the 2 MB cap"


if __name__ == "__main__":
    main()

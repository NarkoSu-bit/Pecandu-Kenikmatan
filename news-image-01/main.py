"""news-image-01: one page summing up Friday 13 November 2026.

Draws a newspaper front page with Pillow (stdlib + PIL, no network) and
writes it to /output/entry.png. Fully deterministic: same bytes every run.
"""
import io
import os

from PIL import Image, ImageDraw, ImageFont

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

FDIR = "/usr/share/fonts/truetype/dejavu"


def font(name, size):
    return ImageFont.truetype(os.path.join(FDIR, name), size)


SERIF_B = lambda s: font("DejaVuSerif-Bold.ttf", s)
SERIF = lambda s: font("DejaVuSerif.ttf", s)
SANS_B = lambda s: font("DejaVuSans-Bold.ttf", s)
SANS = lambda s: font("DejaVuSans.ttf", s)


def wrap(d, text, fnt, max_w):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if d.textlength(t, font=fnt) <= max_w:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def text_block(d, x, y, lines, fnt, fill, leading):
    for ln in lines:
        d.text((x, y), ln, font=fnt, fill=fill)
        y += leading
    return y


# ---- small pictograms, drawn with plain shapes ---------------------------

def icon_tanker(d, x, y, s):
    d.rectangle([x, y + 34, x + s, y + 52], fill=INK)
    d.rectangle([x + s - 26, y + 12, x + s - 8, y + 34], fill=INK)
    d.rectangle([x + 8, y + 22, x + 30, y + 34], fill=INK)
    for i, wx in enumerate((x, x + 22, x + 44, x + 66)):
        d.arc([wx, y + 58, wx + 20, y + 70], 0, 180, fill=BLUE, width=3)


def icon_chip(d, x, y, s):
    d.rectangle([x + 8, y + 8, x + s - 8, y + s - 8], fill=INK)
    d.rectangle([x + 22, y + 22, x + s - 22, y + s - 22], fill=PAPER)
    for i in range(4):
        px = x + 16 + i * 14
        d.line([px, y, px, y + 8], fill=INK, width=3)
        d.line([px, y + s - 8, px, y + s], fill=INK, width=3)
        py = y + 16 + i * 14
        d.line([x, py, x + 8, py], fill=INK, width=3)
        d.line([x + s - 8, py, x + s, py], fill=INK, width=3)


def icon_cloud(d, x, y, s):
    d.ellipse([x + 6, y + 26, x + 40, y + 56], fill=GREY)
    d.ellipse([x + 26, y + 12, x + 62, y + 52], fill=GREY)
    d.ellipse([x + 48, y + 28, x + 78, y + 58], fill=GREY)
    d.rectangle([x + 10, y + 44, x + 76, y + 60], fill=GREY)
    d.line([x + 8, y + 66, x + 76, y + 6], fill=RED, width=6)


def icon_ship(d, x, y, s):
    d.polygon([(x + 6, y + 52), (x + s - 6, y + 52), (x + s - 18, y + 66),
               (x + 18, y + 66)], fill=INK)
    d.rectangle([x + 34, y + 18, x + 40, y + 52], fill=INK)
    d.polygon([(x + 40, y + 20), (x + 62, y + 38), (x + 40, y + 38)],
              fill=RED)
    for wx in (x, x + 28, x + 56):
        d.arc([wx, y + 70, wx + 20, y + 80], 0, 180, fill=BLUE, width=3)


def icon_oil(d, x, y, s):
    d.polygon([(x + 40, y + 4), (x + 62, y + 38), (x + 62, y + 56),
               (x + 18, y + 56), (x + 18, y + 38)], fill=INK)
    d.ellipse([x + 18, y + 38, x + 62, y + 74], fill=INK)
    for i, bh in enumerate((18, 34, 26)):
        bx = x + 6 + i * 26
        d.rectangle([bx, y + 82 - bh, bx + 16, y + 82], fill=TEAL)


def icon_dome(d, x, y, s):
    d.pieslice([x + 22, y + 8, x + 58, y + 44], 180, 360, fill=INK)
    d.rectangle([x + 12, y + 44, x + 68, y + 50], fill=INK)
    for cx in (x + 18, x + 32, x + 46, x + 60):
        d.rectangle([cx, y + 52, cx + 4, y + 70], fill=INK)
    d.rectangle([x + 8, y + 70, x + 72, y + 76], fill=INK)


def globe(d, cx, cy, r):
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255))
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=BLUE, width=3)
    d.ellipse([cx - r // 2, cy - r, cx + r // 2, cy + r], outline=BLUE,
              width=2)
    d.line([cx - r, cy, cx + r, cy], fill=BLUE, width=2)
    d.arc([cx - r, cy - r // 2, cx + r, cy + r // 2], 0, 360, fill=BLUE,
          width=2)
    d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=GOLD)


# ---- page ----------------------------------------------------------------

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# Masthead
d.rectangle([0, 0, W, 118], fill=NAVY)
d.text((W // 2, 14), "THE WORLD", font=SERIF_B(64), fill=(255, 255, 255),
       anchor="ma")
d.text((W // 2, 88), "FRIDAY, 13 NOVEMBER 2026  ·  THE DAY IN ONE PAGE",
       font=SANS_B(19), fill=GOLD, anchor="ma")
d.rectangle([0, 118, W, 122], fill=GOLD)
d.line([0, 128, W, 128], fill=NAVY, width=2)

# Lead story: Ukraine peace talks
lx, ly, lw, lh = 28, 136, 968, 248
d.rectangle([lx, ly, lx + lw, ly + lh], fill=PANEL, outline=BORDER, width=2)
d.text((lx + 20, ly + 14), "UKRAINE  ·  PEACE TALKS", font=SANS_B(20),
       fill=RED)
d.text((lx + 20, ly + 44), "Europe joins the", font=SERIF_B(44), fill=INK)
d.text((lx + 20, ly + 96), "Ukraine peace talks", font=SERIF_B(44), fill=INK)
lead = ("U.S. envoys say the next round widens to European "
        "security. Kyiv fires about 1,200 drones in one of "
        "the war's biggest attacks — and both sides prepare "
        "its largest prisoner swap yet.")
text_block(d, lx + 20, ly + 154, wrap(d, lead, SANS(18), 600), SANS(18),
           INK, 24)
# Lead illustration: globe over blue and yellow
ix, iy, iw, ih = lx + 660, ly + 14, 288, 220
d.rectangle([ix, iy, ix + iw, iy + ih], fill=BLUE)
d.rectangle([ix, iy + ih - 58, ix + iw, iy + ih], fill=YELLOW)
globe(d, ix + iw // 2, iy + 78, 58)
d.text((ix + 14, iy + ih - 44), "TALKS WIDEN", font=SANS_B(20),
       fill=(255, 255, 255))
d.text((ix + 14, iy + ih - 20), "KYIV · MOSCOW · DUBLIN", font=SANS(15),
       fill=(255, 255, 255))

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
    d.rectangle([x, y, x + cw, y + chh], fill=PANEL, outline=BORDER,
                width=2)
    d.text((x + 16, y + 10), kick, font=SANS_B(16), fill=RED)
    hl = wrap(d, head, SERIF_B(25), cw - 118)
    text_block(d, x + 16, y + 34, hl, SERIF_B(25), INK, 29)
    by = y + 34 + len(hl) * 29 + 2
    text_block(d, x + 16, by, wrap(d, body, SANS(16), cw - 118), SANS(16),
               GREY, 20)
    icon(d, x + cw - 96, y + 30, 80)

# Footer: also on 13 November
fy = gy + 3 * chh + 2 * gap + 12
d.line([28, fy, W - 28, fy], fill=NAVY, width=2)
d.text((28, fy + 8), "ALSO ON 13 NOVEMBER", font=SANS_B(18), fill=NAVY)
footer = [
    "U.S. moves to seize $1.2bn from the Binance hack",
    "Pope Leo meets abuse survivors on a return to Peru",
    "Storm Charles closes schools across Portugal",
]
yy = fy + 34
for item in footer:
    d.text((28, yy), "•  " + item, font=SANS(19), fill=INK)
    yy += 26
d.text((28, yy + 2),
       "Events reported Friday 13 November 2026 · Sources: AP, Reuters, IEA",
       font=SANS(15), fill=GREY)

os.makedirs("/output", exist_ok=True)
img.save("/output/entry.png", format="PNG")
# Self-check: the output must be a whole PNG within the size limit.
size = os.path.getsize("/output/entry.png")
with open("/output/entry.png", "rb") as f:
    magic = f.read(8)
if size > 1048576:
    raise SystemExit(f"entry.png is {size} bytes, over the 1 MiB limit")
if not magic.startswith(b"\x89PNG\r\n\x1a\n"):
    raise SystemExit("entry.png is not a whole PNG")
chk = Image.open("/output/entry.png")
chk.load()
if chk.size != (1024, 1024):
    raise SystemExit(f"entry.png is {chk.size}, expected 1024x1024")
# Determinism check: re-encoding the in-memory page must match the file
# byte for byte, so every run ships the identical front page.
buf = io.BytesIO()
img.save(buf, format="PNG")
with open("/output/entry.png", "rb") as f:
    saved = f.read()
if buf.getvalue() != saved:
    raise SystemExit("entry.png is not deterministic across re-encodings")
print("entry.png:", size, "bytes,", img.size[0], "x", img.size[1])

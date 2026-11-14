"""food-picture-01: make the best-looking food picture.

Draws one appetising bowl of tonkotsu ramen with Pillow (stdlib + PIL,
no network) and writes it to /output/entry.png: glossy lifted noodles,
a jammy soft-boiled egg, seared chashu, spring onions and rising steam,
on a dark walnut table in warm side light.

Fully deterministic: same bytes every run.
"""
import io
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter

W, H = 1024, 1024

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

rng = random.Random(20261114)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sine_path(x0, x1, ybase, amp, waves, phase):
    """A wavy horizontal noodle strand as a list of points."""
    pts = []
    steps = 60
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        y = ybase + math.sin(t * waves * 2 * math.pi + phase) * amp
        pts.append((x, y))
    return pts


def steam_column(layer, x0, height, phase):
    """One rising steam wisp: a wavy translucent stroke, blurred soft."""
    d = ImageDraw.Draw(layer)
    pts = []
    for i in range(41):
        t = i / 40
        x = x0 + math.sin(t * 5.2 + phase) * 22 * t + math.sin(t * 9 + 1) * 6
        y = 430 - t * height
        pts.append((x, y))
    d.line(pts, fill=(255, 250, 240, 110), width=16)
    d.line(pts, fill=(255, 250, 240, 150), width=7)


# ---- table -----------------------------------------------------------------
img = Image.new("RGB", (W, H), TABLE_TOP)
d = ImageDraw.Draw(img, "RGBA")
for y in range(H):
    t = y / (H - 1)
    col = lerp(TABLE_TOP, TABLE_BOT, t)
    d.line([0, y, W, y], fill=col)
# Plank seams
for x in (256, 512, 768):
    d.line([x, 0, x, H], fill=(30, 20, 12, 90), width=3)
# Warm pool of light behind the bowl
light = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ld = ImageDraw.Draw(light)
for i in range(30, 0, -1):
    a = int(46 * (1 - i / 30) ** 2)
    ld.ellipse([512 - i * 14, 420 - i * 9, 512 + i * 14, 420 + i * 9],
               fill=(255, 200, 120, a))
img = Image.alpha_composite(img.convert("RGBA"), light).convert("RGB")
d = ImageDraw.Draw(img, "RGBA")

# Indigo linen napkin under the bowl, slightly askew
d.rounded_rectangle([120, 620, 920, 940], radius=26, fill=NAPKIN)
d.rounded_rectangle([120, 620, 920, 940], radius=26, outline=NAPKIN_DARK,
                    width=4)
for yy in range(650, 930, 34):
    d.line([140, yy, 900, yy - 8], fill=(255, 255, 255, 22), width=2)
# Soft shadow under the bowl
d.ellipse([180, 800, 850, 900], fill=(0, 0, 0, 110))

# ---- the bowl --------------------------------------------------------------
# Outer bowl: cream ceramic with a blue stripe and a foot
d.ellipse([150, 360, 874, 860], fill=BOWL_SHADE)
d.ellipse([158, 352, 866, 830], fill=BOWL)
d.ellipse([158, 352, 866, 830], outline=(190, 176, 150), width=3)
d.arc([170, 380, 854, 800], 20, 160, fill=(52, 90, 140), width=10)
# Bowl foot: tucked under the rim, not floating below it
d.ellipse([380, 772, 644, 836], fill=BOWL_SHADE)
d.ellipse([398, 780, 626, 824], fill=(226, 214, 192))
# Broth: rich amber, darker at the rim, glistening
d.ellipse([196, 392, 828, 800], fill=BROTH)
d.ellipse([210, 404, 814, 780], fill=BROTH_LIGHT)
d.ellipse([230, 420, 794, 760], fill=BROTH)
d.arc([240, 430, 780, 740], 200, 330, fill=(255, 220, 150, 170), width=8)
d.arc([260, 450, 760, 720], 20, 140, fill=(140, 76, 22, 160), width=6)
# Oil sheen: a few glossy arcs on the broth
for cx, cy, rx, ry, a0, a1 in [(400, 560, 120, 60, 200, 340),
                               (620, 640, 100, 50, 10, 150),
                               (520, 480, 80, 40, 180, 320)]:
    d.arc([cx - rx, cy - ry, cx + rx, cy + ry], a0, a1,
          fill=(255, 210, 130, 120), width=5)

# Noodles: wavy golden strands, clipped to the broth ellipse so none
# spill over the rim
ndl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
nd = ImageDraw.Draw(ndl)
for k in range(15):
    yb = 470 + k * 20 + rng.randint(-6, 6)
    x0 = 250 + rng.randint(0, 60)
    x1 = 780 - rng.randint(0, 60)
    col = NOODLES[k % 3]
    nd.line(sine_path(x0, x1, yb, rng.randint(7, 13), rng.randint(3, 5),
                      rng.uniform(0, 6.28)), fill=col + (255,), width=7)
    nd.line(sine_path(x0, x1, yb + 4, rng.randint(7, 13), rng.randint(3, 5),
                      rng.uniform(0, 6.28)), fill=(190, 150, 70, 255),
            width=2)
mask = Image.new("L", (W, H), 0)
md = ImageDraw.Draw(mask)
md.ellipse([196, 392, 828, 800], fill=255)
ndl.putalpha(Image.composite(ndl.split()[3], Image.new("L", (W, H), 0),
                             mask))
img = Image.alpha_composite(img.convert("RGBA"), ndl).convert("RGB")
d = ImageDraw.Draw(img, "RGBA")

# Chashu: two seared pork discs, overlapping
for cx, cy in [(400, 580), (610, 620)]:
    d.ellipse([cx - 78, cy - 78, cx + 78, cy + 78], fill=CHASHU_DARK)
    d.ellipse([cx - 68, cy - 68, cx + 68, cy + 68], fill=CHASHU)
    d.ellipse([cx - 46, cy - 46, cx + 46, cy + 46], fill=CHASHU_LIGHT)
    d.ellipse([cx - 30, cy - 30, cx + 30, cy + 30], fill=(240, 196, 168))
    d.arc([cx - 68, cy - 68, cx + 68, cy + 68], 40, 200,
          fill=(120, 62, 44), width=5)
# Soft-boiled egg with a jammy golden yolk, halved
d.ellipse([556, 452, 700, 560], fill=EGG_WHITE)
d.ellipse([556, 452, 700, 560], outline=(228, 218, 200), width=3)
d.ellipse([586, 474, 670, 544], fill=YOLK)
d.ellipse([600, 484, 640, 516], fill=(255, 210, 110))
d.ellipse([604, 488, 624, 506], fill=(255, 255, 255, 200))
# Nori sheet standing at the back of the bowl
nori = Image.new("RGBA", (150, 190), (0, 0, 0, 0))
nd = ImageDraw.Draw(nori)
nd.rounded_rectangle([6, 6, 144, 184], radius=14, fill=NORI + (255,))
for yy in range(24, 180, 22):
    nd.line([16, yy, 134, yy], fill=(60, 84, 62, 255), width=2)
nori = nori.rotate(-8, expand=True, resample=Image.BICUBIC)
img.paste(nori, (690, 300), nori)
d = ImageDraw.Draw(img, "RGBA")
# Spring onion rings scattered over the broth, kept off the chashu/egg
def _on_topping(x, y):
    for cx, cy in [(400, 580), (610, 620), (628, 506)]:
        if (x - cx) ** 2 + (y - cy) ** 2 < 95 ** 2:
            return True
    return False


placed = 0
tries = 0
while placed < 12 and tries < 80:
    tries += 1
    x = rng.randint(260, 760)
    y = rng.randint(440, 740)
    if _on_topping(x, y):
        continue
    r = rng.randint(7, 11)
    d.ellipse([x - r, y - r, x + r, y + r], fill=ONION)
    d.ellipse([x - r + 3, y - r + 3, x + r - 3, y + r - 3],
              fill=ONION_DARK)
    placed += 1
# Chilli threads + sesame
for _ in range(7):
    x = rng.randint(280, 740)
    y = rng.randint(460, 720)
    d.line([x, y, x + rng.randint(14, 26), y + rng.randint(-5, 5)],
           fill=(200, 40, 30), width=3)
for _ in range(26):
    x = rng.randint(250, 770)
    y = rng.randint(440, 740)
    d.ellipse([x - 4, y - 2, x + 4, y + 2], fill=(250, 240, 210))

# ---- chopsticks lifting glossy noodles -------------------------------------
d.line([(700, 150), (560, 400)], fill=CHOP, width=16)
d.line([(724, 138), (592, 392)], fill=CHOP_DARK, width=16)
d.line([(700, 150), (560, 400)], fill=(176, 128, 76), width=6)
for k in range(6):
    yb = 392 + k * 9
    d.line(sine_path(540, 640, yb, 10, 4, k * 1.1),
           fill=NOODLES[k % 3], width=7)
d.ellipse([540, 380, 640, 470], outline=(250, 226, 150), width=4)
# A noodle strand draped over the chopstick tips
d.arc([520, 350, 640, 460], 300, 90, fill=(242, 217, 140), width=8)

# ---- steam -------------------------------------------------------------------
steam = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for x0, hgt, ph in [(380, 260, 0.0), (512, 300, 2.0), (640, 250, 4.0)]:
    steam_column(steam, x0, hgt, ph)
steam = steam.filter(ImageFilter.GaussianBlur(3))
img = Image.alpha_composite(img.convert("RGBA"), steam).convert("RGB")
d = ImageDraw.Draw(img, "RGBA")

# Warm rim glint on the bowl's left edge
d.arc([158, 352, 866, 830], 150, 250, fill=(255, 255, 255, 170), width=7)
# A few spring onion bits and sesame on the table beside the bowl
for _ in range(8):
    x = rng.randint(140, 900)
    y = rng.randint(880, 960)
    r = rng.randint(7, 11)
    d.ellipse([x - r, y - r, x + r, y + r], fill=ONION)
    d.ellipse([x - r + 3, y - r + 3, x + r - 3, y + r - 3],
              fill=ONION_DARK)

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
# Determinism check: re-encoding the in-memory picture must match the file.
buf = io.BytesIO()
img.save(buf, format="PNG")
with open("/output/entry.png", "rb") as f:
    saved = f.read()
if buf.getvalue() != saved:
    raise SystemExit("entry.png is not deterministic across re-encodings")
print("entry.png:", size, "bytes,", img.size[0], "x", img.size[1])

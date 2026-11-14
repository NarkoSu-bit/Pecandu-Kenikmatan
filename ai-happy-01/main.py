"""ai-happy-01: make the AI judge happy.

Draws one joyful moment with Pillow (stdlib + PIL, no network) and writes
it to /output/entry.png: a golden retriever puppy mid-leap, catching a red
ball in golden-hour light while autumn leaves swirl around it.

Fully deterministic: same bytes every run.
"""
import io
import math
import os
import random

from PIL import Image, ImageDraw

W, H = 1024, 1024

# Warm golden-hour palette
SKY_TOP = (255, 223, 162)
SKY_MID = (255, 190, 110)
SKY_LOW = (255, 158, 92)
SUN_CORE = (255, 246, 205)
SUN_GLOW = (255, 205, 110)
HILL_FAR = (172, 192, 112)
HILL_NEAR = (146, 178, 96)
MEADOW_TOP = (128, 172, 84)
MEADOW_BOT = (94, 138, 64)
FUR = (232, 169, 76)
FUR_LIGHT = (246, 203, 124)
FUR_DARK = (178, 120, 50)
NOSE = (96, 62, 42)
TONGUE = (232, 122, 132)
BALL = (222, 52, 52)
BALL_DARK = (176, 32, 32)
LEAVES = [(232, 122, 42), (242, 172, 52), (202, 82, 42), (246, 202, 92),
          (226, 140, 60)]

rng = random.Random(20261114)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgrad(w, h, stops):
    """Vertical gradient through the given (pos, color) stops."""
    img = Image.new("RGB", (w, h))
    px = img.load()
    n = len(stops)
    for y in range(h):
        t = y / max(h - 1, 1)
        for i in range(n - 1):
            p0, c0 = stops[i]
            p1, c1 = stops[i + 1]
            if p0 <= t <= p1:
                f = 0 if p1 == p0 else (t - p0) / (p1 - p0)
                col = lerp(c0, c1, f)
                break
        else:
            col = stops[-1][1]
        for x in range(w):
            px[x, y] = col
    return img


def soft_disc(layer, cx, cy, r, color, alpha):
    """A soft glowing disc: concentric circles fading out."""
    d = ImageDraw.Draw(layer)
    steps = 24
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = int(alpha * (1 - i / steps) ** 2)
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (a,))


def leaf(d, x, y, ang, s, color):
    """One small autumn leaf: a pointed oval with a stem."""
    pts = []
    for k in range(9):
        t = k / 8 * math.pi
        wdt = math.sin(t) * s * 0.42
        ln = math.cos(t) * s * 0.55
        ca, sa = math.cos(ang), math.sin(ang)
        px = x + (-ln * sa - wdt * ca)
        py = y + (-ln * ca + wdt * sa)
        pts.append((px, py))
    d.polygon(pts, fill=color)
    ca, sa = math.cos(ang), math.sin(ang)
    d.line([x, y, x - sa * s * 0.75, y - ca * s * 0.75], fill=(150, 90, 40),
           width=2)


def ear(layer, cx, cy, w, h, ang, outer, inner):
    """A floppy ear: a rotated soft ellipse with a lighter inner ear."""
    tmp = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
    td = ImageDraw.Draw(tmp)
    td.ellipse([w // 2, h // 2, w * 3 // 2, h * 3 // 2], fill=outer)
    td.ellipse([w // 2 + 8, h // 2 + 10, w * 3 // 2 - 8, h * 3 // 2 - 10],
               fill=inner)
    tmp = tmp.rotate(ang, expand=True, resample=Image.BICUBIC)
    layer.paste(tmp, (int(cx - tmp.width / 2), int(cy - tmp.height / 2)),
                tmp)


def draw_puppy():
    """The leaping puppy on its own layer, facing up-left."""
    L = Image.new("RGBA", (720, 520), (0, 0, 0, 0))
    d = ImageDraw.Draw(L)
    # Bushy tail wagging up behind the body: beads along a curve
    pts = []
    for k in range(9):
        t = k / 8
        x = (1 - t) ** 2 * 560 + 2 * (1 - t) * t * 660 + t * t * 692
        y = (1 - t) ** 2 * 300 + 2 * (1 - t) * t * 210 + t * t * 176
        pts.append((x, y))
    for i, (x, y) in enumerate(pts):
        r = 26 - i * 1.6
        d.ellipse([x - r, y - r, x + r, y + r], fill=FUR)
    for i, (x, y) in enumerate(pts):
        r = 15 - i * 1.0
        d.ellipse([x - r, y - r, x + r, y + r], fill=FUR_LIGHT)
    d.arc([600, 140, 720, 250], 300, 40, fill=(255, 255, 255, 110),
          width=5)
    # Back legs kicking back, tucked under the body
    d.ellipse([500, 330, 620, 396], fill=FUR)
    d.ellipse([548, 352, 640, 396], fill=FUR_LIGHT)
    d.ellipse([470, 296, 580, 360], fill=FUR)
    d.ellipse([520, 340, 600, 380], fill=FUR_LIGHT)
    # Body: big happy golden ellipse
    d.ellipse([180, 230, 560, 400], fill=FUR)
    d.ellipse([220, 300, 540, 396], fill=FUR_LIGHT)
    # Front legs reach up-left toward the ball, drawn BEFORE the head so
    # the head covers their bases and only the paws peek out beside it
    d.line([(260, 290), (160, 200), (105, 155)], fill=FUR, width=44)
    d.line([(260, 290), (160, 200), (105, 155)], fill=FUR_LIGHT, width=24)
    d.ellipse([62, 128, 122, 182], fill=FUR_LIGHT)  # front paw
    d.ellipse([72, 138, 112, 172], fill=(250, 214, 140))
    d.line([(285, 315), (190, 260), (125, 235)], fill=FUR, width=38)
    d.ellipse([82, 212, 136, 258], fill=FUR)  # second paw
    d.ellipse([90, 220, 128, 250], fill=FUR_LIGHT)
    # Neck ruff
    d.ellipse([150, 210, 300, 320], fill=FUR_LIGHT)
    # Floppy ears fly back with the leap, drawn BEFORE the head so only
    # their tips stick out past its silhouette
    ear(L, 322, 138, 58, 150, -42, FUR_DARK, (196, 138, 66))
    ear(L, 152, 128, 52, 140, 38, FUR_DARK, (196, 138, 66))
    # Head
    d.ellipse([120, 120, 300, 300], fill=FUR)
    d.ellipse([140, 210, 290, 296], fill=FUR_LIGHT)  # cheek / muzzle
    # Happy eye: bright, crinkled with joy
    d.ellipse([188, 176, 214, 202], fill=(40, 26, 18))
    d.ellipse([196, 180, 206, 190], fill=(255, 255, 255))
    d.arc([176, 164, 226, 210], 200, 340, fill=(120, 80, 40), width=4)
    # Nose + open smiling mouth + tongue out
    d.polygon([(196, 232), (232, 232), (214, 256)], fill=NOSE)
    d.ellipse([206, 250, 222, 262], fill=(255, 255, 255, 220))
    d.pieslice([176, 240, 252, 306], 10, 170, fill=(122, 58, 48))
    d.ellipse([196, 272, 236, 316], fill=TONGUE)
    d.line([216, 272, 216, 312], fill=(200, 90, 100), width=3)
    return L


# ---- sky -----------------------------------------------------------------
img = vgrad(W, H, [(0.0, SKY_TOP), (0.45, SKY_MID), (0.66, SKY_LOW),
                   (1.0, MEADOW_BOT)])
d = ImageDraw.Draw(img, "RGBA")

# Sun glow + core, upper right
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
soft_disc(glow, 800, 200, 260, SUN_GLOW, 120)
soft_disc(glow, 800, 200, 150, SUN_CORE, 160)
img.paste(Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB"),
          (0, 0))
d = ImageDraw.Draw(img, "RGBA")
d.ellipse([710, 110, 890, 290], fill=SUN_CORE)
d.ellipse([730, 130, 870, 270], fill=(255, 252, 230))
# Sun rays
for k in range(12):
    ang = math.radians(k * 30 + 12)
    x0, y0 = 800 + math.cos(ang) * 105, 200 + math.sin(ang) * 105
    x1, y1 = 800 + math.cos(ang) * 150, 200 + math.sin(ang) * 150
    d.line([x0, y0, x1, y1], fill=(255, 240, 190, 160), width=7)

# Soft clouds: clusters of puffs, never flat discs
for cx, cy, s in [(180, 150, 90), (260, 180, 70), (560, 110, 80),
                  (900, 420, 70), (120, 420, 60)]:
    d.ellipse([cx - s, cy - s * 0.35, cx - s * 0.2, cy + s * 0.35],
              fill=(255, 250, 238, 200))
    d.ellipse([cx - s * 0.55, cy - s * 0.6, cx + s * 0.55, cy + s * 0.35],
              fill=(255, 250, 238, 200))
    d.ellipse([cx + s * 0.2, cy - s * 0.35, cx + s, cy + s * 0.35],
              fill=(255, 250, 238, 200))

# Rolling hills
d.pieslice([-200, 480, 700, 900], 180, 360, fill=HILL_FAR)
d.pieslice([380, 520, 1250, 940], 180, 360, fill=HILL_NEAR)
# Meadow
d.rectangle([0, 660, W, H], fill=MEADOW_TOP)
for y in range(660, H):
    t = (y - 660) / (H - 660)
    col = lerp(MEADOW_TOP, MEADOW_BOT, t)
    d.line([0, y, W, y], fill=col)
# Soft shadow where the puppy will land
d.ellipse([390, 905, 650, 948], fill=(60, 90, 40, 80))

# Swirling autumn leaves (behind the puppy)
for _ in range(26):
    x = rng.randint(30, 990)
    y = rng.randint(60, 800)
    leaf(d, x, y, rng.uniform(0, 6.28), rng.randint(16, 30),
         rng.choice(LEAVES))
# A few butterflies for delight
for bx, by, c in [(880, 480, (255, 255, 255)), (150, 560, (255, 220, 120))]:
    d.ellipse([bx - 16, by - 10, bx, by + 10], fill=c)
    d.ellipse([bx, by - 10, bx + 16, by + 10], fill=c)
    d.line([bx, by - 12, bx, by + 12], fill=(90, 60, 40), width=3)

# Meadow detail, drawn BEFORE the puppy so nothing crosses its body
for _ in range(14):
    x = rng.randint(20, 1000)
    y = rng.randint(700, 980)
    leaf(d, x, y, rng.uniform(0, 6.28), rng.randint(12, 22),
         rng.choice(LEAVES))
for _ in range(90):
    x = rng.randint(10, 1014)
    y = rng.randint(680, 1020)
    hgt = rng.randint(12, 30)
    col = rng.choice([(110, 160, 70), (130, 180, 85), (90, 140, 58)])
    d.line([x, y, x + rng.randint(-6, 6), y - hgt], fill=col, width=3)
for _ in range(16):
    x = rng.randint(30, 990)
    y = rng.randint(700, 1000)
    c = rng.choice([(255, 255, 255), (255, 220, 90), (255, 180, 200)])
    d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=c)
    d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(240, 180, 60))

# ---- the red ball, just above the puppy's nose ---------------------------
d.ellipse([268, 268, 368, 368], fill=BALL)
d.ellipse([268, 268, 368, 368], outline=BALL_DARK, width=4)
d.ellipse([292, 288, 332, 328], fill=(255, 255, 255, 220))
d.arc([286, 330, 356, 366], 300, 60, fill=(255, 255, 255, 150), width=4)

# ---- the puppy, leaping up-left toward the ball --------------------------
pup = draw_puppy().rotate(-12, expand=True, resample=Image.BICUBIC)
img.paste(pup, (150, 290), pup)
d = ImageDraw.Draw(img, "RGBA")

# A few short tufts right at the bottom edge, in front of everything
for _ in range(24):
    x = rng.randint(10, 1014)
    y = rng.randint(995, 1020)
    hgt = rng.randint(8, 16)
    col = rng.choice([(110, 160, 70), (130, 180, 85), (90, 140, 58)])
    d.line([x, y, x + rng.randint(-4, 4), y - hgt], fill=col, width=3)
# Warm foreground bokeh
bok = Image.new("RGBA", (W, H), (0, 0, 0, 0))
for cx, cy, r, a in [(90, 880, 46, 46), (950, 760, 60, 38),
                     (830, 950, 40, 50), (180, 760, 34, 42)]:
    soft_disc(bok, cx, cy, r, (255, 230, 170), a)
img = Image.alpha_composite(img.convert("RGBA"), bok).convert("RGB")

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

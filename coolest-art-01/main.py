"""Entry for make.fun "Make the coolest art" (coolest-art-01).

Writes the bundled artwork to /output/entry.png.

Deterministic: copies the same bytes on every run. No network access.
The artwork is a neon koi fish swimming through a rainy night city sky,
with a lone figure on a rooftop reaching up toward it.
"""

import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "art.png")
DST = "/output/entry.png"
MAX_BYTES = 1048576  # 1 MiB, the competition limit

os.makedirs(os.path.dirname(DST), exist_ok=True)
shutil.copyfile(SRC, DST)

# Self-check: the output must be a whole PNG or JPEG within the size limit.
size = os.path.getsize(DST)
with open(DST, "rb") as f:
    magic = f.read(8)
if size > MAX_BYTES:
    raise SystemExit(f"entry.png is {size} bytes, over the {MAX_BYTES} byte limit")
if magic.startswith(b"\x89PNG\r\n\x1a\n"):
    fmt = "PNG"
elif magic.startswith(b"\xff\xd8\xff"):
    fmt = "JPEG"
else:
    raise SystemExit("entry.png is neither PNG nor JPEG")
print(f"entry.png: {size} bytes, {fmt}")

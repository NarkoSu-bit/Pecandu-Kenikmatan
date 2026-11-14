"""Entry for make.fun "Make the cutest picture" (cutest-picture-01).

Writes the bundled picture to /output/entry.png.

Deterministic: copies the same bytes on every run. No network access.
The picture is a fluffy baby red panda hugging a dewy bamboo shoot.
"""

import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "picture.png")
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

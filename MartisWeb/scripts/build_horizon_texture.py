"""Build the closing section's Mars horizon textures from NASA Mars Trek tiles.

The closing planet is drawn far wider than the screen and only a thin band
near its top edge is visible, so a whole-globe texture gets stretched several
times over. This builds a sharp equatorial strip instead (all 360° of
longitude, 10°N to 20°S), from the same Viking MDIM 2.1 colorized mosaic as
the hero globe, served as map tiles by NASA's Mars Trek.

    python scripts/build_horizon_texture.py <cache-dir>

Writes public/textures/mars-horizon-{12k,6k}.webp. Needs Pillow.
"""

import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

TILE_URL = (
    "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/"
    "1.0.0/default/default028mm/{z}/{row}/{col}.jpg"
)
Z = 5  # 64 × 32 tiles of 256 px: 16384 px around the planet, ≈ 45.5 px per degree
COLS, ROWS = 2 ** (Z + 1), 2 ** Z
DEG_PER_TILE = 180 / ROWS
LAT_N, LAT_S = 10.0, -20.0
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "textures")


def main(cache):
    tiles = os.path.join(cache, f"trek-z{Z}")
    os.makedirs(tiles, exist_ok=True)
    row0 = int((90 - LAT_N) // DEG_PER_TILE)
    row1 = int((90 - LAT_S) // DEG_PER_TILE)  # inclusive

    def get(rc):
        row, col = rc
        path = os.path.join(tiles, f"{row}_{col}.jpg")
        if not os.path.exists(path):
            req = urllib.request.Request(TILE_URL.format(z=Z, row=row, col=col), headers={"User-Agent": "MartisDux texture build"})
            with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
                f.write(r.read())
        return rc, path

    jobs = [(r, c) for r in range(row0, row1 + 1) for c in range(COLS)]
    strip = Image.new("RGB", (COLS * 256, (row1 - row0 + 1) * 256))
    with ThreadPoolExecutor(12) as pool:
        for (row, col), path in pool.map(get, jobs):
            strip.paste(Image.open(path).convert("RGB"), (col * 256, (row - row0) * 256))

    px_per_deg = 256 / DEG_PER_TILE
    top = round((90 - LAT_N) * px_per_deg) - row0 * 256
    bottom = round((90 - LAT_S) * px_per_deg) - row0 * 256
    strip = strip.crop((0, top, strip.width, bottom))
    # Tiles run from 180°W; start the strip at 0° like the hero globe texture.
    half = strip.width // 2
    strip = Image.fromarray(__import__("numpy").roll(__import__("numpy").asarray(strip), -half, axis=1))

    # Match colour to the hero globe (mars-4k.jpg, already colour-adjusted for
    # display): per-channel mean and spread over the same band of latitudes.
    import numpy as np

    ref = np.asarray(Image.open(os.path.join(OUT_DIR, "mars-4k.jpg")).convert("RGB"), dtype=np.float32)
    rh = ref.shape[0]
    ref = ref[round((90 - LAT_N) / 180 * rh): round((90 - LAT_S) / 180 * rh)]
    src = np.asarray(strip, dtype=np.float32)
    out = np.empty_like(src)
    for c in range(3):
        s, r = src[..., c], ref[..., c]
        out[..., c] = (s - s.mean()) / (s.std() + 1e-6) * r.std() + r.mean()
    strip = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

    os.makedirs(OUT_DIR, exist_ok=True)
    for name, width in (("12k", 12288), ("6k", 6144)):
        h = round(strip.height * width / strip.width)
        img = strip.resize((width, h), Image.LANCZOS)
        base = os.path.join(OUT_DIR, f"mars-horizon-{name}")
        img.save(base + ".webp", quality=80, method=6)
        print(f"{base}.webp: {width}x{h}, {os.path.getsize(base + '.webp') / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), ".cache"))

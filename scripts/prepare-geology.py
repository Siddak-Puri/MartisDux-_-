"""Rasterise the USGS Geologic Map of Mars (SIM 3292) into a lookup grid.

Source: Tanaka, K.L., et al., 2014, Geologic map of Mars: U.S. Geological Survey
Scientific Investigations Map 3292, scale 1:20,000,000. https://doi.org/10.3133/sim3292
Download: https://pubs.usgs.gov/sim/3292/downloads/sim3292_database.zip
(the same map NASA Mars Trek serves as layer SIM3292_Global_Geology).

Output
  public/data/geology/units.png   8-bit greyscale, 16 px/deg equirectangular
                                  (5760 x 2880, row 0 = 90 N, col 0 = 180 W);
                                  pixel value = index into units.json (0 = no data)
  public/data/geology/units.json  unit code, description, period, epoch, age range

Pure Python + numpy + Pillow (shapefile reader included; no GDAL needed).
Usage: python scripts/prepare-geology.py [path/to/SIM3292_Global_Geology.shp]
"""
import hashlib
import json
import os
import pathlib
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT = (pathlib.Path(os.path.expandvars(r"%LOCALAPPDATA%")) / "martisdux-work" / "geology" / "unz"
           / "SIM3292_MarsGlobalGeologicGIS_20M" / "SIM3292_Shapefiles" / "SIM3292_Global_Geology.shp")
OUT = ROOT / "public" / "data" / "geology"
PPD = 16
SS = 2

EPOCHS = {
    "eN": ("Noachian", "Early Noachian", 4.1, 3.94),
    "mN": ("Noachian", "Middle Noachian", 3.94, 3.85),
    "lN": ("Noachian", "Late Noachian", 3.85, 3.71),
    "eH": ("Hesperian", "Early Hesperian", 3.71, 3.61),
    "lH": ("Hesperian", "Late Hesperian", 3.61, 3.37),
    "eA": ("Amazonian", "Early Amazonian", 3.37, 1.23),
    "mA": ("Amazonian", "Middle Amazonian", 1.23, 0.33),
    "lA": ("Amazonian", "Late Amazonian", 0.33, 0.0),
}
PERIODS = {"N": ("Noachian", 4.1, 3.71), "H": ("Hesperian", 3.71, 3.37), "A": ("Amazonian", 3.37, 0.0)}


def age(code):
    """Unit codes start with an optional e/m/l prefix and one or two period letters (e.g. lApc, AHv, eHt, Nhu)."""
    if code[:2] in EPOCHS:
        period, epoch, old, young = EPOCHS[code[:2]]
        return {"period": period, "epoch": epoch, "oldGa": old, "youngGa": young}
    letters = [c for c in code[:2] if c in PERIODS]
    if not letters:
        return {"period": None, "epoch": None, "oldGa": None, "youngGa": None}
    oldest = PERIODS[letters[-1]]
    youngest = PERIODS[letters[0]]
    name = oldest[0] if oldest is youngest else f"{oldest[0]} to {youngest[0]}"
    return {"period": name, "epoch": None, "oldGa": oldest[1], "youngGa": youngest[2]}


def read_dbf(path):
    b = path.read_bytes()
    count = struct.unpack("<I", b[4:8])[0]
    header, record = struct.unpack("<HH", b[8:12])
    fields, i = [], 32
    while b[i] != 0x0D:
        fields.append((b[i:i + 11].split(b"\0")[0].decode(), b[i + 16]))
        i += 32
    rows = []
    for k in range(count):
        off = header + k * record + 1
        row = {}
        for name, length in fields:
            row[name] = b[off:off + length].decode("latin1").strip()
            off += length
        rows.append(row)
    return rows


def read_polygons(path):
    b = path.read_bytes()
    pos = 100
    while pos < len(b):
        _, length = struct.unpack(">ii", b[pos:pos + 8])
        content = b[pos + 8: pos + 8 + length * 2]
        pos += 8 + length * 2
        shape = struct.unpack("<i", content[:4])[0]
        if shape == 0:
            yield []
            continue
        assert shape == 5, shape
        nparts, npoints = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{nparts}i", content[44:44 + 4 * nparts])) + [npoints]
        pts = np.frombuffer(content, dtype="<f8", count=2 * npoints, offset=44 + 4 * nparts).reshape(-1, 2)
        yield [pts[parts[j]:parts[j + 1]] for j in range(nparts)]


def main():
    shp = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    rows = read_dbf(shp.with_suffix(".dbf"))
    codes = sorted({r["Unit"] for r in rows})
    assert len(codes) < 255
    index = {c: i + 1 for i, c in enumerate(codes)}
    desc = {}
    for r in rows:
        desc.setdefault(r["Unit"], r["UnitDesc"])

    w, h = 360 * PPD * SS, 180 * PPD * SS
    grid = np.zeros((h, w), dtype=np.uint8)
    for n, (row, rings) in enumerate(zip(rows, read_polygons(shp))):
        if not rings:
            continue
        allpts = np.concatenate(rings)
        x0 = int(np.floor((allpts[:, 0].min() + 180) * PPD * SS))
        x1 = int(np.ceil((allpts[:, 0].max() + 180) * PPD * SS)) + 1
        y0 = int(np.floor((90 - allpts[:, 1].max()) * PPD * SS))
        y1 = int(np.ceil((90 - allpts[:, 1].min()) * PPD * SS)) + 1
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, w), min(y1, h)
        mask = np.zeros((y1 - y0, x1 - x0), dtype=bool)
        for ring in rings:
            img = Image.new("1", (x1 - x0, y1 - y0), 0)
            xy = [((lon + 180) * PPD * SS - x0, (90 - lat) * PPD * SS - y0) for lon, lat in ring]
            if len(xy) >= 3:
                ImageDraw.Draw(img).polygon(xy, fill=1)
            mask ^= np.array(img, dtype=bool)
        grid[y0:y1, x0:x1][mask] = index[row["Unit"]]
        if n % 200 == 0:
            print(f"  {n}/{len(rows)}", flush=True)

    blocks = grid.reshape(h // SS, SS, w // SS, SS).transpose(0, 2, 1, 3).reshape(h // SS, w // SS, SS * SS)
    best = blocks[..., 0].copy()
    best_count = np.zeros(best.shape, dtype=np.uint8)
    for k in range(SS * SS):
        cand = blocks[..., k]
        cnt = (blocks == cand[..., None]).sum(-1).astype(np.uint8)
        better = (cand != 0) & ((cnt > best_count) | (best == 0))
        best[better] = cand[better]
        best_count[better] = cnt[better]
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(best, "L").save(OUT / "units.png", optimize=True)

    covered = (best > 0).mean()
    units = [{"code": c, "description": desc[c], **age(c)} for c in codes]
    meta = {
        "source": "Tanaka, K.L., et al., 2014, Geologic map of Mars: USGS Scientific Investigations Map 3292, scale 1:20,000,000",
        "doi": "https://doi.org/10.3133/sim3292",
        "download": "https://pubs.usgs.gov/sim/3292/downloads/sim3292_database.zip",
        "trekLayer": "SIM3292_Global_Geology",
        "shapefileSha256": hashlib.sha256(shp.read_bytes()).hexdigest(),
        "grid": {"file": "units.png", "pixelsPerDegree": PPD, "width": best.shape[1], "height": best.shape[0],
                 "origin": "row 0 = 90N, column 0 = 180W, pixel centres at +0.5", "noData": 0, "coverage": round(float(covered), 4)},
        "ages": "Epoch boundaries in Ga follow Tanaka et al. 2014 (Hartmann-Neukum chronology); approximate.",
        "scaleNote": "Global 1:20M map: contacts are placed to roughly +/- 5-10 km. Use for regional context, not outcrop-scale geology.",
        "units": units,
    }
    (OUT / "units.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print(f"{len(codes)} units, coverage {covered:.3%}, png {(OUT / 'units.png').stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()

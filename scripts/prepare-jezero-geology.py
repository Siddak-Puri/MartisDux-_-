"""Rasterise the USGS geologic map of Jezero crater (SIM 3464, 1:75,000) for MartisDux.

Source: Sun, V., and Stack, K., 2020, Geologic map of Jezero crater and the Nili Planum
region, Mars: U.S. Geological Survey Scientific Investigations Map 3464, scale 1:75,000,
https://doi.org/10.3133/sim3464. Part of the USGS-NASA Planetary Geologic Mapping Program.
GIS: https://pubs.usgs.gov/sim/3464/sim3464_database.zip (only Geodatabase/Nili.gdb is needed).

The map is ~270x more detailed than the global 1:20M map (SIM 3292) the app used before,
so the rock unit under each station of a walk is meaningful. The readme notes the map was
drawn on a semi-controlled CTX mosaic: expect offsets of ~100-200 m.

Output (public/data/geology/jezero/):
  units.png      8-bit index grid, equirectangular lon/lat, value = unit index + 1 (0 = off map)
  overlay.png    RGBA colour overlay of the same grid for the map view
  units.json     bounds, grid size, units (code, name, plain-language notes, walking hazard)

Needs: pyogrio, pyproj, numpy, Pillow.
Usage: python scripts/prepare-jezero-geology.py [path/to/Nili.gdb]
"""
import json, os, pathlib, sys
import numpy as np
import pyogrio
from pyogrio import raw
from pyproj import CRS, Transformer
from PIL import Image, ImageDraw
from shapely import from_wkb

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT = (pathlib.Path(os.path.expandvars(r"%LOCALAPPDATA%")) / "martisdux-work" / "sim3464" / "unz"
           / "sim3464_JezeroNili_FINAL" / "Geodatabase" / "Nili.gdb")
OUT = ROOT / "public" / "data" / "geology" / "jezero"
CELL = 20.0
PPD = 3000

UNITS = {
    "NHjf1": ("Jezero fan 1 (lower delta)", "#6fa8dc", "Layered river sediment laid down where a river met the old lake. A top place to look for signs of past life.", None),
    "NHjf2": ("Jezero fan 2 (main delta)", "#3d85c6", "The delta: river sediment with clays and carbonates. Perseverance explored and sampled its front.", None),
    "Njf":   ("Jezero floor", "#d5a6bd", "Crater floor. Perseverance found it is volcanic (igneous) rock, the Máaz and Séítah formations.", None),
    "Nle":   ("Lower etched unit", "#c27c0e", "Olivine-rich rock low in the crater, possibly changed by the ancient lake water.", None),
    "Nue":   ("Upper etched unit", "#e69138", "Olivine-rich rock found across the region. Wind-carved ridges (yardangs) in places.", "caution"),
    "Nnp1":  ("Nili Planum 1", "#b4a07a", "Oldest rock here, the ground the Jezero impact hit. Holds megabreccia: shattered blocks 10–100 m across.", "caution"),
    "Nnp2":  ("Nili Planum 2", "#8e7cc3", "Flat-topped cap rock with lobed edges that sheds boulders. Watch your footing near its edges.", "caution"),
    "Hnpf":  ("Nili Planum fan", "#9fc5e8", "River deposits inside Neretva Vallis, the channel that fed the lake.", None),
    "Nrb":   ("Rugged bright unit", "#f1c232", "Light-toned rugged mounds sitting on the etched unit. Rough going.", "caution"),
    "su":    ("Smooth unit", "#cccccc", "Smooth dark cover thick enough to hide the rock beneath. Easy walking, little bedrock to sample.", None),
    "Aeb":   ("Windblown sand (eolian bedforms)", "#ffe599", "Sand ripples and dunes. Soft sand can trap wheels (it stranded the Spirit rover) and tires walkers. Cross with care, avoid by rover.", "avoid"),
    "cr":    ("Crater rim", "#7f6000", "Raised rim rock of Jezero and smaller craters, with megabreccia blocks. Often steep.", "caution"),
    "ce":    ("Crater ejecta", "#a67c52", "Rock thrown out by impacts. Expect scattered boulders.", "caution"),
    "ci":    ("Crater interior", "#783f04", "Bedrock in the middle of a crater.", None),
}
PERIOD = {"N": "Noachian (more than 3.7 billion years old)", "H": "Hesperian (about 3.7–3.0 billion years old)",
          "A": "Amazonian (younger than 3 billion years)"}


def age(code):
    if code.startswith("NH"): return "Noachian to Hesperian (about 3.9–3.0 billion years old)"
    return PERIOD.get(code[0]) if code[0] in "NHA" and code[1:2].islower() else "Age set by the crater that formed it"


def main():
    gdb = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    meta, _, geoms, fields = raw.read(str(gdb), layer="GeoUnits_v1")
    names = list(meta["fields"])
    sym = fields[names.index("symbol")]
    crs = CRS.from_wkt(meta["crs"]) if meta["crs"].startswith(("PROJCS", "PROJCRS")) else CRS.from_user_input(meta["crs"])
    codes = [c for c in UNITS]
    index = {c: i + 1 for i, c in enumerate(codes)}

    shapes = [(from_wkb(g), str(s)) for g, s in zip(geoms, sym) if g is not None]
    minx = min(s.bounds[0] for s, _ in shapes); miny = min(s.bounds[1] for s, _ in shapes)
    maxx = max(s.bounds[2] for s, _ in shapes); maxy = max(s.bounds[3] for s, _ in shapes)
    w, h = int((maxx - minx) / CELL) + 1, int((maxy - miny) / CELL) + 1
    img = Image.new("L", (w, h), 0); draw = ImageDraw.Draw(img)
    px = lambda xy: [((x - minx) / CELL, (maxy - y) / CELL) for x, y in xy]
    for shape, code in sorted(shapes, key=lambda t: -t[0].area):
        if code not in index: print("skip unknown unit", code); continue
        for poly in getattr(shape, "geoms", [shape]):
            draw.polygon(px(poly.exterior.coords), fill=index[code])
            for hole in poly.interiors: draw.polygon(px(hole.coords), fill=0)
    mtm = np.asarray(img)

    geo = Transformer.from_crs(crs, crs.geodetic_crs, always_xy=True)
    lons, lats = geo.transform([minx, maxx, minx, maxx], [miny, miny, maxy, maxy])
    west, east, south, north = min(lons), max(lons), min(lats), max(lats)
    gw, gh = int((east - west) * PPD), int((north - south) * PPD)
    lon = west + (np.arange(gw) + .5) / PPD; lat = north - (np.arange(gh) + .5) / PPD
    LON, LAT = np.meshgrid(lon, lat)
    X, Y = Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True).transform(LON, LAT)
    c = ((X - minx) / CELL).astype(int); r = ((maxy - Y) / CELL).astype(int)
    ok = (c >= 0) & (c < w) & (r >= 0) & (r < h)
    grid = np.zeros((gh, gw), np.uint8); grid[ok] = mtm[r[ok], c[ok]]

    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray(grid).save(OUT / "units.png", optimize=True)
    small = grid
    palette = np.zeros((256, 4), np.uint8)
    for code, i in index.items():
        hexc = UNITS[code][1]; palette[i] = [int(hexc[k:k + 2], 16) for k in (1, 3, 5)] + [115]
    rgba = palette[small]
    edge = np.zeros(small.shape, bool)
    edge[:, 1:] |= small[:, 1:] != small[:, :-1]; edge[1:, :] |= small[1:, :] != small[:-1, :]
    rgba[edge & (small > 0)] = [20, 12, 8, 200]
    Image.fromarray(rgba, "RGBA").save(OUT / "overlay.png", optimize=True)

    present = {s for _, s in shapes}
    units = [{"code": cd, "name": UNITS[cd][0], "color": UNITS[cd][1], "notes": UNITS[cd][2], "hazard": UNITS[cd][3],
              "age": age(cd), "mapped": cd in present} for cd in codes]
    json.dump({"source": "USGS SIM 3464 (Sun & Stack 2020), 1:75,000, USGS-NASA Planetary Geologic Mapping Program",
               "doi": "https://doi.org/10.3133/sim3464", "offsetNote": "Drawn on a semi-controlled CTX mosaic: offsets of ~100-200 m.",
               "bounds": {"west": west, "east": east, "south": south, "north": north},
               "grid": {"file": "units.png", "width": gw, "height": gh, "ppd": PPD}, "overlay": "overlay.png", "units": units},
              open(OUT / "units.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(f"grid {gw}x{gh}, {ok.mean():.0%} inside projection window, bounds {west:.3f}..{east:.3f}E {south:.3f}..{north:.3f}N")
    for f in OUT.iterdir(): print(f.name, f.stat().st_size)


if __name__ == "__main__":
    main()

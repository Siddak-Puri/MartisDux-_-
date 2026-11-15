"""Build src/data/jezero.js from public NASA / USGS data.

Every map, diagram and 3D tile on the site reads its terrain, route and sites
from the module this script writes. Run it again to refresh the data:

    python scripts/build_jezero_data.py <cache-dir>

Sources (downloaded into <cache-dir> if missing):
  * Elevation: Mars 2020 Terrain Relative Navigation CTX DTM of Jezero crater,
    20 m/pixel, elevations relative to the Mars geoid (USGS Astrogeology).
  * Route and positions: Perseverance traverse and waypoint files published by
    NASA/JPL for the "Where is Perseverance?" map (MMGIS).
  * Samples: NASA Science "Mars Rock Samples" table (names, features, sols, dates).

Needs Python 3 with numpy and Pillow.
"""

import base64
import html
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date

import numpy as np
from PIL import Image

DEM_URL = (
    "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/"
    "JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif"
)
TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
SAMPLES_URL = "https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"

# The mapped region: the western floor of Jezero, the delta front, Neretva
# Vallis and the western rim. Its ground footprint is 16:9, like the map.
CENTER_LON, CENTER_LAT = 77.34, 18.46
WIDTH_DEG = 0.30
COLS, ROWS = 384, 216
ASPECT = 16 / 9

R_DEM = 3396190.0  # Mars 2000 sphere used by the DEM projection, metres
OUT = os.path.join(os.path.dirname(__file__), "..", "src", "data", "jezero.js")


def fetch(url, path):
    if not os.path.exists(path):
        print("downloading", url)
        req = urllib.request.Request(url, headers={"User-Agent": "MartisDux data build"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


# ---------------------------------------------------------------- region frame
cos_lat = math.cos(math.radians(CENTER_LAT))
HEIGHT_DEG = WIDTH_DEG * cos_lat / ASPECT
LON_W, LON_E = CENTER_LON - WIDTH_DEG / 2, CENTER_LON + WIDTH_DEG / 2
LAT_N, LAT_S = CENTER_LAT + HEIGHT_DEG / 2, CENTER_LAT - HEIGHT_DEG / 2
M_PER_DEG = R_DEM * math.pi / 180
WIDTH_M = WIDTH_DEG * M_PER_DEG * cos_lat
HEIGHT_M = HEIGHT_DEG * M_PER_DEG


def to_map(lon, lat):
    """lon/lat → site coordinates: x ∈ [0, 16/9], y ∈ [0, 1] (y grows south)."""
    return ((lon - LON_W) / WIDTH_DEG * ASPECT, (LAT_N - lat) / HEIGHT_DEG)


def rdp(points, eps):
    """Douglas–Peucker simplification on [x, y, ...] points (iterative)."""
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a][:2]
        bx, by = points[b][:2]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = points[i][:2]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > best:
                best, idx = d, i
        if best > eps:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def main(cache):
    os.makedirs(cache, exist_ok=True)
    dem_path = fetch(DEM_URL, os.path.join(cache, "jez_dem.tif"))
    trav_path = fetch(TRAVERSE_URL, os.path.join(cache, "traverse.json"))
    wp_path = fetch(WAYPOINTS_URL, os.path.join(cache, "waypoints.json"))
    samples_path = fetch(SAMPLES_URL, os.path.join(cache, "samples.html"))

    # ------------------------------------------------------------ elevation
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(dem_path)
    tie = im.tag_v2[33922]  # (i, j, k, x, y, z) model tiepoint
    scale = im.tag_v2[33550]  # pixel size (x, y)
    nodata = float(im.tag_v2.get(42113, "-3.4e38"))
    x0, y0, px = tie[3], tie[4], scale[0]
    dem = np.asarray(im, dtype=np.float32)
    dem = np.where(dem <= nodata * 0.5, np.nan, dem)

    def dem_at(lon, lat):
        """Bilinear DEM sample (metres) at lon/lat arrays."""
        c = (np.radians(lon) * R_DEM - x0) / px - 0.5
        r = (y0 - np.radians(lat) * R_DEM) / px - 0.5
        c0 = np.clip(np.floor(c).astype(int), 0, dem.shape[1] - 2)
        r0 = np.clip(np.floor(r).astype(int), 0, dem.shape[0] - 2)
        tc, tr = c - c0, r - r0
        a = dem[r0, c0]
        b = dem[r0, c0 + 1]
        cc = dem[r0 + 1, c0]
        d = dem[r0 + 1, c0 + 1]
        return a * (1 - tc) * (1 - tr) + b * tc * (1 - tr) + cc * (1 - tc) * tr + d * tc * tr

    lons = LON_W + (LON_E - LON_W) * (np.arange(COLS) / (COLS - 1))
    lats = LAT_N - (LAT_N - LAT_S) * (np.arange(ROWS) / (ROWS - 1))
    LON, LAT = np.meshgrid(lons, lats)
    elev = dem_at(LON, LAT)
    if np.isnan(elev).any():
        raise SystemExit(f"DEM has {np.isnan(elev).sum()} empty cells inside the region")
    base = math.floor(float(elev.min()))
    q = np.round((elev - base) * 10).astype("<u2")  # decimetres above base
    dem_b64 = base64.b64encode(q.tobytes()).decode("ascii")

    # -------------------------------------------------------------- traverse
    trav = json.load(open(trav_path, encoding="utf-8"))
    pts = []
    for f in trav["features"]:
        sol = f["properties"]["sol"]
        coords = f["geometry"]["coordinates"]
        if f["geometry"]["type"] == "MultiLineString":
            coords = [p for line in coords for p in line]
        for lon, lat, *_ in coords:
            x, y = to_map(lon, lat)
            pts.append([x, y, sol])
    route = rdp(pts, 0.0012)  # ≈ 11 m on the ground
    last_sol = max(p[2] for p in pts)

    # ------------------------------------------------------------- waypoints
    wps = json.load(open(wp_path, encoding="utf-8"))["features"]
    wps = sorted((w["properties"] for w in wps), key=lambda p: (p["sol"], p["dist_total_m"]))

    def where(sol):
        """Last recorded rover position on or before `sol`."""
        best = None
        for p in wps:
            if p["sol"] <= sol:
                best = p
        return best

    # Check the DEM against the rover's own elevation fixes.
    diffs = [float(dem_at(np.array(p["lon"]), np.array(p["lat"]))) - p["elev_geoid"] for p in wps]
    diffs = np.array([d for d in diffs if not math.isnan(d)])
    print(f"DEM - rover elevation: median {np.median(diffs):+.1f} m, 90% within +/-{np.percentile(np.abs(diffs - np.median(diffs)), 90):.1f} m")

    # --------------------------------------------------------------- samples
    s = open(samples_path, encoding="utf-8", errors="replace").read()
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "|", t))
    t = re.sub(r"\s*\|[\s|]*", " | ", t).replace(" ", " ")
    samples = {}
    # Older rows: "Name | Sample No. N | Feature Name: | … | Sol Sealed: | … | Date Sealed: | … | Rock Type: | …"
    old = re.compile(
        r"([^|]+?) \| (?:\(aka ([^)]*)\) \| )?Sample No\. (\d+) \| Feature Name: \| ([^|]+?) \| "
        r"Sample Type: \| ([^|]+?) \| Sol Sealed: \| (\d+) \| Date Sealed: \| ([^|]+?) \| Rock Type: \| ([^|]+?) \|"
    )
    for m in old.finditer(t):
        name, aka, no, feat, typ, sol, when, rock = (g.strip() if g else g for g in m.groups())
        samples.setdefault(int(no), dict(no=int(no), name=aka or name, feature=feat, type=typ, sol=int(sol), date=when, rock=rock))
    # Newer rows put the fields in a different order; read each one by label.
    for m in re.finditer(r"Sample No\. (\d+) \|((?:(?!Sample No\.).){0,900})", t):
        no = int(m.group(1))
        if no in samples:
            continue
        body = m.group(2)

        def field(label):
            f = re.search(label + r"[^|]*\| ?:?\s*([^|]+?) \|", body)
            return f.group(1).strip(" :") if f else None

        sol = field("Sol Sealed")
        if not sol or not sol.isdigit():
            continue  # not yet sealed / no sol published: can't be placed
        samples[no] = dict(
            no=no, name=field("Sample.Name"), feature=field("Feature Name"), type=field("Sample Type"),
            sol=int(sol), date=field("Date Sealed"), rock=field("Rock Type") or "Not listed",
        )
    sample_list = []
    for no in sorted(samples):
        smp = samples[no]
        p = where(smp["sol"])
        x, y = to_map(p["lon"], p["lat"])
        if not (0 <= x <= ASPECT and 0 <= y <= 1):
            continue
        sample_list.append({**smp, "lon": round(p["lon"], 5), "lat": round(p["lat"], 5), "at": [round(x, 4), round(y, 4)]})

    # ------------------------------------------------------------ key places
    def place(sol):
        p = where(sol)
        x, y = to_map(p["lon"], p["lat"])
        return {"sol": sol, "lon": round(p["lon"], 5), "lat": round(p["lat"], 5), "at": [round(x, 4), round(y, 4)],
                "elev": round(p["elev_geoid"]), "driven_km": round(p["dist_total_m"] / 1000, 2)}

    places = {
        "landing": place(14),  # Octavia E. Butler Landing, before the first drive
        "seitah": place(200),  # entered South Séítah
        "delta": place(509),  # Wildcat Ridge core, delta front
        "neretva": place(1215),  # Cheyava Falls core, Neretva Vallis
        "rim": place(1354),  # top of the crater rim at Lookout Hill
    }
    # Séítah: the rover's own positions while working among the ripples.
    sei = [to_map(p["lon"], p["lat"]) for p in wps if 200 <= p["sol"] <= 380]
    sx, sy = np.array(sei).T
    places["seitah"]["zone"] = {
        "x": round(float(sx.mean()), 4), "y": round(float(sy.mean()), 4),
        "rx": round(float(max(sx.std() * 2.2, 0.05)), 4), "ry": round(float(max(sy.std() * 2.2, 0.05)), 4),
    }

    rover = wps[-1]
    meta = {
        "name": "Jezero crater (western floor, delta and rim)",
        "lonW": round(LON_W, 5), "lonE": round(LON_E, 5), "latN": round(LAT_N, 5), "latS": round(LAT_S, 5),
        "widthM": round(WIDTH_M), "heightM": round(HEIGHT_M),
        "cols": COLS, "rows": ROWS, "base": base, "unit": 0.1,
        "minM": round(float(elev.min()), 1), "maxM": round(float(elev.max()), 1),
        "lastSol": last_sol, "drivenKm": round(rover["dist_total_m"] / 1000, 2),
        "built": date.today().isoformat(),
    }

    js = f"""// Generated by scripts/build_jezero_data.py on {meta['built']}. Do not edit by hand.
//
// Real data for Jezero crater, Mars:
//  * Elevation: USGS Astrogeology, Mars 2020 Terrain Relative Navigation CTX DTM
//    (20 m/pixel, metres relative to the Mars geoid), resampled to {COLS}×{ROWS}
//    ({WIDTH_M / (COLS - 1):.0f} m per cell). {DEM_URL}
//  * Route and positions: NASA/JPL Perseverance traverse and waypoints, sol {last_sol}.
//    {TRAVERSE_URL}
//  * Samples: NASA Science, Mars Rock Samples. {SAMPLES_URL}
//
// Site coordinates: x ∈ [0, 16/9] west→east, y ∈ [0, 1] north→south.

export const META = {json.dumps(meta, ensure_ascii=False)};

/** Elevation, decimetres above META.base, row-major from the north-west corner (uint16, little-endian). */
export const DEM_B64 = '{dem_b64}';

/** Perseverance's drive, simplified to ≈11 m: [x, y, sol]. */
export const TRAVERSE = {json.dumps([[round(x, 4), round(y, 4), sol] for x, y, sol in route])};

/** Rover positions at named moments in the mission (from the waypoint file). */
export const PLACES = {json.dumps(places, ensure_ascii=False, indent=2)};

/** Samples sealed inside this region, placed at the rover's position on the sol each was sealed. */
export const SAMPLES = {json.dumps(sample_list, ensure_ascii=False, indent=2)};
"""
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)
    print(f"wrote {os.path.normpath(OUT)}: {len(js) / 1024:.0f} KB, {len(route)} route points, "
          f"{len(sample_list)} samples, elevation {meta['minM']} to {meta['maxM']} m")
    print(json.dumps(places, indent=1))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), ".cache"))

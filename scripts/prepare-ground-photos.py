"""Match real Perseverance raw images to the places they were taken.

Inputs
  * MMGIS M20_waypoints.json (rover localisations: site, drive, sol, lon, lat)
  * NASA Mars Perseverance Raw Images API (https://mars.nasa.gov/mars2020/multimedia/raw-images/)

Every raw image carries the rover's site/drive (its RMC location counter).
The same counter is on each MMGIS waypoint, so a photo can be placed on the
map at the exact localisation it was taken from - no guessing by time.

For each waypoint we keep a small, direction-spread set of full-frame images:
  * Navcam left (wide, greyscale - closest to what a walker would see)
  * Mastcam-Z left, RGB filter (colour)
  * Front Hazcam left (ground just ahead, useful for footing)

Output: public/data/perseverance/ground-photos.json
Raw API responses are cached in %LOCALAPPDATA%/martisdux-work/m20/raw-images/.

Usage: python scripts/prepare-ground-photos.py [--workers 3]
"""
import argparse
import concurrent.futures as cf
import gzip
import hashlib
import json
import math
import os
import pathlib
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORK = pathlib.Path(os.path.expandvars(r"%LOCALAPPDATA%")) / "martisdux-work" / "m20"
CACHE = WORK / "raw-images"
WAYPOINTS = WORK / "M20_waypoints.json"
OUT = ROOT / "public" / "data" / "perseverance" / "ground-photos.json"
API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol={sol}"
PREFIX = "https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/"

KEEP = {"NAVCAM_LEFT": 8, "MCZ_LEFT": 4, "FRONT_HAZCAM_LEFT_A": 1}
LABEL = {"NAVCAM_LEFT": "Navcam", "MCZ_LEFT": "Mastcam-Z", "FRONT_HAZCAM_LEFT_A": "Front Hazcam"}


def fetch_sol(sol):
    path = CACHE / f"sol-{sol:05d}.json.gz"
    if path.exists():
        return sol, json.loads(gzip.decompress(path.read_bytes()))
    request = urllib.request.Request(API.format(sol=sol), headers={"User-Agent": "martisdux-explorer data prep"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                body = response.read()
            data = json.loads(body)
            time.sleep(0.5)
            path.write_bytes(gzip.compress(json.dumps(data["images"]).encode()))
            return sol, data["images"]
        except Exception as error:  # noqa: BLE001
            if attempt == 5:
                print(f"  sol {sol} unavailable ({error}); skipped - rerun to fill in", flush=True)
                return sol, []
            time.sleep(10 * (attempt + 1))


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def wanted(image):
    camera = image["camera"]["instrument"]
    if camera not in KEEP or image.get("sample_type") != "Full":
        return False
    if camera == "MCZ_LEFT" and not image["camera"].get("filter_name", "").startswith("ZCAM_L0_RGB"):
        return False
    w, h = (int(v) for v in image["extended"]["dimension"].strip("()").split(","))
    return w >= 640 and h >= 480


def spread(images, count):
    """Pick `count` images spread around the compass (by mast azimuth)."""
    if len(images) <= count:
        return images
    with_az = [i for i in images if number(i["extended"].get("mastAz")) is not None]
    if len(with_az) < count:
        return images[:count]
    with_az.sort(key=lambda i: number(i["extended"]["mastAz"]))
    step = len(with_az) / count
    return [with_az[int(k * step)] for k in range(count)]


def compact(image):
    url = image["image_files"]["medium"]
    assert url.startswith(PREFIX), url
    az = number(image["extended"].get("mastAz"))
    el = number(image["extended"].get("mastEl"))
    return {
        "id": image["imageid"],
        "cam": LABEL[image["camera"]["instrument"]],
        "sol": image["sol"],
        "utc": image["date_taken_utc"][:19] + "Z",
        "lmst": image["date_taken_mars"].split("M")[-1][:5],
        "az": None if az is None else round(az, 1),
        "el": None if el is None else round(el, 1),
        "p": url[len(PREFIX):].removesuffix("_800.jpg"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=2)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)

    raw = WAYPOINTS.read_bytes()
    features = json.loads(raw.decode("utf-8-sig"))["features"]
    points = {}
    for f in features:
        p = f["properties"]
        key = (int(p["site"]), int(p["drive"]))
        points[key] = {"rmc": p["RMC"], "sol": int(p["sol"]), "lon": round(p["lon"], 7), "lat": round(p["lat"], 7)}

    sols = sorted({p["sol"] for p in points.values()} | {p["sol"] + 1 for p in points.values()})
    print(f"{len(points)} waypoints, fetching {len(sols)} sols of raw-image listings")
    by_location = {}
    done = 0
    with cf.ThreadPoolExecutor(args.workers) as pool:
        for sol, images in pool.map(fetch_sol, sols):
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(sols)}", flush=True)
            for image in images:
                try:
                    key = (int(image["site"]), int(image["drive"]))
                except (TypeError, ValueError, KeyError):
                    continue
                if key in points and wanted(image):
                    by_location.setdefault(key, {}).setdefault(image["imageid"], image)

    out = []
    total = 0
    for key, point in sorted(points.items(), key=lambda kv: (kv[1]["sol"], kv[0])):
        found = list(by_location.get(key, {}).values())
        if not found:
            continue
        found.sort(key=lambda i: i["date_taken_utc"])
        chosen = []
        for camera, count in KEEP.items():
            chosen += spread([i for i in found if i["camera"]["instrument"] == camera], count)
        if not chosen:
            continue
        total += len(chosen)
        out.append({**point, "photos": [compact(i) for i in chosen]})

    document = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "https://mars.nasa.gov/mars2020/multimedia/raw-images/",
        "api": "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=<sol>",
        "positions": "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json",
        "positionsSha256": hashlib.sha256(raw).hexdigest(),
        "method": "Raw image site/drive matched to the MMGIS waypoint with the same site/drive (RMC). Full-frame Navcam-left, Mastcam-Z-left RGB and Front-Hazcam-left images, spread by mast azimuth.",
        "urlPrefix": PREFIX,
        "urlSuffix": {"small": "_320.jpg", "medium": "_800.jpg", "large": "_1200.jpg"},
        "credit": "NASA/JPL-Caltech (Navcam, Hazcam); NASA/JPL-Caltech/ASU (Mastcam-Z). Raw, unprocessed images.",
        "locations": out,
    }
    OUT.write_text(json.dumps(document, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} places, {total} photos, {OUT.stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()

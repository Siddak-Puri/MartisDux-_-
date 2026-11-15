# Data and provenance

Orbital sources verified 27 October 2026; ground-photo sources verified 31 October 2026. Mission images are recorded observations and composites;
the page does not represent current conditions on Mars.

| Product | Native source spacing | Finest configured tile spacing at equator | Coverage |
| --- | --- | --- | --- |
| Viking MDIM 2.1 color mosaic | ~232 m/px | ~325.6 m/px, level 7, 256 px tiles | Global |
| MRO CTX V01, Caltech Murray Lab | 5 m/px | ~5.09 m/px, level 12, 512 px tiles | 99.5% between 88°S and 88°N |
| Jezero HiRISE controlled orthomosaic | ~0.25 m/px | ~0.318 m/px at equator, ~0.302 m/px near Jezero, level 17 | Limited Jezero footprint |
| Odyssey THEMIS daytime IR controlled mosaic, v2 October 2018 | ~100 m/px | ~81.4 m/px, level 9 | Approximately 65°S–65°N |
| MGS MOLA color-shaded relief | ~463 m/px | ~325.6 m/px, level 7 | Global |

Tile sampling finer than source spacing does not add scientific detail. Pixel size
is not positional accuracy. Data gaps, seams and differing observation times remain.

## Official catalogs and original processing teams

- [NASA Mars Trek WMTS API](https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars)
- [NASA/JPL: global CTX mosaic](https://www.jpl.nasa.gov/news/new-interactive-mosaic-uses-nasa-imagery-to-show-mars-in-vivid-detail/)
- [Caltech Murray Lab CTX data and source-image seam maps](https://murray-lab.caltech.edu/CTX/)
- [NASA Planetary Data System](https://pds.nasa.gov/)
- [USGS Astrogeology](https://astrogeology.usgs.gov/)

Viking, MOLA, THEMIS and Jezero HiRISE image tiles are streamed directly from
`trek.nasa.gov`. The newer global CTX V01 mosaic uses NASA MRO observations, processed
by Caltech and streamed through Esri. Its service metadata contains legacy beta
wording; the catalog item identifies it as V01. The stream is a beta service and may
change. The app keeps NASA overview imagery underneath and handles failed tile loads.

## Exact machine-readable service records

- [Viking WMTS](https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml)
- [CTX V01 service](https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer?f=pjson)
- [CTX V01 catalog item](https://www.arcgis.com/sharing/rest/content/items/30c4acfe36284b1784bf07d5d73f9e4d?f=pjson)
- [HiRISE Jezero WMTS](https://trek.nasa.gov/tiles/Mars/EQ/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd/1.0.0/WMTSCapabilities.xml)
- [THEMIS WMTS](https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018/1.0.0/WMTSCapabilities.xml)
- [MOLA WMTS](https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/WMTSCapabilities.xml)

All image providers use a 2×1 geographic root grid, origin −180°, +90°. Distances use
a common display sphere of radius 3,396,190 m rather than Earth's WGS84 ellipsoid. Native source-body definitions are retained in the original metadata.
No default Cesium ion imagery or terrain is requested.

## Bundled 8K overview and Ultra rendering

`public/data/viking-overview.jpg` is an **8,192×4,096** version of the official
NASA/USGS **21,339×10,670** 1 km browse product. The original image and projection
sidecar are linked in `public/data/viking-overview.json`. Lanczos downsampling and
JPEG encoding preserve the observed content; no color changes, artificial
sharpening, generated detail or AI upscaling were applied. Output sampling is
approximately **2.60 km/px** at the equator.

- [Original official global image](https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/5ea881c6-01b3-41fa-a7af-42d2131b54f1/download/mars_viking_mdim21_clrmosaic_1km.jpg)
- [Original projection sidecar](https://astrogeology.usgs.gov/ckan/dataset/7131d503-cdc9-45a5-8f83-5126c0fd397e/resource/69f3953f-9791-4d92-bffe-ebe24945eb95/download/mars_viking_mdim21_clrmosaic_1km.jpg.aux.xml)

The full native 232 m product is 92,160×46,080 pixels (approximately 12 GB); the
application streams its finer NASA image tiles for regional views. At global
camera distances, the resident 8K overview remains above no coarser tile layers.
This avoids a low-detail WMTS level hiding the sharper overview.

**Ultra**, enabled by default, uses finer Cesium imagery refinement (screen-space
error 0.35) and targets a 3,840-pixel render-buffer long edge, bounded by 9.5 million
pixels and a 3× render scale. Exact dimensions depend on viewport and device.
The data dialog reports the actual buffer dimensions. **Balanced** uses native
screen density up to 2× with less costly tile refinement.

Zoom limits follow the active product's footprint and effective resolution
(maximum of native source spacing and finest delivered tile spacing). A nadir
projection calculation limits magnification to approximately 1.5 physical display
pixels per source pixel. This prevents extreme enlargement of CTX's 5 m imagery
while allowing closer HiRISE views within the Jezero footprint. It is a display
clarity limit, not a navigation-safety or positional-accuracy claim.

Original service records captured on the verification date are included in
`public/data/provenance/`. Jezero and Gale bookmarks indicate their rover landing
areas, not current rover locations. Olympus and Valles use the USGS Gazetteer
MDIM 2.1 planetocentric entries.

## Orbital display treatment

The orbital Surface view uses a camera-relative upper-left display light, a dark
terminator, a warm color curve matched to the supplied MartisDux website, and a
restrained sunlit rim. These are rendering settings, not additional NASA science
observations or a real-time solar illumination calculation. The source files and
geographic coordinates remain unchanged.

The treatment fades out between 5,000 km and 1,500 km camera altitude and is disabled
for infrared and relief. The sun button toggles a neutral map presentation. No image
brightness is used as measured elevation or as a terrain displacement map.

## Credit

Viking: NASA/JPL/USGS/NASA Ames. CTX: NASA/JPL/MSSS/Caltech Murray Lab/Esri.
HiRISE: NASA/JPL-Caltech/University of Arizona/USGS. THEMIS: NASA/JPL/ASU/USGS.
MOLA: NASA/MGS/MOLA Science Team/USGS. CesiumJS is Apache-2.0 licensed; fonts use
the SIL Open Font License. Data/service terms remain those of their source providers.


## Surface route geometry

The orange route is computed by this application, not supplied or certified by
NASA. Endpoints use planetocentric latitude and east-positive longitude on the
same Mars reference sphere as the imagery. A great-circle interpolation provides
the trail; central angle × 3,396,190 m provides its surface distance. Elevation,
slope, hazards and passability are not evaluated. Pins are user-selected Martian
coordinates, not a GPS fix. Imagery credits remain those of the selected dataset.

The implementation uses [Cesium ground-clamped polylines](https://cesium.com/learn/cesiumjs/ref-doc/PolylineGraphics.html#clampToGround)
so the trail follows the reference surface rather than cutting through the globe.


## Perseverance surface panorama (PIA24264)

- **Product:** Mastcam-Z's First 360-Degree Panorama.
- **Publisher:** NASA/JPL-Caltech, published 24 February 2021.
- **Acquired:** 21 February 2021 (Sol 3); 142 Mastcam-Z images stitched into a 360° panorama.
- **Credit:** NASA/JPL-Caltech/MSSS/ASU.
- **Official product:** https://www.jpl.nasa.gov/images/pia24264-mastcam-zs-first-360-degree-panorama/
- **Official linked original JPEG:** https://d2pn8kiwq2w21t.cloudfront.net/original_images/jpegPIA24264.jpg
- **Bundled file:** `public/panoramas/perseverance-sol3.jpg`, 9,238 × 2,451 pixels.
  Downloaded unchanged, with source and SHA-256 in `public/panoramas/perseverance-sol3.json`.
- **Site:** Perseverance's landing area, approximately 18.4446°N, 77.4509°E.
  This is an approximate site bookmark, not surveyed pixel-to-ground registration.

The viewer pans through the cylindrical strip, wrapping its horizontal seam and
restricting its vertical viewport to the observed image. Zoom is display cropping,
not extra image detail. Stitching artifacts present in the original remain visible.
The source is not colorized, sharpened, AI-upscaled, padded or used as elevation.
Brand gradients are interface overlays only. No geographic orientation registration
was verified for this JPEG; routes stay on the orbital map, with no pointer over the photo.

## Curiosity ground panorama (PIA16074)

- **Product:** All Around Curiosity, published 17 August 2012.
- **Acquired:** 26 Navcam images, late 7 August PDT / early 8 August EDT, 2012.
- **Credit:** NASA/JPL-Caltech.
- **Official product:** https://science.nasa.gov/resource/all-around-curiosity/
- **Official linked original JPEG:** https://assets.science.nasa.gov/content/dam/science/psd/mars/downloadable_items/3/6/36187_pia16074_navcamcylindrical.jpg
- **Bundled file:** `public/panoramas/curiosity-navcam.jpg`, 7,703 × 1,678 pixels.
  Downloaded unchanged. Source and SHA-256 are in `public/panoramas/curiosity-navcam.json`.
- **Site:** Curiosity's landing area, approximately 4.5895°S, 137.4417°E.

NASA describes this as a complete 360° cylindrical Navcam panorama. It retains its
original monochrome observations, stitching seams and black unphotographed edges.
The UI uses the same aspect-preserving crop and horizontal wrap as the Jezero image.
No colorization, generated fill, AI upscaling or terrain elevation is added.

## Photo coverage and navigation

Each station resolves to its own NASA photograph. Uncovered locations never fall
back to another site's image. A 150 m proximity match offers the named nearby
station for a route endpoint; it does not claim coverage at the pin itself. Photo
orientation has not been registered to the map, so no geographic compass or route
is overlaid on the photograph. The orbital map shows the station's approximate
location and retains the user's route. Closing the photo restores the prior view.

## Measured elevation terrain (added 4 November 2026)

**Global:** USGS Mars HRSC/MOLA blended DEM, approximately 200 m source spacing,
from NASA MGS/MOLA and ESA Mars Express/HRSC observations. Esri hosts the public
signed elevation samples as lossless LERC tiles, with service quantization/error
reported in its metadata (0.5 m). The geographic CRS is the Mars 2000 sphere,
radius 3,396,190 m, with a 2×1 root grid. This is not Earth's Web Mercator terrain.

- [USGS source catalog](https://astrogeology.usgs.gov/search/map/mars_mgs_mola_mex_hrsc_blended_dem_global_200m)
- [Exact Esri elevation service record](https://astro.arcgis.com/arcgis/rest/services/OnMars/MDEM200M/ImageServer?f=pjson)
- [Esri catalog record](https://www.arcgis.com/home/item.html?id=225adad86379474ebc3d51a74573c99b)

A copy of the service record is in `public/data/provenance/mars-global-terrain-service.json`.
Two level-0 LERC overviews are bundled for degraded/offline fallback. Their coarse
sampling is labeled in the UI. Fine virtual terrain tiles interpolate the measured
source raster to support image refinement; this does not add new elevation detail.
Terrain refinement stops at level 18. Dataset heights are used as radial offsets
on the shared display sphere; no claim of survey-grade vertical registration is made.

**Jezero:** NASA/USGS HiRISE Mars 2020 DTM,
`JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40`.
The [NASA-AMMOS Landform input-data record](https://github.com/NASA-AMMOS/Landform/wiki/Links-to-Publicly-Available-Input-Data)
links both this 1 m DTM and the companion 25 cm orthoimage. The original DTM is
21,400 × 21,488 float32 samples on the Mars equirectangular projection, origin
4,577,366 m east / 1,106,618 m north, with 1 m pixels. A verified HTTP range reader
extracts native pixel centres; source values remain separate from image brightness.

- Native 1 m landing-area grid: 2,049 × 2,049 samples, approximately 2 km square.
- Context: every 16th native sample over the original footprint; 1,338 × 1,343.
- Heights quantized to 0.05 m for delivery (maximum rounding error 0.025 m), then gzip
  compressed. This delivery precision is not a statement of measurement accuracy.
- Nodata remains masked. About 66% of the context raster is valid; global terrain
  fills its gaps. Coverage edges blend over 100 m (landing) / 350 m (context).
- No height exaggeration, generated rocks, procedural hills or AI enhancement.
- Exact extents, scale/offset, source URL and SHA-256 hashes are in `public/terrain/jezero.json`.

## Clear ground imagery

169 original NASA Mars Trek HiRISE PNG tiles at level 17 are bundled near the
landing site. Source pixels are ~25 cm; delivered tile spacing is ~30 cm near
Jezero. `public/data/jezero-detail/manifest.json` records tile bounds and SHA-256
checksums. Runtime mosaics preserve the geographic tile grid and are rendered as a
separate terrain texture patch. Outside this cache, the same native NASA HiRISE
service streams new tiles. CTX or Viking is used outside the HiRISE footprint.
Incomplete imagery is reported rather than filled with invented features.

At eye level, a 5 m CTX pixel necessarily looks broad. The default clarity view
therefore selects 40 m camera clearance for HiRISE, 600 m for CTX and 20 km for
Viking context. These are explicitly view heights, not astronaut eye heights.
The 2 m, 15 m and 60 m manual options remain available. A warm background color
fills the sky; the former plane-based horizon shader is removed, so it cannot
mask mountains that rise above the local horizon.

## Journey and route display

Movement and map distance remain spherical/geographic A–B calculations. The
camera's vertical position follows the measured terrain and stays clear of the
currently rendered mesh. A locally dense orange trail (up to 600 samples, extending at least 700 m or eight viewing heights ahead, bounded by B) is placed 0.75 m above the
terrain for readability; this is a visual offset, not a road. Route pins clamp to
the terrain, and map clicks raycast against it. Geographic paths and original pins
are retained when switching views.

The remaining distance is a direct map distance, not a terrain-aware walking
length. No slope-aware route optimization, cliff avoidance, unresolved-rock
inventory, live positioning or operational safety certification is included.

## Ground truth: Perseverance vs. orbital slope (added 10 November 2026)

**Question.** Does the slope MartisDux computes from orbit match what a vehicle
on the ground actually experienced?

**Data.** NASA MMGIS Mars 2020 localisation records:
[M20_waypoints.json](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json)
(708 waypoints with rover roll, pitch, yaw and tilt) and
[M20_traverse.json](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json)
(559 drives, sols 14–2022, ~45 km). Credit: NASA/JPL-Caltech. SHA-256 of the
files used are recorded in `public/data/perseverance/validation.json`.

**Method** (`scripts/validate-perseverance.py`). Each unique waypoint inside the
Jezero HiRISE DTM is mapped to its native 1 m pixel; native float32 samples are
read by exact HTTP byte range (no resampling). A least-squares plane is fitted
over 3, 5 and 9 m discs, and the app's own 16 m Horn slope is computed. Each is
compared with the rover's recorded tilt. A no-skill baseline (every waypoint =
median rover tilt) shows how much the orbital data actually explains.

**Result** (588 waypoints). The app's 16 m slope map: mean absolute error 1.5°,
r = 0.91, 96% within 5°, slope-class agreement 92%. No-skill baseline: 4.6°.
The 9 m plane fit gives r = 0.93. 21–29 of 193 waypoints where the rover tilted
≥10° appear <10° on the map: sub-DTM rocks and ripples remain a known gap.

**Route check** (`scripts/validate-routes.mjs`). Of 40.4 km of the rover path
over the HiRISE context grid, 0% crosses ground the map classes no-go and
0.17% steep; inside a 500 m corridor around the path, 5.1% of ground is steep or
no-go — Perseverance's drivers avoided it about 30× more than chance. The walking
planner, given only each 1 km leg's endpoints, stayed a median 34.5 m from the
rover's path versus 35.5 m for a straight line: no meaningful difference, since
drivers also steer for rocks, sand and science targets the 16 m grid cannot see.

**Limits.** Rover tilt reflects a ~3 m wheelbase and includes rocks, sinkage and
localisation error. The rover is not a suited astronaut; agreement validates the
terrain model, not human traversability. This is not an operational certification.

## Marswalk planning model (added 10 November 2026)

The Marswalk card turns the safest walking route into an out-and-back suited EVA
plan. All values are planning estimates with stated sources, editable in the app;
none is a NASA flight rule.

| Quantity | Model | Default |
| --- | --- | --- |
| Walking speed | Tobler hiking function, scaled so level ground = suited speed | 0.9 m/s |
| Metabolic rate | Pandolf load-carriage equation; load and movement terms × Mars/Earth gravity (3.721/9.807) | crew 75 kg, suit + life support 70 kg, tools 10 kg, terrain η = 1.3 |
| Oxygen | 20.1 kJ per litre O₂ (RQ ≈ 0.85), 1.429 g/L | — |
| Radiation | Curiosity RAD surface dose equivalent, 0.64 ± 0.12 mSv/sol (Hassler et al., *Science* 343, 2014) | — |
| Suit budget | xEMU-class design EVA duration | 8 h, 45 min untouchable reserve |
| Science time | per stop | 30 min |
| Daylight | Sun ≥ 10° above the horizon, Mars24 algorithm (Allison & McEwen 2000) | — |

**Walk-back guarantee.** A Dijkstra search over every cell of the largest
bundled DTM around base (Jezero: 669 × 672 cells at 32 m, ~0.3–0.9 s in a Web
Worker) gives the fastest suited walking time home from anywhere. At every point
of the walk out, elapsed time + walk home must fit in the budget minus reserve;
the first point that fails is reported as the point of no return. Each grid step
uses the slower uphill speed of its two cells (direction-free, conservative).
The same field gives the worst-case time to shelter for a solar particle event
warning, and is drawn as 30-minute rings with the round-trip limit.

**Science stops.** 27 sealed Perseverance samples from NASA's
[sample list](https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/),
each placed at the rover's last MMGIS waypoint on or before its sol sealed
(`scripts/prepare-science.py`). Sites within 150 m of a route count as stops.

**Mars clock.** `src/mars-time.js` reproduces the Mars24 reference epoch
(Ls 277.1876°, MST 23:59:39 at 2000-01-06 00:00 UTC) and Perseverance's
mid-afternoon landing; both are unit tests.

## Surface conditions (added 10 November 2026)

**Latest report.** Curiosity REMS daily summary from NASA's public weather feed
(`mars.nasa.gov/rss/api/?feed=weather&category=msl`), fetched live when online
and labelled as a saved copy when served offline. REMS summaries are produced
by Centro de Astrobiología (CAB) for outreach; scientific data are in the PDS.

**Season forecast.** `scripts/prepare-weather.py` bins all 4,745 REMS sols
(2012-08-07 to 2026-08-25) by solar longitude in 10° bins and stores the 10th,
50th and 90th percentiles of air and ground temperature and pressure, and UV
index frequencies. The Marswalk card shows the bin for the walk's Ls (from the
Mars24 clock). This is measured Gale climatology, not a Jezero forecast.

**Jezero vs Gale.** Perseverance MEDA's public feed ends in April 2024. On the
4 sols both feeds report (2024-04-24 to 27, Ls ~242°), Jezero was ~10 °C colder
at night and ~24 °C colder by day than Gale. Four sols in one season do not
make a general offset; the app states the comparison without applying it.

**Dust season.** Ls 180–360° is flagged; the planet-encircling dust storms of
2001, 2007 and 2018 began in this half of the Mars year.

## Offline operation (added 10 November 2026)

A service worker (`public/sw.js`) stores the entire built app at first visit:
every file listed in `precache.json` (generated at build, 552 files, ~58 MB),
including Cesium's lazily loaded workers, both HiRISE DTMs, rover data and
weather records. NASA imagery tiles are cached as they are viewed (up to 15,000),
and "Pack this walk for offline" pre-fetches every HiRISE, CTX, Viking, THEMIS
and MOLA tile over the route's area. Cache names carry the build's content hash,
so a redeploy never serves stale data. Verified by loading the production build,
stopping the server, and planning the Jezero Marswalk with no server running.

## Live data (added 10 November 2026)

| Feed | Source | Refresh | Offline behaviour |
| --- | --- | --- | --- |
| Solar storms (CME arrivals at Mars) | NASA DONKI via api.nasa.gov (`/DONKI/CME`, `/DONKI/SEP`), WSA-ENLIL impact forecasts for location "Mars" | On launch, then hourly (cached 1 h; DEMO_KEY allows 30 requests/hour, a free personal key can be entered) | Last fetched result, labelled with its time |
| Perseverance position and path | NASA MMGIS `M20_waypoints.json`, `M20_traverse.json` | Every launch | Last fetched copy, labelled "saved copy" |
| Curiosity weather | NASA/CAB REMS feed | Every launch | Last fetched copy, labelled |
| Jezero clock | Computed (Mars24) | Every 10 s | Works offline |

**Space weather rule.** A walk is NO-GO if a CME is forecast to hit Mars directly
within ±12 h of the walk (ENLIL arrival errors are typically several hours), and
CAUTION for a glancing blow. Solar energetic particles that can accompany a CME
are the main acute radiation risk outside a habitat.

**Mission sols** use local mean solar time at each landing site (sol 0 = landing):
`floor(MSD + longitude/360) − offset`, offsets 52304 (Perseverance) and 49269
(Curiosity). Verified against NASA's MEDA (sol 1133 on 2024-04-27) and REMS
(sol 4995 on 2026-08-25) feeds.

**What is not live, by nature:** orbital imagery (archived observations taken
over many years) and elevation models (terrain does not change on these
timescales). The Rover check statistics are computed from a fixed snapshot so
they stay reproducible; the drawn path and the rover marker are live.

## Tabletop AR model (added 10 November 2026)

`scripts/ar-route.mjs` computes the demo Marswalk with the app's own planner
(Jezero 1 m DTM, 4 m routing cells: 902 m, max slope 9°). `scripts/build-ar-model.py`
builds binary glTF models of an 868 × 1,274 m area around it:

- **Terrain:** the bundled native 1 m HiRISE DTM, bilinearly sampled every 6 m
  (34,845 vertices). No smoothing, generated relief or AI. Two versions:
  true vertical scale and ×3 relief (labelled as exaggerated).
- **Surface:** 54 HiRISE orthomosaic tiles (Mars Trek, level 16, ~0.64 m/px),
  mosaicked on the same geographic grid and cropped to the model area.
- **Route ribbon and pins:** the planned route, base, and Perseverance sample
  sites; widths and pin heights are symbolic so they are visible at 1:2,123.
- **Validation:** both GLBs pass the Khronos glTF Validator with 0 errors and
  0 warnings (`node scripts/validate-glb.mjs`).

The AR page (`ar/index.html`) uses Google model-viewer 4.4.0: Android opens
Scene Viewer / WebXR, iPhone opens AR Quick Look (USDZ generated on device).
Phones need the page at a public HTTPS address; `npm run build:ar-site` produces
a standalone copy for hosting.

## NASA Space Apps challenge resources (added 13 November 2026)

The challenge resource list named five NASA resources. This is how each one is used:

| Resource | How MartisDux uses it |
| --- | --- |
| **JPL Mars Trek** | The main tile source for Viking, HiRISE Jezero, THEMIS, MOLA and now the geologic map (`trek.nasa.gov/tiles`, `trekarcgis`). The Trek search service was used to find the products. |
| **USGS–NASA Planetary Geologic Mapping Program** | New **Geology** view and **"Geology underfoot"** on every Marswalk plan, from the standard *Geologic Map of Mars* (SIM 3292). |
| **Curiosity route map example** | New **second ground-truth site**: Curiosity's real Gale/Mount Sharp traverse from NASA MMGIS, checked against our Gale 1 m slope map. |
| **Mars Perseverance Raw Images** | New **real ground photos** on each route, placed by the rover's site/drive counter, plus clickable photo spots on the map. |
| **NASA Worldview** | Not used. Worldview shows Earth satellite imagery, and this tool is about the Martian surface. |

### Geologic Map of Mars (USGS SIM 3292)

- Tanaka, K.L., Skinner, J.A., Jr., Dohm, J.M., Irwin, R.P., III, Kolb, E.J., Fortezzo, C.M., Platz, T., Michael, G.G., and Hare, T.M., 2014, *Geologic map of Mars*: U.S. Geological Survey Scientific Investigations Map 3292, scale 1:20,000,000. https://doi.org/10.3133/sim3292
- Display tiles: NASA Mars Trek layer `SIM3292_Global_Geology` (official USGS symbology), drawn at 62% opacity over the imagery.
- Unit lookup: `scripts/prepare-geology.py` reads `SIM3292_Global_Geology.shp` from the USGS GIS download (`sim3292_database.zip`) and fills the 1,311 polygons even-odd. It rasterises them at 32 px/° and takes a majority vote down to a 16 px/° grid (`public/data/geology/units.png`, 0.34 MB, 100% coverage, 44 units). The shapefile's SHA-256 is recorded in `units.json`.
- Ages use the epoch boundaries from the paper (Hartmann–Neukum chronology) and are approximate. Codes that span two periods (e.g. `HNt`) show the full range.
- **Limits:** at 1:20M scale the unit contacts are placed to about 5–10 km. This is regional context for a walk, not outcrop-scale geology. Spot checks: Olympus Mons → `Ave` (Amazonian volcanic edifice), north pole → `lApc`, Jezero → `HNt`, Gale → `Htu`.

### Perseverance raw images, placed on the map

- API: `https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=<sol>` (the feed behind the Raw Images gallery).
- Every raw image records the rover's `site` and `drive`, which together form the RMC location counter. Each MMGIS waypoint (`M20_waypoints.json`) carries the same counter. `scripts/prepare-ground-photos.py` matches the two exactly, with no guessing from timestamps. For each place it keeps up to 8 full-frame Navcam-left images spread by mast azimuth, plus 4 Mastcam-Z-left RGB images and 1 Front Hazcam-left image.
- Output: `public/data/perseverance/ground-photos.json`. This is an index only. The image pixels stay on NASA's server and are cached on the device once viewed, or when a walk is packed for offline use.
- Raw images are unprocessed and not colour-calibrated. Credit: NASA/JPL-Caltech (Navcam, Hazcam), NASA/JPL-Caltech/ASU (Mastcam-Z).

### Second ground-truth site: Curiosity at Gale

- Waypoints and tilt come from NASA MMGIS `MSL_waypoints.json`, and the traverse from `MSL_traverse.json`.
- The DTM is the USGS MSL Gale Merged DEM 1 m (v3). The script reads native float32 samples from the LZW strips by exact HTTP byte range.
- `scripts/validate-curiosity.py` uses the same method and footprints as the Perseverance check. Output: `public/data/curiosity/validation.json` and `traverse.json`.

### Geologic Map of Jezero Crater and the Nili Planum Region (USGS SIM 3464), hyperlocal

- Sun, V., and Stack, K., 2020, *Geologic map of Jezero crater and the Nili Planum region, Mars*: U.S. Geological Survey Scientific Investigations Map 3464, pamphlet 14 p., 1 sheet, scale 1:75,000. https://doi.org/10.3133/sim3464 (USGS–NASA Planetary Geologic Mapping Program).
- GIS: `https://pubs.usgs.gov/sim/3464/sim3464_database.zip`. Only `Geodatabase/Nili.gdb` (layer `GeoUnits_v1`, 1,304 polygons, 14 units, Mars Transverse Mercator, central meridian 77.5° E) is used. The 349 MB zip is mostly rasters, so the geodatabase members were fetched with HTTP range requests.
- `scripts/prepare-jezero-geology.py` (pyogrio, pyproj, shapely, Pillow) rasterises the polygons at 20 m in the map projection, then resamples to a lon/lat grid at 3,000 px/° (`public/data/geology/jezero/units.png`, 3017 × 3006, 76.796–77.802° E, 17.699–18.701° N), plus a colour overlay and `units.json`.
- Unit notes are plain-language summaries of the pamphlet's interpretations (and Perseverance's finding that the crater floor is igneous). The `Aeb` eolian bedform unit is flagged as a walking/rover hazard (soft sand).
- Spot checks: Octavia E. Butler landing site → `Njf` (Jezero floor); delta front near Hawksbill Gap → `NHjf2`; west rim → `cr`.
- **Limits:** the map was drawn on a semi-controlled CTX mosaic, so contacts can be offset by ~100–200 m (USGS readme). Outcrops under 0.02 km² are not mapped.

## Mission Control on board (added 14 November 2026)

### Live Earth–Mars radio delay

- `src/earth-link.js` computes the heliocentric positions of Earth and Mars from JPL's approximate Keplerian elements (E. M. Standish, valid 1800–2050, https://ssd.jpl.nasa.gov/planets/approx_pos.html) and converts the distance to one-way light time (499.004784 s per au). Nothing is fetched: it works offline.
- Check (`src/earth-link.test.js`): 18 February 2021, Perseverance's landing day, gives 11 min 22 s, the figure NASA published. Accuracy is a few seconds, so the display shows whole seconds only.

### GO/NO-GO poll and live walk

- `src/mission-control.js` (pure, tested): the walk's timeline, the crew's position at any moment, the fastest way home traced through the walk-back field, radio line of sight (10 m mast at base, 2 m suit antenna, planet curvature included) and the decision for each drill.
- The drills are scenarios, not forecasts. Assumptions: solar storm = 20 minutes of warning (NASA reported that particles from the 20 May 2024 event reached Mars "in just tens of minutes"); suit leak = 40 minutes of air; injury = half walking speed; rover breakdown = walk home (Apollo's walkback constraint).
- Design model: Apollo 15 traverse planning kept every point inside a walkback limit (rover failure) and a rideback limit (life-support failure). NASA Apollo Lunar Surface Journal / NTRS 19790073512.
- The time shown as "decided on board" is the measured computation time on the device.

### Storm shelter: sky hidden by terrain

- `scripts/prepare-shield.py` computes, for every cell, the horizon angle on 36 azimuths (observer 1 m above ground, planet curvature included) and the fraction of the sky hemisphere below it (mean of sin(horizon)). Outputs in `public/data/shield/`: `jezero-context.png` (16 m), `jezero-landing.png` (2 m), `quela.png` (1 m) and `shield.json`. PNG value / 400 = sky hidden; 255 = no data.
- Ground truth, `scripts/validate-rad-shielding.py` → `validation.json`: at the Quela drill site under butte M12, Murray Buttes (Curiosity sols 1456–1467), the RAD team built a sky-visibility map from rover panoramas and found 19% of the sky obstructed, against about 10% on average along the traverse; RAD measured about 4% less dose there (Ehresmann et al. 2021, JGR Planets, https://doi.org/10.1029/2021JE006851; Guo et al. 2021, GRL, https://doi.org/10.1029/2021GL093912, 5 ± 1%).
- Our value from the USGS MSL Gale merged DEM 1 m (within 300 m) plus the 16 m grid (to 60 km), 360 azimuths, no tuning: **19.3%**. Within 2 m of the rover position: 17.8–21.2%. Mean over 347 Curiosity waypoints: 10.2% (median 8.7%).
- **Limits:** this is geometric sky fraction, not a radiation transport model. Terrain is partial cover: the measured dose reduction is a few percent. The 16 m map smooths small cliffs; the observer height changes the Quela value from 17.0% (2 m) to 20.4% (0.5 m). Quote from the RAD principal investigator, Don Hassler, as quoted by NASA: "Cliffsides or lava tubes would provide additional shielding for an astronaut from such an event."

## Life-size walk terrain (added 14 November 2026)

`ar/walk.html` is a first-person, life-size walk (`src/walk/env-*.js`) with a visor display (`src/walk/visor/`, below).
`scripts/build-walk-terrain-dem.mjs` + `scripts/build-walk-terrain.py` build `public/ar/walk-env/`:

- **Walkable ground:** the bundled native 1 m Jezero HiRISE DTM (2,049 × 2,049, byte-identical to
  `public/terrain/jezero-landing.u16.gz`) with Mars Trek HiRISE level-17 tiles (≈0.32 m/px N–S,
  ≈0.30 m/px E–W; level 17 is the service maximum) as 256 unresampled pages, one per 128 m chunk.
- **Beyond ≈1 km:** the Jezero HiRISE DTM context grid (16 m; 34% gaps filled from the 200 m DEM)
  with CTX level 12 (≈5 m/px), then the HRSC/MOLA DEM level 7 (163 m) with CTX level 9 (≈41 m/px)
  for 229 km, then the global DEM and Viking colour. Heights and imagery blend into the coarser
  layer at each boundary; the coarser layer is cut away under the finer one.
- **Display treatment (not data):** monochrome HiRISE/CTX are multiplied by one uniform hue (the
  average Viking MDIM 2.1 colour between 50°S and 50°N); a fixed display sun (azimuth 235°,
  elevation 22°); distance haze (e-folding 22 km); a sky gradient. True vertical scale on the
  3,396,190 m sphere. No procedural grain, sharpening, upscaling or generated relief.

**Illustrative near-ground detail (not data):** within 30 m of the walker only, a generated regolith
texture modulates shading/tone and sparse generated pebbles and small rocks sit on the DEM surface
(`src/walk/env-dressing.js`). They do not alter the mesh or the walk height, may not be to scale, can be
switched off in the start menu (key G), and nothing generated is drawn beyond 30 m.

**Relief ×2 (display only):** by default the walk shows heights exaggerated ×2 about the start elevation
(labelled in the menu, with a true-scale option, key V). Rock clusters are placed using DEM slope and HiRISE
brightness as cues, but the rocks themselves remain illustrative.

The previous walk used one 2,877 × 4,000 texture (level 17, ≈0.30–0.32 m/px) for an 868 × 1,272 m
patch, multiplied procedural noise "grain" into it, fogged at 0.0018/m (96% by 1 km), had a 4 km far
plane and a flat 6 km apron disc beyond the data edge.

### Visor display on the life-size walk (added 15 November 2026)

- **Measured:** heading (camera or XR pose); steepest slope and the edge of 1 m coverage in an 80 m scan of the raw 1 m HiRISE DEM (true scale, independent of Relief ×2); ground elevation under the walker (MOLA areoid); map position on the HiRISE overview.
- **Derived from the route:** distance, turn cues and destination come from the bundled reference route (`public/ar/jezero-marswalk.route.json`, a MartisDux planner output, not safety-certified).
- **Simulated, labelled SIM:** suit oxygen, walk time, metabolic rate and dose use the same models as the planner (`src/eva.js`), advanced by walking time. They are not sensors. Heart rate is not modelled and not shown.
- **Live:** solar storm line from NASA DONKI WSA-ENLIL forecasts (`src/space-weather.js`), marked STALE when offline or older than 6 h and UNKNOWN when unavailable.
- **Shown as unknown:** surface radiation, dust, rocks and soil strength. Crater rims and named landforms are not mapped, so no cue is drawn for them.
- **Not tested:** AR and VR sessions on real devices. The desktop preview was checked.

## Artwork (added 15 November 2026)

- Loading screen helmet: "Astronaut Helmet" by Medhatelo, Sketchfab, CC BY 4.0 (https://sketchfab.com/3d-models/astronaut-helmet-315605194a474c7b95cd2a9083985d22), converted and compressed (`public/models/helmet.glb`, credit page `public/credits/helmet.html`).
- Home screen astronaut (`public/brand/astronaut-home.webp`): an **AI-generated illustration** based on a render of that helmet. It is decoration only, labelled on the Home screen, and is not NASA imagery or data.


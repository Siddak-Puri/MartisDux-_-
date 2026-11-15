export const MARS_RADIUS = 3_396_190;
const trek = 'https://trek.nasa.gov/tiles/Mars/EQ/';
const nasaLayer = (id, extension = 'jpg') => `${trek}${id}/1.0.0/default/default028mm/{z}/{y}/{x}.${extension}`;
const capabilities = (id) => `${trek}${id}/1.0.0/WMTSCapabilities.xml`;

export const DATASETS = {
  viking: {
    title: 'Viking · global color', short: 'VIKING COLOR MOSAIC',
    id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
    url: nasaLayer('Mars_Viking_MDIM21_ClrMosaic_global_232m'),
    tileSize: 256, maximumLevel: 7, sourceMpp: 232,
    credit: 'NASA / JPL / USGS / NASA Ames',
    description: 'Viking orbital imagery gives the whole planet its color context. Zoom closer to transition to MRO detail.',
    detail: 'MDIM 2.1 is a photographic mosaic. Its color is a processed composite, rather than a live view or uniform natural-color measurement.',
    coverage: 'Global', sourceLabel: '232 m/px source · 326 m/px finest tiles at equator',
    source: 'https://astrogeology.usgs.gov/search/map/mars_viking_colorized_global_mosaic_232m',
    capabilities: capabilities('Mars_Viking_MDIM21_ClrMosaic_global_232m'),
  },
  ctx: {
    title: 'MRO · CTX V01', short: 'CTX GLOBAL DETAIL',
    id: 'Global CTX Mosaic of Mars V01',
    url: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{z}/{y}/{x}',
    tileSize: 512, maximumLevel: 12, sourceMpp: 5,
    bounds: [-180, -88, 180, 88],
    credit: 'NASA / JPL / MSSS / Caltech Murray Lab · tiles: Esri',
    description: 'A global mosaic from MRO’s Context Camera. Monochrome imagery reveals craters, channels and surface texture.',
    detail: 'The V01 semi-controlled mosaic combines 86,571 CTX images and covers 99.5% of Mars between 88°S and 88°N. Image seams and gaps remain. The Esri stream is a beta service; the underlying NASA observations are archived in PDS.',
    coverage: '99.5% between 88°S and 88°N', sourceLabel: '5 m/px source · 5.1 m/px finest tiles at equator',
    source: 'https://murray-lab.caltech.edu/CTX/',
    capabilities: 'https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer?f=pjson',
    nasaSource: 'https://www.jpl.nasa.gov/news/new-interactive-mosaic-uses-nasa-imagery-to-show-mars-in-vivid-detail/',
  },
  hirise: {
    title: 'Jezero · HiRISE', short: 'HIRISE JEZERO DETAIL',
    id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    url: nasaLayer('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png'),
    tileSize: 256, maximumLevel: 17, sourceMpp: 0.25,
    bounds: [77.2229331, 18.3067994, 77.583964, 18.669315],
    credit: 'NASA / JPL-Caltech / University of Arizona / USGS',
    description: 'A HiRISE orthomosaic of part of Jezero. This limited footprint provides the closest orbital view in this release.',
    detail: '25 cm source pixels do not imply 25 cm location accuracy. Draped over measured elevation terrain, with a native 1 m HiRISE DTM near the landing site and broader context elsewhere. Terrain sampling and image pixels have separate resolutions.',
    coverage: '77.223–77.584°E · 18.307–18.669°N', sourceLabel: '25 cm/px source · ~30 cm/px finest tiles near Jezero',
    source: 'https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label=JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    capabilities: capabilities('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd'),
  },
  themis: {
    title: 'Odyssey · THEMIS infrared', short: 'THEMIS DAYTIME INFRARED',
    id: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
    url: nasaLayer('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018', 'png'),
    tileSize: 256, maximumLevel: 9, sourceMpp: 100,
    bounds: [-179.9999997, -65.0006576, 179.9998849, 65.0007535],
    credit: 'NASA / JPL / ASU / USGS',
    description: 'Daytime infrared reveals surface patterns through thermal emission. Viking remains visible outside the infrared coverage.',
    detail: 'Controlled mosaic, v2 October 2018. Brightness represents infrared image contrast, not a live temperature scale or current conditions.',
    coverage: 'Approximately 65°S to 65°N', sourceLabel: '100 m/px source · historical infrared mosaic',
    source: 'https://trek.nasa.gov/mars/TrekWS/rest/cat/metadata/fgdc/html?label=THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
    capabilities: capabilities('THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018'),
  },
  mola: {
    title: 'MGS · MOLA shaded relief', short: 'MOLA COLOR-SHADED RELIEF',
    id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
    url: nasaLayer('Mars_MGS_MOLA_ClrShade_merge_global_463m'),
    tileSize: 256, maximumLevel: 7, sourceMpp: 463,
    credit: 'NASA / MGS / MOLA Science Team / USGS',
    description: 'Color-shaded relief derived from laser altimetry shows the planet’s broad topographic structure.',
    detail: 'This is a rendered relief map, not raw elevation values. The separate terrain provider supplies numerical HRSC/MOLA and Jezero HiRISE heights; this colored raster supplies visual context only.',
    coverage: 'Global', sourceLabel: '463 m/px source · rendered relief',
    source: 'https://astrogeology.usgs.gov/search/map/mars_mgs_mola_global_color_shaded_relief_463m',
    capabilities: capabilities('Mars_MGS_MOLA_ClrShade_merge_global_463m'),
  },
  geology: {
    title: 'USGS · Geologic map of Mars', short: 'USGS SIM 3292 GEOLOGY',
    id: 'SIM3292_Global_Geology',
    url: 'https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/WMTS/tile/1.0.0/SIM3292_Global_Geology/default/default028mm/{z}/{y}/{x}.png',
    tileSize: 256, maximumLevel: 11, sourceMpp: 5000,
    credit: 'USGS Astrogeology (Tanaka et al. 2014, SIM 3292) · tiles: NASA Mars Trek',
    description: 'The USGS–NASA standard geologic map: rock units colored by type and age, over the Viking and CTX imagery. Point anywhere to name the unit.',
    detail: 'Geologic Map of Mars, USGS Scientific Investigations Map 3292 (Tanaka et al. 2014), scale 1:20,000,000, produced under the USGS–NASA Planetary Geologic Mapping Program. 44 units. Contacts are placed to roughly 5–10 km, so this is regional context for planning, not outcrop-scale geology. Ages follow the paper’s Hartmann–Neukum epoch boundaries and are approximate. Unit lookups use a 16 px/degree grid rasterised from the official polygons and work offline.',
    coverage: 'Global', sourceLabel: '1:20,000,000 map · 16 px/° offline lookup grid',
    source: 'https://doi.org/10.3133/sim3292',
    capabilities: 'https://trek.nasa.gov/tiles/Mars/EQ/SIM3292_Global_Geology/1.0.0/WMTSCapabilities.xml',
    nasaSource: 'https://trek.nasa.gov/mars/',
  },
};

export const PLACES = [
  { id: 'olympus', name: 'Olympus Mons', type: 'Shield volcano', lat: 18.65, lon: -133.8, height: 650_000, source: 'https://planetarynames.wr.usgs.gov/Feature/4453' },
  { id: 'valles', name: 'Valles Marineris', type: 'Canyon system', lat: -14.01, lon: -58.59, height: 1_450_000, source: 'https://planetarynames.wr.usgs.gov/Feature/6288' },
  { id: 'jezero', name: 'Jezero Crater', type: 'Perseverance landing area', lat: 18.4446, lon: 77.4509, height: 16_000, source: 'https://science.nasa.gov/mission/mars-2020-perseverance/location-map/' },
  { id: 'gale', name: 'Gale Crater', type: 'Curiosity landing area', lat: -4.5895, lon: 137.4417, height: 110_000, source: 'https://science.nasa.gov/mission/msl-curiosity/location-map/' },
];

export function normalizeLongitude(value) {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function parseCoordinates(input) {
  const match = input.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;]\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!match) return null;
  let lat = Number(match[1]);
  let lon = Number(match[3]);
  if (match[2]) lat = Math.abs(lat) * (match[2].toUpperCase() === 'S' ? -1 : 1);
  if (match[4]) lon = Math.abs(lon) * (match[4].toUpperCase() === 'W' ? -1 : 1);
  if (Math.abs(lat) > 90 || lon < -180 || lon > 360) return null;
  return { lat, lon: normalizeLongitude(lon) };
}

export function containsPoint(bounds, lon, lat) {
  return !bounds || (lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3]);
}

export function tileMpp(dataset, latitude = 0) {
  return 2 * Math.PI * MARS_RADIUS / (2 * dataset.tileSize * 2 ** dataset.maximumLevel) * Math.cos(latitude * Math.PI / 180);
}

export function formatCoordinate(value, isLatitude) {
  return `${Math.abs(value).toFixed(3)}° ${isLatitude ? (value < 0 ? 'S' : 'N') : (value < 0 ? 'W' : 'E')}`;
}

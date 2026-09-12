/**
 * @module geoMediaModel
 *
 * Pure data + pose math for the Geo Media layer (`geoMedia.js`).
 *
 * Two jobs, both scene-free so the whole thing is unit-testable under plain
 * node:test:
 *
 *  - `normalizeGeoMediaItem` — validates/clamps one raw pack entry into the
 *    record the layer renders. Items without a finite lat/lon or a usable id
 *    are DROPPED (return null) rather than fabricated into existence: a media
 *    pin whose position is a guess is worse than no pin at all. YouTube
 *    entries get their embed + thumbnail URLs derived from `sourceUrl` when
 *    the pack omits them.
 *  - `computeMediaFrustum` — the camera pose → frustum pyramid, mirroring
 *    `cctv.js`'s `computeFrustumGeometry` (same spherical small-angle
 *    projection) with two deliberate differences: pitch is NOT clamped to a
 *    downward band (a photo may look straight up at a facade), and the far cap
 *    is NOT lifted off the ground (a media plane 6 m out at eye level has no
 *    room for a 2 m clearance nudge).
 *
 * The calibration offset vector is the same 7-DOF shape `cctv.js` uses, so
 * `createCalibrationGizmo` from `cctvGizmo.js` plugs into a media record
 * unchanged.
 */

/** Media kinds a pack may declare. Anything else normalizes to 'photo'. */
export const GEO_MEDIA_KINDS = Object.freeze([
  'photo', 'video', 'streetview', 'aerial', 'historical', 'listing',
]);

/** Defaults applied to any field a pack leaves out. */
export const GEO_MEDIA_DEFAULTS = Object.freeze({
  kind: 'photo',
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 55,
  rangeM: 12,
  heightM: 1.6,
  groundElevationM: 0,
  positionConfidence: 'estimated',
  headingConfidence: 'guess',
});

/** Hard limits — a pack cannot push a pose outside these. */
export const GEO_MEDIA_LIMITS = Object.freeze({
  pitchDeg: [-90, 90],
  fovDeg: [20, 120],
  rangeM: [3, 500],
  heightM: [0, 150],
});

/** Default aspect (w/h) used for the far-plane rectangle until an image loads. */
export const DEFAULT_MEDIA_ASPECT = 16 / 9;

/**
 * Default calibration offsets — same 7-DOF vector as `DEFAULT_CAMERA_CALIBRATION`
 * in cctv.js (copied rather than imported: cctv.js does not export it, and this
 * module must stay free of that 4.8 kloc scene-bound dependency).
 */
export const DEFAULT_MEDIA_CALIBRATION = Object.freeze({
  offsetNorthM: 0,
  offsetEastM: 0,
  headingDeg: 0,
  pitchDeg: 0,
  fovDeg: 0,
  rangeScale: 1,
  heightM: 0,
});

const EARTH_RADIUS_M = 6371000;
const METRES_PER_DEG_LAT = 111320;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function safeNumber(value, fallback = NaN) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeHeading(deg) {
  let v = deg % 360;
  if (v < 0) v += 360;
  return v;
}

function quantize(value, step = 0.1) {
  return Math.round(value / step) * step;
}

function trimmedString(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

/**
 * Sanitizes a calibration offset vector to the same 7 fields the CCTV gizmo
 * drags. Ranges are widened relative to CCTV where the media case demands it:
 * pitch is a full hemisphere (looking up at a gable is normal), and rangeScale
 * spans a wider band because a media range starts at metres, not hundreds.
 * @param {Object} [value={}] - Raw calibration values.
 * @returns {{offsetNorthM:number, offsetEastM:number, headingDeg:number,
 *   pitchDeg:number, fovDeg:number, rangeScale:number, heightM:number}}
 */
export function normalizeMediaCalibration(value = {}) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    offsetNorthM: quantize(clamp(safeNumber(raw.offsetNorthM, 0), -500, 500), 0.1),
    offsetEastM: quantize(clamp(safeNumber(raw.offsetEastM, 0), -500, 500), 0.1),
    headingDeg: quantize(clamp(safeNumber(raw.headingDeg, 0), -180, 180), 0.1),
    pitchDeg: quantize(clamp(safeNumber(raw.pitchDeg, 0), -90, 90), 0.1),
    fovDeg: quantize(clamp(safeNumber(raw.fovDeg, 0), -60, 60), 0.1),
    rangeScale: quantize(clamp(safeNumber(raw.rangeScale, 1), 0.1, 10), 0.01),
    heightM: quantize(clamp(safeNumber(raw.heightM, 0), -50, 150), 0.1),
  };
}

/**
 * True when a calibration is effectively untouched (all offsets at default).
 * @param {Object} calibration
 * @returns {boolean}
 */
export function isDefaultMediaCalibration(calibration) {
  const probe = normalizeMediaCalibration(calibration);
  return Object.keys(DEFAULT_MEDIA_CALIBRATION)
    .every((key) => Math.abs(probe[key] - DEFAULT_MEDIA_CALIBRATION[key]) < 0.0001);
}

/**
 * Extracts a YouTube video id from any of the three URL shapes in the wild:
 * `youtube.com/watch?v=<id>`, `youtu.be/<id>`, `youtube.com/shorts/<id>`.
 * @param {string} url - Candidate source URL.
 * @returns {string|null} 11-character-ish video id, or null when not YouTube.
 */
export function youTubeIdFrom(url) {
  const raw = trimmedString(url);
  if (!raw) return null;
  const valid = (id) => (/^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null);
  const watch = /(?:youtube\.com|youtube-nocookie\.com)\/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]+)/i.exec(raw);
  if (watch) return valid(watch[1]);
  const shorts = /(?:youtube\.com|youtube-nocookie\.com)\/(?:shorts|embed|live)\/([A-Za-z0-9_-]+)/i.exec(raw);
  if (shorts) return valid(shorts[1]);
  const short = /youtu\.be\/([A-Za-z0-9_-]+)/i.exec(raw);
  if (short) return valid(short[1]);
  return null;
}

/**
 * Validates and normalizes one raw pack entry.
 *
 * @param {Object} raw - Entry as it appears in a `public/geo-media/*.json` pack.
 * @param {Object} [packDefaults={}] - Pack-level fallbacks (`groundElevationM`).
 * @returns {Object|null} Normalized item, or null when the entry is unusable
 *   (missing id, or a non-finite / out-of-range lat/lon).
 */
export function normalizeGeoMediaItem(raw, packDefaults = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = trimmedString(raw.id);
  if (!id) return null;
  const lat = safeNumber(raw.lat);
  const lon = safeNumber(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  const kind = GEO_MEDIA_KINDS.includes(raw.kind) ? raw.kind : GEO_MEDIA_DEFAULTS.kind;
  const sourceUrl = trimmedString(raw.sourceUrl);
  let thumbnailUrl = trimmedString(raw.thumbnailUrl);
  let imageUrl = trimmedString(raw.imageUrl);
  let embedUrl = trimmedString(raw.embedUrl);

  if (kind === 'video') {
    const videoId = youTubeIdFrom(embedUrl) || youTubeIdFrom(sourceUrl);
    if (videoId) {
      if (!embedUrl) embedUrl = `https://www.youtube-nocookie.com/embed/${videoId}`;
      if (!thumbnailUrl) thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    }
  }
  // The plane texture always has something to draw: a missing thumbnail falls
  // back to the full image and vice versa.
  if (!thumbnailUrl) thumbnailUrl = imageUrl;
  if (!imageUrl) imageUrl = thumbnailUrl;

  const groundElevationM = safeNumber(
    raw.groundElevationM,
    safeNumber(packDefaults.groundElevationM, GEO_MEDIA_DEFAULTS.groundElevationM),
  );

  return {
    id,
    name: trimmedString(raw.name, id),
    kind,
    lat,
    lon,
    headingDeg: normalizeHeading(safeNumber(raw.headingDeg, GEO_MEDIA_DEFAULTS.headingDeg)),
    pitchDeg: clamp(safeNumber(raw.pitchDeg, GEO_MEDIA_DEFAULTS.pitchDeg), ...GEO_MEDIA_LIMITS.pitchDeg),
    fovDeg: clamp(safeNumber(raw.fovDeg, GEO_MEDIA_DEFAULTS.fovDeg), ...GEO_MEDIA_LIMITS.fovDeg),
    rangeM: clamp(safeNumber(raw.rangeM, GEO_MEDIA_DEFAULTS.rangeM), ...GEO_MEDIA_LIMITS.rangeM),
    heightM: clamp(safeNumber(raw.heightM, GEO_MEDIA_DEFAULTS.heightM), ...GEO_MEDIA_LIMITS.heightM),
    groundElevationM,
    positionConfidence: trimmedString(raw.positionConfidence, GEO_MEDIA_DEFAULTS.positionConfidence),
    headingConfidence: trimmedString(raw.headingConfidence, GEO_MEDIA_DEFAULTS.headingConfidence),
    thumbnailUrl,
    imageUrl,
    sourceUrl,
    embedUrl,
    author: trimmedString(raw.author),
    license: trimmedString(raw.license),
    capturedAt: trimmedString(raw.capturedAt),
    description: trimmedString(raw.description),
  };
}

/**
 * Normalizes a whole pack document: pack identity plus its surviving items.
 * @param {Object} raw - Parsed pack JSON.
 * @param {string} [fallbackId] - Id to use when the pack omits its own.
 * @returns {{id:string, name:string, groundElevationM:number, center:Object|null,
 *   items:Object[]}}
 */
export function normalizeGeoMediaPack(raw, fallbackId = 'pack') {
  const doc = raw && typeof raw === 'object' ? raw : {};
  const groundElevationM = safeNumber(doc.groundElevationM, GEO_MEDIA_DEFAULTS.groundElevationM);
  const packDefaults = { groundElevationM };
  const rawItems = Array.isArray(doc.items) ? doc.items : [];
  const items = [];
  const seen = new Set();
  for (const entry of rawItems) {
    const item = normalizeGeoMediaItem(entry, packDefaults);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return {
    id: trimmedString(doc.id, fallbackId),
    name: trimmedString(doc.name, trimmedString(doc.id, fallbackId)),
    groundElevationM,
    center: doc.center && typeof doc.center === 'object' ? doc.center : null,
    items,
  };
}

/**
 * Applies a calibration offset vector to an item's stored pose.
 * Mirrors `ensureCameraPose` in cctv.js: the STORED pose is the frozen base,
 * the calibration is a delta on top of it.
 * @param {Object} item - Normalized item (its own fields are never mutated).
 * @param {Object} [calibration] - 7-DOF offset vector.
 * @returns {{lat:number, lon:number, headingDeg:number, pitchDeg:number,
 *   fovDeg:number, rangeM:number, heightM:number}}
 */
export function applyMediaCalibration(item, calibration) {
  const cal = normalizeMediaCalibration(calibration);
  const latOffset = cal.offsetNorthM / METRES_PER_DEG_LAT;
  const lonDivisor = Math.max(0.15, Math.cos(toRad(item.lat)));
  const lonOffset = cal.offsetEastM / (METRES_PER_DEG_LAT * lonDivisor);
  return {
    lat: item.lat + latOffset,
    lon: item.lon + lonOffset,
    headingDeg: normalizeHeading(item.headingDeg + cal.headingDeg),
    pitchDeg: clamp(item.pitchDeg + cal.pitchDeg, ...GEO_MEDIA_LIMITS.pitchDeg),
    fovDeg: clamp(item.fovDeg + cal.fovDeg, ...GEO_MEDIA_LIMITS.fovDeg),
    rangeM: clamp(item.rangeM * cal.rangeScale, ...GEO_MEDIA_LIMITS.rangeM),
    heightM: clamp(item.heightM + cal.heightM, ...GEO_MEDIA_LIMITS.heightM),
  };
}

/**
 * Spherical direct-geodesic projection: the point `distanceM` from an origin
 * along a compass bearing. Same formula (and same R) as cctv.js's
 * `projectPoint`, so the two layers' wedges agree to the centimetre.
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {number} bearingDeg
 * @param {number} distanceM
 * @returns {{lat:number, lon:number}}
 */
export function projectMediaPoint(latDeg, lonDeg, bearingDeg, distanceM) {
  const angular = distanceM / EARTH_RADIUS_M;
  const bearing = toRad(bearingDeg);
  const lat1 = toRad(latDeg);
  const lon1 = toRad(lonDeg);
  const sinLat2 = Math.sin(lat1) * Math.cos(angular)
    + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1);
  const x = Math.cos(angular) - Math.sin(lat1) * sinLat2;
  return { lat: toDeg(lat2), lon: toDeg(lon1 + Math.atan2(y, x)) };
}

/**
 * The frustum wedge for one media item: the camera point, the far-plane centre
 * (where the picture hangs), and the plane's 4 corners.
 *
 * Unlike the CCTV variant there is NO ground-clearance clamp on the far cap.
 * A CCTV frustum is hundreds of metres long and a fabricated pitch would bury
 * its monitor; a media wedge is metres long and deliberately points wherever
 * the photographer pointed, including down at the pavement.
 *
 * @param {Object} item - Normalized item.
 * @param {Object} [calibration] - 7-DOF offset vector (defaults to identity).
 * @param {Object} [options={}]
 * @param {number} [options.aspect=16/9] - Far-plane width/height ratio (from
 *   the loaded image once it arrives).
 * @param {number} [options.groundElevationM] - ELLIPSOIDAL ground height that
 *   overrides the item's (orthometric, pack-supplied) value once the layer has
 *   resolved it through terrainHeights.js. Cesium positions are ellipsoidal;
 *   a NAP/MSL value used raw sinks a Dutch pin ~43 m under the 3D tiles.
 * @returns {{headingDeg:number, pitchDeg:number, fovDeg:number, rangeM:number,
 *   heightM:number, aspect:number, vFovDeg:number, halfW:number, halfH:number,
 *   groundElevationM:number,
 *   camera:{lat:number, lon:number, alt:number, heightM:number},
 *   center:{lat:number, lon:number, alt:number},
 *   corners:{tl:Object, tr:Object, br:Object, bl:Object},
 *   labelPoint:{lat:number, lon:number, alt:number}}}
 */
export function computeMediaFrustum(item, calibration, options = {}) {
  const pose = applyMediaCalibration(item, calibration);
  const aspectRaw = safeNumber(options.aspect, DEFAULT_MEDIA_ASPECT);
  const aspect = clamp(Number.isFinite(aspectRaw) && aspectRaw > 0 ? aspectRaw : DEFAULT_MEDIA_ASPECT, 0.1, 10);
  const ground = safeNumber(options.groundElevationM, safeNumber(item.groundElevationM, 0));
  const cameraAlt = ground + pose.heightM;

  const pitch = toRad(pose.pitchDeg);
  const hFov = toRad(pose.fovDeg);
  const R = pose.rangeM;

  const centerLL = projectMediaPoint(pose.lat, pose.lon, pose.headingDeg, R * Math.cos(pitch));
  const centerAlt = cameraAlt + R * Math.sin(pitch);

  const halfW = R * Math.tan(hFov / 2);
  const vFovRad = 2 * Math.atan(Math.tan(hFov / 2) / aspect);
  const halfH = R * Math.tan(vFovRad / 2);

  // In-plane "up" of the pitched cap, split into a vertical part and a
  // horizontal part along the heading (pitch > 0 tilts the top backward).
  const upVert = Math.cos(pitch) * halfH;
  const upHoriz = -Math.sin(pitch) * halfH;

  const capL = projectMediaPoint(centerLL.lat, centerLL.lon, pose.headingDeg - 90, halfW);
  const capR = projectMediaPoint(centerLL.lat, centerLL.lon, pose.headingDeg + 90, halfW);
  const corner = (base, sign) => {
    const ll = projectMediaPoint(base.lat, base.lon, pose.headingDeg, sign * upHoriz);
    return { lat: ll.lat, lon: ll.lon, alt: centerAlt + sign * upVert };
  };

  return {
    headingDeg: pose.headingDeg,
    pitchDeg: pose.pitchDeg,
    fovDeg: pose.fovDeg,
    rangeM: R,
    heightM: pose.heightM,
    aspect,
    vFovDeg: toDeg(vFovRad),
    halfW,
    halfH,
    groundElevationM: ground,
    camera: { lat: pose.lat, lon: pose.lon, alt: cameraAlt, heightM: pose.heightM },
    center: { lat: centerLL.lat, lon: centerLL.lon, alt: centerAlt },
    corners: {
      tl: corner(capL, 1),
      tr: corner(capR, 1),
      br: corner(capR, -1),
      bl: corner(capL, -1),
    },
    labelPoint: corner(centerLL, 1),
  };
}

/**
 * Bakes a live calibrated pose back into a pack item, for EXPORT PACK: the
 * exported JSON carries the calibrated pose as its BASE pose, with the offset
 * vector consumed rather than carried along (an exported pack that still
 * needed a calibration store to look right would be no export at all).
 * @param {Object} item - Normalized item.
 * @param {Object} [calibration] - 7-DOF offset vector.
 * @returns {Object} Pack-shaped item with the calibrated pose baked in.
 */
export function bakeCalibratedItem(item, calibration) {
  const pose = applyMediaCalibration(item, calibration);
  const round = (value, digits) => Number(value.toFixed(digits));
  return {
    ...item,
    lat: round(pose.lat, 8),
    lon: round(pose.lon, 8),
    headingDeg: round(pose.headingDeg, 2),
    pitchDeg: round(pose.pitchDeg, 2),
    fovDeg: round(pose.fovDeg, 2),
    rangeM: round(pose.rangeM, 2),
    heightM: round(pose.heightM, 2),
  };
}

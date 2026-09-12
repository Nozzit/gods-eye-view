/**
 * @module geoMedia
 *
 * Geo Media — internet-found photos and videos of a place, planted on the
 * globe at the position they were SHOT FROM.
 *
 * Each item draws up to four entities — no more, because a pack can hold ~130
 * items inside a 100 m circle:
 *  - a pin at the photographer's camera position (coloured by media kind),
 *  - ONE polyline tracing the whole frustum wedge (4 corner rays + the far
 *    rectangle) showing where the lens was pointed,
 *  - the picture itself, hanging on the far plane of that wedge — the same
 *    "monitor plane" technique the CCTV layer uses for a live feed, so the
 *    image lines up with the real 3D buildings behind it, and
 *  - a name label, for the kinds worth naming (see LABELED_KINDS).
 *
 * A viewpoint-only kind — `streetview`, where all we have is a pano id, a
 * position and a bearing — gets a smaller, dimmer pin and a short wedge, with
 * no plane and no label.
 *
 * Poses found on the open web are rarely exact (EXIF gives a position, almost
 * never a bearing), so every item is hand-adjustable: ADJUST attaches the
 * CCTV calibration gizmo (`cctvGizmo.js`, unmodified) to the selected item,
 * SAVE persists the 7-DOF offset vector under
 * `godsEyeView.geoMedia.calibration.v1`, and EXPORT PACK writes a new pack
 * JSON with the corrected poses baked in. Dragging alone never persists —
 * same save-gating as the CCTV layer.
 *
 * Data is static JSON from `public/geo-media/*.json` (see GEO_MEDIA_PACKS).
 * There is no server proxy: the browser loads every image itself. A plane
 * texture must be CORS-clean, so it is only attached after an
 * `Image` with `crossOrigin='anonymous'` has decoded; a host that sends no
 * `Access-Control-Allow-Origin` (estate-agent sites, for one) simply keeps the
 * flat tinted pane. The panel shows that same picture through a plain `<img>`,
 * which needs no CORS — so a missing header costs the plane, never the photo.
 * Every field is optional: a missing image, author, or capture date renders as
 * absence, not as a crash.
 *
 * KNOWN LIMITATION (deliberate, to keep `cctvGizmo.js` untouched): the gizmo
 * hard-codes its handle entity ids, so only ONE layer may be in ADJUST mode at
 * a time. This layer creates its gizmo when ADJUST turns on and destroys it
 * when ADJUST turns off; if CCTV's ADJUST was on at the same moment, toggle it
 * off and on again to get its handles back.
 *
 * All entities live in one `CustomDataSource`, so enable/disable is a single
 * `show` flip.
 */
import * as Cesium from 'cesium';

import { createCalibrationGizmo, GIZMO_ID_PREFIX } from './cctvGizmo.js';
import {
  isOwnedByOtherLayer,
  registerPickOwner,
  resolvePickId,
  unregisterPickOwner,
} from './pickRegistry.js';
import { bindTrackingClickGesture, isTrackingClickGesture } from './trackingClickGesture.js';
import { holdContinuousRender, releaseContinuousRender } from '../renderGovernor.js';
import { resolveEllipsoidalGround } from './terrainHeights.js';
import {
  DEFAULT_MEDIA_ASPECT,
  DEFAULT_MEDIA_CALIBRATION,
  bakeCalibratedItem,
  computeMediaFrustum,
  isDefaultMediaCalibration,
  normalizeGeoMediaPack,
  normalizeMediaCalibration,
  projectMediaPoint,
} from './geoMediaModel.js';

/**
 * Packs to load, in order. Static files under `public/`; append more here as
 * they are curated — nothing else in the layer is pack-aware.
 * @type {string[]}
 */
export const GEO_MEDIA_PACKS = ['/geo-media/gouda.json'];

/** Per-item calibration store key (v1 — offsets only, no pose copies). */
export const GEO_MEDIA_CALIBRATION_STORAGE_KEY = 'godsEyeView.geoMedia.calibration.v1';

/** Entity id prefix for everything this layer draws. */
const ENTITY_PREFIX = 'geo-media-';
/**
 * Roles appended to `geo-media-<itemId>-` for the layer's entity ids.
 *
 * A pack can hold ~130 items inside a 100 m circle, so the budget is deliberately
 * tight: ONE pin, ONE polyline tracing the whole wedge wireframe, and at most one
 * plane and one label. The wedge used to be five separate polyline entities; the
 * single traced path halves the entity count at identical pixels.
 */
const ENTITY_ROLE_PATTERN = /^geo-media-(.+)-(pin|label|wedge|plane)$/;
/** Name labels only appear once the viewer is this close (metres). */
const LABEL_VISIBLE_RANGE_M = 600;
/**
 * Kinds that carry a name label. Street View panoramas are excluded on purpose:
 * a 100 m circle can hold ~90 of them and the labels would be a solid wall of
 * text over the very buildings the layer exists to show.
 */
const LABELED_KINDS = Object.freeze(new Set(['photo', 'video', 'historical', 'listing']));
/** Kinds that never get an image plane (no media to hang — just a viewpoint). */
const PLANELESS_KINDS = Object.freeze(new Set(['streetview']));
/** How far behind / above the item's camera the select flight parks. */
const SELECT_STANDOFF_M = 7;
const SELECT_LIFT_M = 2.5;

/** Pin + wedge colour per media kind. */
const KIND_COLORS = Object.freeze({
  photo: Cesium.Color.fromCssColorString('#3fe0ff'),
  video: Cesium.Color.fromCssColorString('#ff6b3d'),
  historical: Cesium.Color.fromCssColorString('#ffc043'),
  listing: Cesium.Color.fromCssColorString('#5ce08a'),
  streetview: Cesium.Color.fromCssColorString('#e8f4ff'),
  aerial: Cesium.Color.fromCssColorString('#e8f4ff'),
});

let _viewer = null;
let _dataSource = null;
let _records = [];
let _recordById = new Map();
let _calibrationById = new Map();
let _selectedId = null;
let _enabled = false;
let _calibrationMode = false;
let _gizmo = null;
let _clickHandler = null;
let _keydownListener = null;
let _panel = null;
let _lastError = null;
let _loaded = false;
let _loadPromise = null;

/** @returns {Cesium.Color} Colour for a media kind. */
function colorForKind(kind) {
  return KIND_COLORS[kind] || KIND_COLORS.photo;
}

function toRad(deg) {
  return Cesium.Math.toRadians(deg);
}

/** @returns {Storage|null} `window.localStorage`, or null when unreachable. */
function safeStorage() {
  if (typeof window === 'undefined') return null;
  try {
    // The property ACCESS itself throws under "block all cookies".
    return window.localStorage || null;
  } catch {
    return null;
  }
}

/** Loads the persisted per-item calibration offsets. */
function loadCalibrationStore() {
  _calibrationById = new Map();
  const storage = safeStorage();
  if (!storage) return;
  try {
    const parsed = JSON.parse(storage.getItem(GEO_MEDIA_CALIBRATION_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object') return;
    for (const [id, entry] of Object.entries(parsed)) {
      const values = entry && typeof entry === 'object' ? (entry.values ?? entry) : null;
      if (!values || typeof values !== 'object') continue;
      _calibrationById.set(id, {
        values: normalizeMediaCalibration(values),
        savedAt: Number(entry?.savedAt) || 0,
      });
    }
  } catch (error) {
    console.warn('[Data:GeoMedia] calibration store unreadable:', error?.message || error);
  }
}

/** Writes the calibration store back to localStorage. */
function saveCalibrationStore() {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(
      GEO_MEDIA_CALIBRATION_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(_calibrationById)),
    );
  } catch (error) {
    console.warn('[Data:GeoMedia] calibration store unwritable:', error?.message || error);
  }
}

/**
 * Re-derives a record's live pose from its frozen base item + calibration.
 * Mirrors `ensureCameraPose` in cctv.js so the gizmo reads the same contract:
 * `camera.basePose` / `camera.calibration` / `camera.intrinsics` /
 * `camera.extrinsics` / `camera.anchor`.
 * @param {Object} record - Media record.
 */
function ensureMediaPose(record) {
  const { item, camera } = record;
  if (!camera.basePose) {
    camera.basePose = {
      lat: item.lat,
      lon: item.lon,
      headingDeg: item.headingDeg,
      pitchDeg: item.pitchDeg,
      fovDeg: item.fovDeg,
      rangeM: item.rangeM,
      heightM: item.heightM,
    };
  }
  camera.calibration = normalizeMediaCalibration(camera.calibration || DEFAULT_MEDIA_CALIBRATION);
  const geometry = computeMediaFrustum(item, camera.calibration, {
    aspect: record.aspect,
    groundElevationM: record.groundEllipsoidalM,
  });
  camera.lat = geometry.camera.lat;
  camera.lon = geometry.camera.lon;
  camera.headingDeg = geometry.headingDeg;
  camera.pitchDeg = geometry.pitchDeg;
  camera.fovDeg = geometry.fovDeg;
  camera.rangeM = geometry.rangeM;
  camera.heightM = geometry.heightM;
  camera.intrinsics = { fovDeg: geometry.fovDeg, principalPoint: [0.5, 0.5] };
  camera.extrinsics = {
    headingDeg: geometry.headingDeg,
    pitchDeg: geometry.pitchDeg,
    rollDeg: 0,
    heightM: geometry.heightM,
  };
  camera.anchor = { lat: geometry.camera.lat, lon: geometry.camera.lon, elevM: geometry.groundElevationM };
  return geometry;
}

/**
 * Converts a frustum geometry into the Cartesian3 set the entities consume.
 * Field names match the CCTV gizmo's expectations (`mount`, `capCenter`,
 * `tl`/`tr`/`br`/`bl`).
 * @param {Object} geometry - Result of `computeMediaFrustum`.
 * @returns {Object}
 */
function frustumCartesians(geometry) {
  const at = (p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt);
  return {
    mount: Cesium.Cartesian3.fromDegrees(geometry.camera.lon, geometry.camera.lat, geometry.camera.alt),
    capCenter: at(geometry.center),
    tl: at(geometry.corners.tl),
    tr: at(geometry.corners.tr),
    br: at(geometry.corners.br),
    bl: at(geometry.corners.bl),
    label: at({ ...geometry.labelPoint, alt: geometry.labelPoint.alt + 0.8 }),
  };
}

/**
 * One continuous polyline path that draws the whole wedge: the four corner rays
 * plus the closed far rectangle. The wheel graph has four odd-degree vertices,
 * so a single stroke cannot cover it without repeats — three spokes are
 * retraced, and a retraced segment is invisible because it lands exactly on
 * itself.
 * @param {Object} p - Result of `frustumCartesians`.
 * @returns {Cesium.Cartesian3[]}
 */
function wedgePath(p) {
  return [p.mount, p.tl, p.tr, p.br, p.bl, p.tl, p.mount, p.tr, p.mount, p.br, p.mount, p.bl];
}

/**
 * Orientation quaternion for the image plane: local +Z is the plane normal
 * pointing BACK along the view axis toward the camera position, so the texture
 * reads correctly from the viewpoint the select-flight parks at. Local +X is
 * viewer-right and +Y is frame-up, so the image maps upright and unmirrored.
 * Copied from the CCTV monitor-plane technique (`planeOrientationFor`).
 * @param {Object} camera - Live pose (headingDeg, pitchDeg).
 * @param {Cesium.Cartesian3} centerPos - Plane centre in ECEF.
 * @returns {Cesium.Quaternion}
 */
function planeOrientationFor(camera, centerPos) {
  const h = toRad(camera.headingDeg);
  const p = toRad(camera.pitchDeg);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(centerPos);
  const rot = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3());
  const dirEnu = new Cesium.Cartesian3(
    Math.sin(h) * Math.cos(p),
    Math.cos(h) * Math.cos(p),
    Math.sin(p),
  );
  const upEnu = new Cesium.Cartesian3(
    -Math.sin(p) * Math.sin(h),
    -Math.sin(p) * Math.cos(h),
    Math.cos(p),
  );
  const dir = Cesium.Matrix3.multiplyByVector(rot, dirEnu, new Cesium.Cartesian3());
  const up = Cesium.Matrix3.multiplyByVector(rot, upEnu, new Cesium.Cartesian3());
  const right = Cesium.Cartesian3.cross(dir, up, new Cesium.Cartesian3());
  const normal = Cesium.Cartesian3.negate(dir, new Cesium.Cartesian3());
  return Cesium.Quaternion.fromRotationMatrix(new Cesium.Matrix3(
    right.x, up.x, normal.x,
    right.y, up.y, normal.y,
    right.z, up.z, normal.z,
  ));
}

/**
 * Recomputes a record's geometry and pushes it into its entities. Called on
 * build, on every gizmo drag step, and when an image's real aspect lands.
 * @param {Object} record - Media record.
 */
function applyRecordGeometry(record) {
  const geometry = ensureMediaPose(record);
  const positions = frustumCartesians(geometry);
  record.frustumGeometry = geometry;
  record.frustumPositions = positions;
  record.position = positions.mount;

  if (record.pinEntity) record.pinEntity.position = positions.mount;
  if (record.labelEntity) record.labelEntity.position = positions.label;
  if (record.wedgeEntity) {
    record.wedgeEntity.polyline.positions = wedgePath(positions);
  }
  if (record.planeEntity) {
    record.planeEntity.position = positions.capCenter;
    record.planeEntity.orientation = planeOrientationFor(record.camera, positions.capCenter);
    if (record.planeEntity.plane) {
      record.planeEntity.plane.dimensions = new Cesium.Cartesian2(geometry.halfW * 2, geometry.halfH * 2);
    }
  }
  if (_gizmo?.isEnabled() && record.item.id === _selectedId) _gizmo.refresh();
  _viewer?.scene?.requestRender?.();
}

/**
 * Asks the browser for the media's real aspect ratio, then re-sizes the image
 * plane once it lands. Until then the plane keeps the 16:9 default — a plane
 * that waited for its texture would leave a hole in the wedge.
 * @param {Object} record - Media record.
 */
function resolveAspect(record) {
  // Candidates in cost order. The fallback is NOT decoration: several Wikimedia
  // packs carry a `thumbnailUrl` whose thumb size upstream answers 400 while the
  // full `imageUrl` is fine (observed on every gouda.json entry, 2026-09-12).
  const candidates = [record.item.thumbnailUrl, record.item.imageUrl]
    .filter((url, index, all) => url && all.indexOf(url) === index);
  if (!record.planeEntity || !candidates.length || typeof Image === 'undefined') return;

  const tryCandidate = (index) => {
    if (index >= candidates.length) {
      // Every candidate failed to decode, or the host sends no CORS header.
      // The plane keeps its flat tinted pane and the layer carries on — the
      // panel still shows the picture through a plain <img>, which needs no
      // CORS at all.
      console.debug('[Data:GeoMedia] no CORS-loadable image for', record.item.id);
      return;
    }
    const url = candidates[index];
    const probe = new Image();
    // A texture Cesium can upload has to be CORS-clean; asking here means a
    // host without the header fails THIS probe instead of tainting the canvas.
    probe.crossOrigin = 'anonymous';
    probe.onload = () => {
      setPlaneTexture(record, probe);
      const aspect = probe.naturalWidth / probe.naturalHeight;
      if (!Number.isFinite(aspect) || aspect <= 0) return;
      if (Math.abs(aspect - record.aspect) < 0.001) return;
      record.aspect = aspect;
      applyRecordGeometry(record);
    };
    probe.onerror = () => tryCandidate(index + 1);
    probe.src = url;
  };
  tryCandidate(0);
}

/**
 * Hangs a decoded, CORS-clean image on the record's plane. Takes the loaded
 * element rather than a URL so Cesium uploads the bytes the probe already
 * validated instead of re-fetching (and possibly re-failing) them.
 * @param {Object} record - Media record.
 * @param {HTMLImageElement} image - Fully decoded image.
 */
function setPlaneTexture(record, image) {
  if (!record.planeEntity?.plane || !image) return;
  try {
    record.planeEntity.plane.material = new Cesium.ImageMaterialProperty({
      image,
      transparent: false,
      color: Cesium.Color.WHITE,
    });
  } catch (error) {
    // One unusable image must never take the layer down; the flat pane stays.
    console.debug('[Data:GeoMedia] texture rejected for', record.item.id, error?.message || error);
    return;
  }
  _viewer?.scene?.requestRender?.();
}

/**
 * Builds every entity for one item and registers the record.
 * @param {Object} item - Normalized pack item.
 * @param {Object} pack - Normalized pack the item came from.
 */
function buildRecord(item, pack) {
  const color = colorForKind(item.kind);
  const saved = _calibrationById.get(item.id);
  const quiet = !LABELED_KINDS.has(item.kind);
  const record = {
    item,
    packId: pack.id,
    aspect: DEFAULT_MEDIA_ASPECT,
    camera: {
      id: item.id,
      name: item.name,
      calibration: saved ? { ...saved.values } : { ...DEFAULT_MEDIA_CALIBRATION },
    },
    calDirty: false,
    // Ellipsoidal ground under the camera point, resolved after the pack
    // loads (resolveGroundHeights). Until then the pack's orthometric value
    // is used as-is, which is only right where the geoid undulation is ~0.
    groundEllipsoidalM: null,
    pinEntity: null,
    labelEntity: null,
    wedgeEntity: null,
    planeEntity: null,
  };
  const entities = _dataSource.entities;
  const idFor = (role) => `${ENTITY_PREFIX}${item.id}-${role}`;

  record.pinEntity = entities.add({
    id: idFor('pin'),
    position: Cesium.Cartesian3.ZERO,
    point: {
      // A viewpoint-only kind (Street View) is context, not a find: smaller and
      // dimmer so a dense pano run never shouts over the actual photos.
      pixelSize: quiet ? 7 : 11,
      color: quiet ? color.withAlpha(0.55) : color,
      outlineColor: Cesium.Color.BLACK.withAlpha(quiet ? 0.5 : 0.75),
      outlineWidth: quiet ? 1 : 2,
      // Pins must stay readable against Google's photoreal tiles, which would
      // otherwise swallow a street-level point behind a facade.
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });

  if (!quiet) {
    record.labelEntity = entities.add({
      id: idFor('label'),
      position: Cesium.Cartesian3.ZERO,
      label: {
        text: item.name,
        font: '500 12px "Rajdhani", system-ui, sans-serif',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.85),
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        // Names are noise from orbit; they earn their pixels up close only.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, LABEL_VISIBLE_RANGE_M),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  record.wedgeEntity = entities.add({
    id: idFor('wedge'),
    polyline: {
      positions: [],
      width: quiet ? 1 : 1.5,
      material: color.withAlpha(quiet ? 0.5 : 0.85),
      // Behind geometry the wedge dims rather than vanishing — the same
      // convention the CCTV coverage rays use.
      depthFailMaterial: color.withAlpha(0.32),
    },
  });

  // No media to hang means no plane: a Street View pano is a viewpoint, and an
  // empty rectangle in mid-air would read as a broken photo.
  const hasMedia = Boolean(item.thumbnailUrl || item.imageUrl);
  if (hasMedia && !PLANELESS_KINDS.has(item.kind)) {
    record.planeEntity = entities.add({
      id: idFor('plane'),
      position: Cesium.Cartesian3.ZERO,
      plane: {
        plane: new Cesium.Plane(Cesium.Cartesian3.UNIT_Z, 0.0),
        dimensions: new Cesium.Cartesian2(1, 1),
        // Starts as a flat tinted pane. The texture is only attached once an
        // image has actually decoded under CORS (resolveAspect) — a host that
        // sends no `Access-Control-Allow-Origin` would otherwise taint the
        // texture and leave a black rectangle hanging in the wedge.
        material: new Cesium.ColorMaterialProperty(color.withAlpha(0.25)),
        outline: true,
        outlineColor: color.withAlpha(0.9),
      },
    });
  }

  _records.push(record);
  _recordById.set(item.id, record);
  applyRecordGeometry(record);
  resolveAspect(record);
}

/**
 * Removes every entity a record owns (used when a reload rebuilds the packs).
 * @param {Object} record - Media record.
 */
function destroyRecordEntities(record) {
  if (!_dataSource) return;
  const entities = _dataSource.entities;
  for (const entity of [record.pinEntity, record.labelEntity, record.wedgeEntity, record.planeEntity]) {
    if (entity) entities.remove(entity);
  }
}

/**
 * Loads every configured pack and builds its records.
 *
 * Single-flight: `init` starts the load and the manager's first `update()`
 * may arrive while it is still in the air. Without the in-flight latch the
 * second pass re-added entity ids the first pass had already created, and
 * Cesium's "already exists in this collection" throw aborted the remaining
 * items — half a pack on the globe.
 * @returns {Promise<void>}
 */
function loadPacks() {
  _loadPromise ||= loadPacksOnce().finally(() => {
    _loadPromise = null;
  });
  return _loadPromise;
}

/** @returns {Promise<void>} */
async function loadPacksOnce() {
  for (const record of _records) destroyRecordEntities(record);
  _records = [];
  _recordById = new Map();
  _lastError = null;
  for (const url of GEO_MEDIA_PACKS) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        _lastError = `pack ${url}: HTTP ${response.status}`;
        console.warn('[Data:GeoMedia]', _lastError);
        continue;
      }
      const pack = normalizeGeoMediaPack(await response.json(), url);
      for (const item of pack.items) buildRecord(item, pack);
    } catch (error) {
      _lastError = `pack ${url}: ${error?.message || error}`;
      console.warn('[Data:GeoMedia]', _lastError);
    }
  }
  _loaded = true;
  refreshSelectionStyles();
  await resolveGroundHeights();
}

/**
 * Converts every record's pack-supplied orthometric ground height to the
 * ellipsoidal height Cesium positions need, via the shared terrain resolver
 * (proxy first, bundled geoid as fallback). The pack value is kept as the
 * orthometric prior; only the rendered geometry moves.
 * @returns {Promise<void>}
 */
async function resolveGroundHeights() {
  const records = _records.slice();
  if (!records.length) return;
  try {
    const results = await resolveEllipsoidalGround(records.map((record) => ({
      lat: record.item.lat,
      lon: record.item.lon,
      sourceOrthometricM: record.item.groundElevationM,
    })));
    records.forEach((record, index) => {
      const ellipsoid = results[index]?.ellipsoid;
      if (!Number.isFinite(ellipsoid)) return;
      if (_recordById.get(record.item.id) !== record) return;
      record.groundEllipsoidalM = ellipsoid;
      applyRecordGeometry(record);
    });
  } catch (error) {
    console.warn('[Data:GeoMedia] ground height resolve failed', error?.message || error);
  }
}

/** Dims every unselected record so the chosen wedge reads clearly. */
function refreshSelectionStyles() {
  for (const record of _records) {
    const color = colorForKind(record.item.kind);
    const quiet = !LABELED_KINDS.has(record.item.kind);
    const selected = record.item.id === _selectedId;
    const base = quiet ? 0.5 : 0.85;
    const alpha = selected ? 0.95 : (_selectedId ? base * 0.45 : base);
    if (record.wedgeEntity) {
      record.wedgeEntity.polyline.material = color.withAlpha(alpha);
      record.wedgeEntity.polyline.depthFailMaterial = color.withAlpha(alpha * 0.4);
    }
    if (record.pinEntity?.point) {
      const size = quiet ? 7 : 11;
      record.pinEntity.point.pixelSize = selected ? size + 4 : size;
      record.pinEntity.point.outlineColor = selected
        ? Cesium.Color.WHITE
        : Cesium.Color.BLACK.withAlpha(quiet ? 0.5 : 0.75);
    }
  }
  _viewer?.scene?.requestRender?.();
}

/** @returns {Object|null} The selected record, or null. */
function getActiveRecord() {
  return _selectedId ? (_recordById.get(_selectedId) || null) : null;
}

/**
 * Flies the viewer to a spot a few metres behind and above the item's own
 * camera position, looking along its heading — the viewpoint at which the
 * image plane overlays the real buildings it was shot against.
 * @param {Object} record - Media record.
 */
function flyToRecord(record) {
  if (!_viewer || !record) return;
  if (_viewer.trackedEntity) return;
  const { camera, frustumGeometry } = record;
  const behind = projectMediaPoint(camera.lat, camera.lon, camera.headingDeg + 180, SELECT_STANDOFF_M);
  const alt = (frustumGeometry?.camera?.alt ?? camera.heightM) + SELECT_LIFT_M;
  _viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(behind.lon, behind.lat, alt),
    orientation: {
      heading: toRad(camera.headingDeg),
      // Look slightly down onto the plane; a raw pose pitch can point at sky.
      pitch: toRad(Math.max(-45, Math.min(20, camera.pitchDeg - 6))),
      roll: 0,
    },
    duration: 1.8,
    easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
  });
}

/**
 * Selects an item: highlights it, opens the detail panel, and flies the
 * camera to its viewpoint.
 * @param {string} id - Item id.
 * @param {{fly?: boolean}} [options={}]
 * @returns {boolean} Whether the id resolved to a record.
 */
export function selectGeoMediaItem(id, options = {}) {
  const record = _recordById.get(id);
  if (!record) return false;
  const changed = _selectedId !== id;
  _selectedId = id;
  if (changed && _calibrationMode) setCalibrationMode(false);
  refreshSelectionStyles();
  renderPanel();
  if (options.fly !== false) flyToRecord(record);
  return true;
}

/** Clears the selection, closes the panel, and drops ADJUST mode. */
export function clearGeoMediaSelection() {
  if (!_selectedId) return;
  _selectedId = null;
  setCalibrationMode(false);
  refreshSelectionStyles();
  renderPanel();
}

/**
 * Maps a pick result to the item it belongs to.
 * @param {string|null} pickedId - Canonical pick id.
 * @returns {string|null} Item id, or null.
 */
export function itemIdFromPickId(pickedId) {
  if (typeof pickedId !== 'string') return null;
  const match = ENTITY_ROLE_PATTERN.exec(pickedId);
  if (!match) return null;
  return _recordById.has(match[1]) ? match[1] : null;
}

// ── Calibration ──────────────────────────────────────────────────────

/**
 * Applies a gizmo patch to a record's live calibration. Transient by design:
 * dragging mutates only the in-memory pose, never the store (SAVE persists).
 * @param {Object} record - Media record.
 * @param {Object} patch - Partial 7-DOF offset vector.
 */
function applyCalibrationPatch(record, patch) {
  if (!record || !patch) return;
  record.camera.calibration = normalizeMediaCalibration({ ...record.camera.calibration, ...patch });
  record.calDirty = true;
  applyRecordGeometry(record);
  renderPoseReadout();
}

/** Creates the calibration gizmo, bound to the selected record. */
function ensureGizmo() {
  if (_gizmo || !_viewer) return;
  const liveRecord = (record) => (
    record && _recordById.get(record.item?.id) === record ? record : null
  );
  _gizmo = createCalibrationGizmo({
    viewer: _viewer,
    getActiveRecord: () => (_enabled && _calibrationMode ? getActiveRecord() : null),
    applyPatch: (patch, draggedRecord) => {
      const record = _enabled && _calibrationMode ? liveRecord(draggedRecord) : null;
      if (record) applyCalibrationPatch(record, patch);
    },
    endPatch: (draggedRecord) => {
      const record = liveRecord(draggedRecord);
      if (!record) return;
      applyRecordGeometry(record);
      renderPanel();
    },
  });
}

/**
 * Turns ADJUST mode on or off. The gizmo is destroyed on the way out so its
 * (layer-agnostic) handle entity ids return to whoever wants them next.
 * @param {boolean} value
 */
function setCalibrationMode(value) {
  const next = !!value && !!getActiveRecord();
  if (next === _calibrationMode) return;
  _calibrationMode = next;
  if (next) {
    ensureGizmo();
    _gizmo?.setEnabled(true);
    // Gizmo drags mutate entity geometry from pointer events, which do not
    // themselves trigger renders under requestRenderMode.
    holdContinuousRender('geo-media-adjust');
  } else {
    releaseContinuousRender('geo-media-adjust');
    if (_gizmo) {
      _gizmo.destroy();
      _gizmo = null;
    }
  }
  renderPanel();
}

/** Persists the selected item's live calibration. */
function saveCalibration() {
  const record = getActiveRecord();
  if (!record) return;
  if (isDefaultMediaCalibration(record.camera.calibration)) {
    _calibrationById.delete(record.item.id);
  } else {
    _calibrationById.set(record.item.id, {
      values: { ...record.camera.calibration },
      savedAt: Date.now(),
    });
  }
  record.calDirty = false;
  saveCalibrationStore();
  renderPanel();
}

/** Drops the selected item's calibration, live and persisted. */
function resetCalibration() {
  const record = getActiveRecord();
  if (!record) return;
  _calibrationById.delete(record.item.id);
  record.camera.calibration = { ...DEFAULT_MEDIA_CALIBRATION };
  record.calDirty = false;
  saveCalibrationStore();
  applyRecordGeometry(record);
  renderPanel();
}

/**
 * Downloads the selected item's pack with every live calibration baked into
 * the stored pose, as `<packId>.calibrated.json`.
 */
function exportPack() {
  const record = getActiveRecord();
  if (!record || typeof document === 'undefined') return;
  const packId = record.packId;
  const members = _records.filter((entry) => entry.packId === packId);
  const doc = {
    id: packId,
    name: `${packId} (calibrated)`,
    groundElevationM: members[0]?.item.groundElevationM ?? 0,
    items: members.map((entry) => bakeCalibratedItem(entry.item, entry.camera.calibration)),
  };
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${packId}.calibrated.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Detail panel ─────────────────────────────────────────────────────

/** Builds the panel DOM once and appends it to the document body. */
function createPanel() {
  if (_panel || typeof document === 'undefined') return;
  const root = document.createElement('div');
  root.id = 'geo-media-panel';
  root.className = 'geo-media-panel';
  root.hidden = true;
  root.innerHTML = `
    <div class="panel-header">
      <span class="panel-title">GEO MEDIA</span>
      <span class="panel-divider"></span>
      <button type="button" class="geo-media-close" data-action="close" aria-label="Close Geo Media panel">×</button>
    </div>
    <div class="geo-media-heading">
      <span class="geo-media-badge" data-role="kind">PHOTO</span>
      <span class="geo-media-name" data-role="name"></span>
    </div>
    <div class="geo-media-stage" data-role="stage"></div>
    <div class="geo-media-credit" data-role="credit"></div>
    <div class="geo-media-description" data-role="description"></div>
    <a class="geo-media-source" data-role="source" target="_blank" rel="noopener noreferrer">Bron</a>
    <div class="cctv-cal-readout geo-media-readout" data-role="readout"></div>
    <div class="cctv-controls geo-media-actions">
      <button type="button" class="scene-btn" data-action="adjust">ADJUST</button>
      <button type="button" class="scene-btn" data-action="save">SAVE</button>
      <button type="button" class="scene-btn" data-action="reset">RESET</button>
    </div>
    <div class="cctv-controls geo-media-actions">
      <button type="button" class="scene-btn" data-action="export">EXPORT PACK</button>
    </div>
  `;
  root.addEventListener('click', (event) => {
    const action = event.target?.closest?.('[data-action]')?.dataset?.action;
    if (!action) return;
    if (action === 'close') clearGeoMediaSelection();
    else if (action === 'adjust') setCalibrationMode(!_calibrationMode);
    else if (action === 'save') saveCalibration();
    else if (action === 'reset') resetCalibration();
    else if (action === 'export') exportPack();
  });
  document.body.appendChild(root);
  _panel = {
    root,
    kind: root.querySelector('[data-role="kind"]'),
    name: root.querySelector('[data-role="name"]'),
    stage: root.querySelector('[data-role="stage"]'),
    credit: root.querySelector('[data-role="credit"]'),
    description: root.querySelector('[data-role="description"]'),
    source: root.querySelector('[data-role="source"]'),
    readout: root.querySelector('[data-role="readout"]'),
    adjust: root.querySelector('[data-action="adjust"]'),
  };

  _keydownListener = (event) => {
    if (event.key === 'Escape' && _selectedId) clearGeoMediaSelection();
  };
  document.addEventListener('keydown', _keydownListener);
}

/** Renders the pose line only (cheap enough for every drag step). */
function renderPoseReadout() {
  const record = getActiveRecord();
  if (!_panel || !record) return;
  const { camera, item } = record;
  _panel.readout.textContent = [
    `HDG ${Math.round(camera.headingDeg)}°`,
    `PITCH ${Math.round(camera.pitchDeg)}°`,
    `FOV ${Math.round(camera.fovDeg)}°`,
    `RANGE ${camera.rangeM.toFixed(camera.rangeM < 10 ? 1 : 0)} m`,
    `H ${camera.heightM.toFixed(1)} m`,
    `position: ${item.positionConfidence}`,
  ].join(' · ');
}

/** Renders the whole detail panel for the current selection. */
function renderPanel() {
  if (!_panel) return;
  const record = getActiveRecord();
  if (!record || !_enabled) {
    _panel.root.hidden = true;
    _panel.stage.replaceChildren();
    return;
  }
  const { item } = record;
  _panel.root.hidden = false;
  _panel.kind.textContent = item.kind.toUpperCase();
  _panel.kind.dataset.kind = item.kind;
  _panel.name.textContent = item.name;
  const credit = [item.author, item.capturedAt, item.license].filter(Boolean).join(' · ');
  _panel.credit.textContent = credit;
  _panel.credit.hidden = !credit;
  _panel.description.textContent = item.description;
  _panel.description.hidden = !item.description;
  _panel.source.href = item.sourceUrl || '#';
  _panel.source.hidden = !item.sourceUrl;
  _panel.adjust.classList.toggle('active', _calibrationMode);
  renderPoseReadout();

  // The stage is rebuilt per selection: the YouTube iframe exists ONLY while
  // its item is selected, so nothing keeps loading in the background.
  const stageKey = `${item.id}:${item.kind === 'video' && item.embedUrl ? 'embed' : 'image'}`;
  if (_panel.stage.dataset.key !== stageKey) {
    _panel.stage.dataset.key = stageKey;
    _panel.stage.replaceChildren();
    if (item.kind === 'video' && item.embedUrl) {
      const frame = document.createElement('iframe');
      frame.src = item.embedUrl;
      frame.title = item.name;
      frame.loading = 'lazy';
      frame.allow = 'accelerometer; clipboard-write; encrypted-media; picture-in-picture';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      _panel.stage.appendChild(frame);
    } else if (item.imageUrl || item.thumbnailUrl) {
      const img = document.createElement('img');
      img.src = item.imageUrl || item.thumbnailUrl;
      img.alt = item.name;
      img.loading = 'lazy';
      img.addEventListener('error', () => {
        if (item.thumbnailUrl && img.src !== item.thumbnailUrl) img.src = item.thumbnailUrl;
      });
      _panel.stage.appendChild(img);
    }
  }
}

/** Removes the panel and its document-level listener. */
function destroyPanel() {
  if (_keydownListener && typeof document !== 'undefined') {
    document.removeEventListener('keydown', _keydownListener);
  }
  _keydownListener = null;
  _panel?.root?.remove();
  _panel = null;
}

// ── Layer module ─────────────────────────────────────────────────────

const geoMediaLayer = {
  id: 'geo-media',
  name: 'Geo Media',
  icon: '▣',
  source: 'Open web · Wikimedia / YouTube',
  // Static packs: nothing to poll.
  updateInterval: 0,
  showInTogglePanel: true,

  /**
   * Creates the data source, the detail panel, and the click routing, then
   * loads the packs in the background.
   * @param {Cesium.Viewer} viewer
   */
  init(viewer) {
    _viewer = viewer;
    _enabled = false;
    _selectedId = null;
    _loaded = false;
    _dataSource = new Cesium.CustomDataSource('geo-media');
    _dataSource.show = false;
    viewer.dataSources.add(_dataSource);
    loadCalibrationStore();
    createPanel();

    _clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    bindTrackingClickGesture(_clickHandler, (click, gesture) => {
      if (!_enabled || !isTrackingClickGesture(gesture)) return;
      const pickedId = resolvePickId(viewer.scene.pick(click.position));
      // A gizmo handle drag is never a selection change, whoever owns it.
      if (typeof pickedId === 'string' && pickedId.startsWith(GIZMO_ID_PREFIX)) return;
      const itemId = itemIdFromPickId(pickedId);
      if (itemId) {
        selectGeoMediaItem(itemId);
        return;
      }
      // Anything another layer claims stays that layer's click.
      if (pickedId !== null && isOwnedByOtherLayer('geo-media', pickedId)) return;
      if (pickedId === null && _selectedId && !_gizmo?.isDragging()) clearGeoMediaSelection();
    });

    loadPacks().then(() => {
      console.log('[Data:GeoMedia] Loaded', _records.length, 'items from', GEO_MEDIA_PACKS.length, 'pack(s)');
    });
  },

  /** Shows the layer's entities and claims its picks. */
  enable() {
    _enabled = true;
    registerPickOwner('geo-media', (pickedId) => {
      if (itemIdFromPickId(pickedId)) return true;
      return _calibrationMode && typeof pickedId === 'string' && pickedId.startsWith(GIZMO_ID_PREFIX);
    });
    if (_dataSource) _dataSource.show = true;
    renderPanel();
    _viewer?.scene?.requestRender?.();
  },

  /** Hides everything, drops ADJUST mode, and releases picks. */
  disable() {
    _enabled = false;
    unregisterPickOwner('geo-media');
    setCalibrationMode(false);
    _selectedId = null;
    if (_dataSource) _dataSource.show = false;
    renderPanel();
    _viewer?.scene?.requestRender?.();
  },

  /**
   * Nothing to poll — packs are static. Kept for the layer contract and to
   * recover from a failed initial pack load.
   * @returns {Promise<boolean>} Whether records are present.
   */
  async update() {
    if (!_loaded && !_records.length) await loadPacks();
    return _records.length > 0;
  },

  /**
   * Runtime controls, mirroring the CCTV layer's parameter surface.
   * @param {Object} [params={}]
   */
  setParams(params = {}) {
    if (typeof params.selectedItemId === 'string') {
      selectGeoMediaItem(params.selectedItemId, { fly: params.focusSelected !== false });
    }
    if (params.selectedItemId === null) clearGeoMediaSelection();
    if (typeof params.calibrationMode === 'boolean') setCalibrationMode(params.calibrationMode);
  },

  /** @returns {Object} Current selection + calibration state for the UI. */
  getUIState() {
    const record = getActiveRecord();
    return {
      enabled: _enabled,
      count: _records.length,
      selectedItemId: _selectedId,
      calibrationMode: _calibrationMode,
      pose: record
        ? {
          headingDeg: record.camera.headingDeg,
          pitchDeg: record.camera.pitchDeg,
          fovDeg: record.camera.fovDeg,
          rangeM: record.camera.rangeM,
          heightM: record.camera.heightM,
          positionConfidence: record.item.positionConfidence,
        }
        : null,
    };
  },

  /** @returns {{count: number, lastUpdate: null, error: string|null}} */
  getStats() {
    return { count: _records.length, lastUpdate: null, error: _lastError };
  },

  /**
   * Tears the layer down completely.
   * @param {Cesium.Viewer} [viewer]
   */
  destroy(viewer) {
    unregisterPickOwner('geo-media');
    releaseContinuousRender('geo-media-adjust');
    _calibrationMode = false;
    if (_gizmo) {
      _gizmo.destroy();
      _gizmo = null;
    }
    if (_clickHandler) {
      _clickHandler.destroy();
      _clickHandler = null;
    }
    destroyPanel();
    const target = viewer || _viewer;
    if (_dataSource && target) {
      _dataSource.entities.removeAll();
      target.dataSources.remove(_dataSource, true);
    }
    _dataSource = null;
    _records = [];
    _recordById = new Map();
    _selectedId = null;
    _enabled = false;
    _loaded = false;
    _viewer = null;
  },
};

export default geoMediaLayer;

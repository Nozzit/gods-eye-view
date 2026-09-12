import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MEDIA_ASPECT,
  DEFAULT_MEDIA_CALIBRATION,
  GEO_MEDIA_DEFAULTS,
  applyMediaCalibration,
  bakeCalibratedItem,
  computeMediaFrustum,
  isDefaultMediaCalibration,
  normalizeGeoMediaItem,
  normalizeGeoMediaPack,
  normalizeMediaCalibration,
  projectMediaPoint,
  youTubeIdFrom,
} from './geoMediaModel.js';

const BASE = Object.freeze({
  id: 'x1',
  name: 'Test item',
  kind: 'photo',
  lat: 52.015297,
  lon: 4.698233,
  headingDeg: 90,
  pitchDeg: 0,
  fovDeg: 60,
  rangeM: 20,
  heightM: 1.6,
});

function item(overrides = {}) {
  return normalizeGeoMediaItem({ ...BASE, ...overrides });
}

test('items without a usable id or finite position are dropped', () => {
  assert.equal(normalizeGeoMediaItem(null), null);
  assert.equal(normalizeGeoMediaItem({ lat: 1, lon: 2 }), null);
  assert.equal(normalizeGeoMediaItem({ id: '  ', lat: 1, lon: 2 }), null);
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 'nope', lon: 2 }), null);
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 1 }), null);
  // Out-of-range coordinates are a broken pack, not a clampable pose.
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 95, lon: 2 }), null);
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 1, lon: -400 }), null);
  assert.ok(normalizeGeoMediaItem({ id: 'a', lat: 0, lon: 0 }));
});

test('missing pose fields fall back to the documented defaults', () => {
  const normalized = normalizeGeoMediaItem({ id: 'a', lat: 1, lon: 2 });
  assert.equal(normalized.kind, 'photo');
  assert.equal(normalized.fovDeg, GEO_MEDIA_DEFAULTS.fovDeg);
  assert.equal(normalized.rangeM, GEO_MEDIA_DEFAULTS.rangeM);
  assert.equal(normalized.heightM, GEO_MEDIA_DEFAULTS.heightM);
  assert.equal(normalized.pitchDeg, 0);
  assert.equal(normalized.headingDeg, 0);
  assert.equal(normalized.name, 'a');
  assert.equal(normalized.positionConfidence, 'estimated');
  assert.equal(normalized.headingConfidence, 'guess');
});

test('pose fields clamp to their limits and headings wrap', () => {
  const hot = item({ headingDeg: 455, pitchDeg: -400, fovDeg: 400, rangeM: 9000, heightM: -12 });
  assert.equal(hot.headingDeg, 95);
  assert.equal(hot.pitchDeg, -90);
  assert.equal(hot.fovDeg, 120);
  assert.equal(hot.rangeM, 500);
  assert.equal(hot.heightM, 0);
  const cold = item({ headingDeg: -30, fovDeg: 1, rangeM: 0.5 });
  assert.equal(cold.headingDeg, 330);
  assert.equal(cold.fovDeg, 20);
  assert.equal(cold.rangeM, 3);
});

test('pitch is NOT clamped to the CCTV downward band', () => {
  assert.equal(item({ pitchDeg: 62 }).pitchDeg, 62);
  assert.equal(item({ pitchDeg: -62 }).pitchDeg, -62);
});

test('unknown kinds normalize to photo, known kinds survive', () => {
  assert.equal(item({ kind: 'hologram' }).kind, 'photo');
  for (const kind of ['photo', 'video', 'streetview', 'aerial', 'historical', 'listing']) {
    assert.equal(item({ kind, sourceUrl: '' }).kind, kind);
  }
});

test('ground elevation falls back item → pack → zero', () => {
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 1, lon: 2 }).groundElevationM, 0);
  assert.equal(normalizeGeoMediaItem({ id: 'a', lat: 1, lon: 2 }, { groundElevationM: -0.5 }).groundElevationM, -0.5);
  assert.equal(
    normalizeGeoMediaItem({ id: 'a', lat: 1, lon: 2, groundElevationM: 7 }, { groundElevationM: -0.5 }).groundElevationM,
    7,
  );
});

test('YouTube ids are read from every URL shape in the wild', () => {
  assert.equal(youTubeIdFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youTubeIdFrom('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ&t=9s'), 'dQw4w9WgXcQ');
  assert.equal(youTubeIdFrom('https://youtu.be/dQw4w9WgXcQ?t=42'), 'dQw4w9WgXcQ');
  assert.equal(youTubeIdFrom('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youTubeIdFrom('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youTubeIdFrom('https://commons.wikimedia.org/wiki/File:X.jpg'), null);
  assert.equal(youTubeIdFrom(''), null);
  assert.equal(youTubeIdFrom(undefined), null);
});

test('video items derive embed + thumbnail URLs only when missing', () => {
  const derived = item({ kind: 'video', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ', thumbnailUrl: '', imageUrl: '' });
  assert.equal(derived.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(derived.thumbnailUrl, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');

  const explicit = item({
    kind: 'video',
    sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
    embedUrl: 'https://example.test/embed',
    thumbnailUrl: 'https://example.test/thumb.jpg',
  });
  assert.equal(explicit.embedUrl, 'https://example.test/embed');
  assert.equal(explicit.thumbnailUrl, 'https://example.test/thumb.jpg');

  // A non-YouTube video keeps whatever the pack supplied — nothing is invented.
  const other = item({ kind: 'video', sourceUrl: 'https://vimeo.com/12345', thumbnailUrl: '', imageUrl: '' });
  assert.equal(other.embedUrl, '');
  assert.equal(other.thumbnailUrl, '');

  // A non-video item never gets YouTube derivation, even with a YouTube source.
  const photo = item({ kind: 'photo', sourceUrl: 'https://youtu.be/dQw4w9WgXcQ', thumbnailUrl: '', imageUrl: '' });
  assert.equal(photo.embedUrl, '');
  assert.equal(photo.thumbnailUrl, '');
});

test('thumbnail and image fall back to each other', () => {
  assert.equal(item({ thumbnailUrl: '', imageUrl: 'https://x.test/full.jpg' }).thumbnailUrl, 'https://x.test/full.jpg');
  assert.equal(item({ thumbnailUrl: 'https://x.test/t.jpg', imageUrl: '' }).imageUrl, 'https://x.test/t.jpg');
});

test('pack normalization keeps pack identity, drops junk, dedupes ids', () => {
  const pack = normalizeGeoMediaPack({
    id: 'gouda',
    name: 'Gouda',
    groundElevationM: -0.5,
    items: [
      { id: 'a', lat: 52, lon: 4 },
      { id: 'a', lat: 53, lon: 5 },
      { id: '', lat: 52, lon: 4 },
      null,
      { id: 'b', lat: 'x', lon: 4 },
      { id: 'c', lat: 52.1, lon: 4.1 },
    ],
  });
  assert.equal(pack.id, 'gouda');
  assert.equal(pack.groundElevationM, -0.5);
  assert.deepEqual(pack.items.map((i) => i.id), ['a', 'c']);
  assert.equal(pack.items[0].groundElevationM, -0.5);
});

test('pack normalization survives a garbage document', () => {
  const pack = normalizeGeoMediaPack(null, 'fallback');
  assert.equal(pack.id, 'fallback');
  assert.deepEqual(pack.items, []);
  assert.equal(normalizeGeoMediaPack({ items: 'nope' }, 'f').items.length, 0);
});

test('calibration normalization clamps and defaults every field', () => {
  assert.deepEqual(normalizeMediaCalibration(), { ...DEFAULT_MEDIA_CALIBRATION });
  assert.deepEqual(normalizeMediaCalibration('junk'), { ...DEFAULT_MEDIA_CALIBRATION });
  const hot = normalizeMediaCalibration({
    offsetNorthM: 9e9, offsetEastM: -9e9, headingDeg: 900,
    pitchDeg: -900, fovDeg: 900, rangeScale: 900, heightM: 9e9,
  });
  assert.deepEqual(hot, {
    offsetNorthM: 500, offsetEastM: -500, headingDeg: 180,
    pitchDeg: -90, fovDeg: 60, rangeScale: 10, heightM: 150,
  });
  assert.equal(isDefaultMediaCalibration({}), true);
  assert.equal(isDefaultMediaCalibration({ headingDeg: 3 }), false);
  assert.equal(isDefaultMediaCalibration({ rangeScale: 1 }), true);
});

test('calibration offsets move the pose exactly as the gizmo expects', () => {
  const source = item();
  const pose = applyMediaCalibration(source, {
    offsetNorthM: 111.32, headingDeg: 15, pitchDeg: -10, fovDeg: 10, rangeScale: 2, heightM: 0.4,
  });
  // Offsets quantize to 0.1 m before they are applied (111.32 → 111.3 m).
  assert.ok(Math.abs(pose.lat - (source.lat + 111.3 / 111320)) < 1e-12);
  assert.equal(pose.headingDeg, 105);
  assert.equal(pose.pitchDeg, -10);
  assert.equal(pose.fovDeg, 70);
  assert.equal(pose.rangeM, 40);
  assert.ok(Math.abs(pose.heightM - 2.0) < 1e-9);
  // The source item is never mutated by a calibration application.
  assert.equal(source.headingDeg, 90);
  assert.equal(source.rangeM, 20);
});

test('calibrated pose stays inside the item limits', () => {
  const pose = applyMediaCalibration(item({ rangeM: 400, fovDeg: 110, heightM: 149 }), {
    rangeScale: 10, fovDeg: 60, heightM: 100, pitchDeg: 90,
  });
  assert.equal(pose.rangeM, 500);
  assert.equal(pose.fovDeg, 120);
  assert.equal(pose.heightM, 150);
  assert.equal(pose.pitchDeg, 90);
});

test('projectMediaPoint walks the right way for the cardinal bearings', () => {
  const north = projectMediaPoint(52, 4, 0, 1000);
  assert.ok(north.lat > 52 && Math.abs(north.lon - 4) < 1e-6);
  const east = projectMediaPoint(52, 4, 90, 1000);
  assert.ok(east.lon > 4 && Math.abs(east.lat - 52) < 1e-3);
  const south = projectMediaPoint(52, 4, 180, 1000);
  assert.ok(south.lat < 52);
  // ~1 km north is ~0.009 degrees of latitude.
  assert.ok(Math.abs((north.lat - 52) - 0.008993) < 1e-4);
});

test('a level frustum puts the plane at camera height, range ahead', () => {
  const geometry = computeMediaFrustum(item({ headingDeg: 90, pitchDeg: 0, rangeM: 20, heightM: 1.6 }));
  assert.equal(geometry.camera.alt, 1.6);
  assert.ok(Math.abs(geometry.center.alt - 1.6) < 1e-9);
  assert.ok(geometry.center.lon > BASE.lon, 'heading 90 must move east');
  assert.ok(Math.abs(geometry.center.lat - BASE.lat) < 1e-4);
  assert.equal(geometry.aspect, DEFAULT_MEDIA_ASPECT);
  // Symmetric corners around the centre altitude.
  assert.ok(Math.abs((geometry.corners.tl.alt - geometry.center.alt)
    + (geometry.corners.bl.alt - geometry.center.alt)) < 1e-9);
  assert.ok(geometry.corners.tl.alt > geometry.corners.bl.alt);
});

test('half-width and half-height follow fov, range and aspect', () => {
  const geometry = computeMediaFrustum(item({ fovDeg: 90, rangeM: 10 }));
  assert.ok(Math.abs(geometry.halfW - 10) < 1e-6, 'fov 90 at 10 m gives a 20 m wide plane');
  assert.ok(Math.abs(geometry.halfW / geometry.halfH - DEFAULT_MEDIA_ASPECT) < 1e-9);
  const portrait = computeMediaFrustum(item({ fovDeg: 90, rangeM: 10 }), null, { aspect: 0.75 });
  assert.ok(Math.abs(portrait.halfW - 10) < 1e-6);
  assert.ok(Math.abs(portrait.halfW / portrait.halfH - 0.75) < 1e-9);
  // A nonsense aspect never divides by zero or flips the plane inside out.
  const broken = computeMediaFrustum(item(), null, { aspect: 0 });
  assert.equal(broken.aspect, DEFAULT_MEDIA_ASPECT);
  assert.ok(broken.halfH > 0);
  assert.ok(computeMediaFrustum(item(), null, { aspect: 'x' }).aspect === DEFAULT_MEDIA_ASPECT);
});

test('pitch raises or lowers the far plane without a ground clamp', () => {
  const up = computeMediaFrustum(item({ pitchDeg: 45, rangeM: 20, heightM: 1.6 }));
  assert.ok(Math.abs(up.center.alt - (1.6 + 20 * Math.SQRT1_2)) < 1e-6);
  // CCTV lifts a buried cap to ground + 2 m; a media wedge may point at the
  // pavement and must be allowed to end below its own camera height.
  const down = computeMediaFrustum(item({ pitchDeg: -80, rangeM: 20, heightM: 1.6 }));
  assert.ok(down.center.alt < 0, `expected a sub-ground cap, got ${down.center.alt}`);
});

test('ground elevation shifts the whole wedge vertically', () => {
  const geometry = computeMediaFrustum(item({ groundElevationM: 40, heightM: 2 }));
  assert.equal(geometry.camera.alt, 42);
  assert.equal(geometry.groundElevationM, 40);
});

test('the frustum reflects the calibration it is handed', () => {
  const source = item({ headingDeg: 0, rangeM: 10 });
  const plain = computeMediaFrustum(source);
  const turned = computeMediaFrustum(source, { headingDeg: 90, rangeScale: 2 });
  assert.equal(turned.headingDeg, 90);
  assert.equal(turned.rangeM, 20);
  assert.ok(plain.center.lat > source.lat, 'heading 0 goes north');
  assert.ok(turned.center.lon > source.lon, 'heading 90 goes east');
});

test('EXPORT PACK bakes the calibrated pose into the item itself', () => {
  const source = item({ headingDeg: 90, pitchDeg: 0, rangeM: 20, heightM: 1.6 });
  const baked = bakeCalibratedItem(source, { headingDeg: 12, pitchDeg: -4, rangeScale: 1.5, heightM: 0.5, offsetNorthM: 1 });
  assert.equal(baked.headingDeg, 102);
  assert.equal(baked.pitchDeg, -4);
  assert.equal(baked.rangeM, 30);
  assert.equal(baked.heightM, 2.1);
  assert.ok(baked.lat > source.lat);
  assert.equal(baked.id, source.id);
  assert.equal(baked.sourceUrl, source.sourceUrl);
  // Re-normalizing an exported item reproduces the same pose: the export is a
  // real pack, not a pack that still needs the calibration store to look right.
  const round = normalizeGeoMediaItem(baked);
  assert.equal(round.headingDeg, 102);
  assert.equal(round.rangeM, 30);
});

test('an item survives with no media, no author, and a null capture date', () => {
  const bare = normalizeGeoMediaItem({
    id: 'sv-1', kind: 'streetview', lat: 52, lon: 4,
    headingDeg: 210, rangeM: 8, fovDeg: 90,
    sourceUrl: 'https://maps.google.com/?pano=abc',
    author: null, capturedAt: null, license: undefined, description: 0,
  });
  assert.equal(bare.kind, 'streetview');
  assert.equal(bare.thumbnailUrl, '');
  assert.equal(bare.imageUrl, '');
  assert.equal(bare.embedUrl, '');
  assert.equal(bare.author, '');
  assert.equal(bare.capturedAt, '');
  assert.equal(bare.license, '');
  assert.equal(bare.description, '');
  assert.equal(bare.sourceUrl, 'https://maps.google.com/?pano=abc');
  // The pose still computes — a viewpoint with no picture is a valid item.
  const geometry = computeMediaFrustum(bare);
  assert.equal(geometry.rangeM, 8);
  assert.equal(geometry.fovDeg, 90);
  assert.ok(Number.isFinite(geometry.center.alt));
  assert.ok(Number.isFinite(geometry.corners.tl.lat));
});

test('a dense pack of viewpoint-only items normalizes without loss', () => {
  const items = Array.from({ length: 130 }, (_, i) => ({
    id: `pano-${i}`, kind: 'streetview',
    lat: 52.0153 + i * 1e-5, lon: 4.6982 + i * 1e-5,
    headingDeg: (i * 17) % 360, rangeM: 8, fovDeg: 90,
    sourceUrl: `https://maps.google.com/?pano=${i}`,
  }));
  const pack = normalizeGeoMediaPack({ id: 'dense', items });
  assert.equal(pack.items.length, 130);
  assert.ok(pack.items.every((item) => item.kind === 'streetview' && item.rangeM === 8));
});

test('computeMediaFrustum: an ellipsoidal ground override replaces the pack value', () => {
  const item = normalizeGeoMediaItem({ id: 'g', lat: 52.0153, lon: 4.6982, groundElevationM: -1.75, heightM: 1.6 });
  const raw = computeMediaFrustum(item);
  const fixed = computeMediaFrustum(item, undefined, { groundElevationM: 41.5 });
  assert.ok(Math.abs(raw.camera.alt - (-0.15)) < 1e-9);
  assert.ok(Math.abs(fixed.camera.alt - 43.1) < 1e-9);
  assert.ok(Math.abs((fixed.center.alt - raw.center.alt) - 43.25) < 1e-9);
});

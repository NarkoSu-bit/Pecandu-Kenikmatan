// Collision math with no allocation in hot loops: segment-vs-AABB tests for
// line of sight and bullets, and box-overlap tests for movement. Callers pass
// plain numbers; the module keeps its own scratch values.
import * as THREE from 'three';

// Segment from (ax,ay,az) to (bx,by,bz) against one Box3. Returns the hit
// distance along the segment (0..1) or -1 when the segment misses the box.
export function segmentBox(ax, ay, az, bx, by, bz, box) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  // One axis at a time; a zero direction means the segment runs parallel.
  const mins = [box.min.x, box.min.y, box.min.z];
  const maxs = [box.max.x, box.max.y, box.max.z];
  const as = [ax, ay, az];
  const ds = [dx, dy, dz];
  for (let i = 0; i < 3; i += 1) {
    const d = ds[i];
    if (Math.abs(d) < 1e-9) {
      if (as[i] < mins[i] || as[i] > maxs[i]) return -1;
    } else {
      let t0 = (mins[i] - as[i]) / d;
      let t1 = (maxs[i] - as[i]) / d;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      if (t0 > tmin) tmin = t0;
      if (t1 < tmax) tmax = t1;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Nearest hit distance (0..1) of a segment against a list of boxes, or -1.
// Skips boxes the caller marks as non-blocking through `skip`.
export function segmentBoxes(ax, ay, az, bx, by, bz, boxes, skip = null) {
  let best = -1;
  for (let i = 0; i < boxes.length; i += 1) {
    const box = boxes[i];
    if (skip && skip.has(box)) continue;
    const t = segmentBox(ax, ay, az, bx, by, bz, box);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

// Does the axis-aligned box (cx, cy, cz, half extents, height) overlap any
// collider? `lift` trims the tested height at top and bottom so standing on a
// floor is not read as walking into a wall. Returns the collider or null.
const probe = new THREE.Box3();
export function boxOverlaps(cx, cy, cz, rx, height, rz, lift, colliders) {
  probe.min.set(cx - rx, cy + lift, cz - rz);
  probe.max.set(cx + rx, cy + height - lift, cz + rz);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// Line of sight between two points: true when no collider blocks the segment.
// A short step in from each end keeps a shooter's own cover from blocking.
export function hasLineOfSight(ax, ay, az, bx, by, bz, colliders) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  const inset = 0.3;
  return segmentBoxes(ax + nx * inset, ay + ny * inset, az + nz * inset, bx - nx * inset, by - ny * inset, bz - nz * inset, colliders) < 0;
}

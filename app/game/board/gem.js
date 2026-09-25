// Pull each cell in from its neighbors so a thin dark crack stays visible (px).
const CELL_GROUT = 0.65;
// Direction toward the light (up-left). SVG y grows downward, so up is negative y.
const LIGHT_TOWARD = [-1 / Math.SQRT2, -1 / Math.SQRT2];
// How far the peak slides toward the light, as a fraction of the tile's inscribed radius.
const APEX_SHIFT = 0.22;
// Facet brightness from darkest to lightest, as a mix toward black (negative) or white (positive). Lower the right-hand numbers to dim the lit faces.
const GEM_STEPS = [-0.55, -0.36, -0.18, 0, 0.1, 0.2];
// Palette CSS names as RGB, so each facet can be a lighter or darker shade of the same hue.
const PALETTE_RGB = {
  orangered: [255, 69, 0],
  goldenrod: [218, 165, 32],
  khaki: [240, 230, 140],
  orchid: [218, 112, 214],
  yellowgreen: [154, 205, 50],
  cadetblue: [95, 158, 160],
};

// Mix `rgb` a short step toward white when `amount` is positive, or toward black when it is negative. Returns an `rgb()` string.
const shadeRgb = (rgb, amount) => {
  // 255 lightens, 0 darkens; `amount` is how far to travel toward that end. Kept small so tiles stay their own hue.
  const target = amount >= 0 ? 255 : 0;
  const mix = Math.abs(amount);
  const channel = (c) => Math.round(c + (target - c) * mix);
  return `rgb(${channel(rgb[0])}, ${channel(rgb[1])}, ${channel(rgb[2])})`;
};

// One fill per `GEM_STEPS` bucket for every palette color. Facet geometry is shared; only these fills change on a move.
export const GEM_BUCKETS = Object.fromEntries(
  Object.entries(PALETTE_RGB).map(([name, rgb]) => [
    name,
    GEM_STEPS.map((amount) => shadeRgb(rgb, amount)),
  ]),
);

// Average of a ring. Used as the gem's peak before it is nudged toward the light.
const ringCentroid = (ring) => {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
};

// True when `p` is strictly inside a positively-wound convex ring (left of every edge).
const pointInsideRing = (ring, p) => {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross <= 1e-4) return false;
  }
  return true;
};

// Drop the repeated closing point on a d3 cell polygon so the ring can be walked by index.
const openRing = (polygon) => {
  if (!polygon || polygon.length < 4) return null;
  return polygon.slice(0, -1);
};

// Left-of-edge unit normal. For these Voronoi rings that points into the cell.
const inwardNormal = (a, b) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
};

// Intersection of point+direction lines `p + d*t` and `q + e*s`. Null when the edges are parallel.
const lineIntersect = (p, d, q, e) => {
  const det = d[0] * e[1] - d[1] * e[0];
  if (Math.abs(det) < 1e-8) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / det;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
};

// Signed shoelace area. Stays positive for a valid inset of these rings; a flip means the inset collapsed.
const ringArea = (ring) => {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
};

// Inset a convex ring by `distance` pixels along each edge. Returns null if the tile is too small to inset.
const insetConvexRing = (ring, distance) => {
  if (!ring || distance <= 0) return ring;
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const curr = ring[i];
    const next = ring[(i + 1) % n];
    const n1 = inwardNormal(prev, curr);
    const n2 = inwardNormal(curr, next);
    const p1 = [prev[0] + n1[0] * distance, prev[1] + n1[1] * distance];
    const d1 = [curr[0] - prev[0], curr[1] - prev[1]];
    const p2 = [curr[0] + n2[0] * distance, curr[1] + n2[1] * distance];
    const d2 = [next[0] - curr[0], next[1] - curr[1]];
    const hit = lineIntersect(p1, d1, p2, d2);
    if (!hit) return null;
    out.push(hit);
  }
  if (ringArea(out) <= 1) return null;
  return out;
};

// Closed SVG path for a ring of [x, y] points.
const ringToPath = (ring) => {
  const [x0, y0] = ring[0];
  let d = `M${x0},${y0}`;
  for (let i = 1; i < ring.length; i++) d += `L${ring[i][0]},${ring[i][1]}`;
  return `${d}Z`;
};

// Approximate inscribed radius (area / semi-perimeter) so tiny tiles get a thinner bevel.
const ringInradius = (ring) => {
  let area = 0;
  let peri = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
    peri += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (peri <= 0) return 0;
  return Math.abs(area) / peri;
};

// Grout outline plus one triangle per edge, all meeting at a peak. `buckets[i]` is the path for facets of shade `GEM_STEPS[i]`. Null if the polygon is missing.
export const buildCellBevel = (polygon) => {
  const ring = openRing(polygon);
  if (!ring) return null;
  // How far this tile can shrink before the outline collapses.
  const inradius = ringInradius(ring);
  const grout = Math.min(CELL_GROUT, Math.max(0, inradius * 0.22));
  const outer = grout > 0.25 ? insetConvexRing(ring, grout) : ring;
  if (!outer) return { outerPath: ringToPath(ring), buckets: [] };
  const center = ringCentroid(outer);
  // Peak nudged up-left so the lit faces are the ones looking at the light. Falls back to the center if that would leave the tile.
  const shifted = [
    center[0] + LIGHT_TOWARD[0] * inradius * APEX_SHIFT,
    center[1] + LIGHT_TOWARD[1] * inradius * APEX_SHIFT,
  ];
  const apex = pointInsideRing(outer, shifted) ? shifted : center;
  // Triangles that face the same way share one path, so a tile is a handful of fills instead of one path per edge.
  const buckets = GEM_STEPS.map(() => '');
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    // Outward normal of this edge dotted with the light. Positive faces up-left and is drawn lighter.
    const lit = (dy / len) * LIGHT_TOWARD[0] + (-dx / len) * LIGHT_TOWARD[1];
    const idx = Math.max(0, Math.min(GEM_STEPS.length - 1, Math.floor(((lit + 1) / 2) * GEM_STEPS.length)));
    buckets[idx] += `M${a[0]},${a[1]}L${b[0]},${b[1]}L${apex[0]},${apex[1]}Z`;
  }
  return { outerPath: ringToPath(outer), buckets };
};

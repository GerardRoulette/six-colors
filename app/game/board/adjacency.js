// Undirected polygon edges shared by the clipped cells. Map border edges have one owner; shared walls have two.
// `cells` is the live board (each cell needs `id` and a closed `polygon`).
export const buildEdgesByKey = (cells) => {
  // Undirected edge key → [{ cellId, a, b }, ...]. Length 1 is a map border; 2 is a shared wall.
  const map = new Map();
  // Stabilize floating point keys so the two copies of a shared edge land on one entry.
  const round = (n) => Math.round(n * 1000) / 1000;
  // Canonical string for segment a–b so (a,b) and (b,a) share one map entry.
  const keyFor = (a, b) => {
    const k1 = `${round(a[0])},${round(a[1])}`;
    const k2 = `${round(b[0])},${round(b[1])}`;
    return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
  };

  for (const cell of cells) {
    const poly = cell.polygon;
    if (!poly || poly.length < 2) continue;
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      const key = keyFor(a, b);
      const arr = map.get(key) || [];
      arr.push({ cellId: cell.id, a, b });
      map.set(key, arr);
    }
  }
  return map;
};

// Visual adjacency: two cells are neighbors only if they share a clipped edge. `id` → neighbor id list, for flood-fill `.get(cid)`.
export const buildVisualNeighbors = (cells, edgesByKey) => {
  // id -> Set of neighbor ids, seeded so every cell has an entry even with no shared edges.
  const neighborSets = new Map();
  for (const cell of cells) neighborSets.set(cell.id, new Set());
  for (const owners of edgesByKey.values()) {
    if (owners.length === 2) {
      const a = owners[0].cellId;
      const b = owners[1].cellId;
      neighborSets.get(a).add(b);
      neighborSets.get(b).add(a);
    }
  }
  // Same adjacency as arrays (`id` → neighbor id list) for flood-fill `.get(cid)`.
  const result = new Map();
  for (const [id, set] of neighborSets.entries()) result.set(id, Array.from(set));
  return result;
};

// Outer outline segments of one side's territory (map border, or a wall shared with a cell that side does not own).
// `owner` is `'player'` or `'ai'`. Segments are `{ a, b, cellId, shared }` for the SVG stroke.
// `shared` is true when the other cell belongs to the opponent, so each color can take its own half of that wall.
export const regionBoundary = (cells, edgesByKey, owner) => {
  // Live owner of each cell id, so a wall can be marked as player-versus-AI.
  const ownerById = new Map(cells.map((c) => [c.id, c.owner]));
  // Edge segments on this region's outline.
  const boundary = [];
  for (const owners of edgesByKey.values()) {
    const inOwned = owners.filter((o) => ownerById.get(o.cellId) === owner);
    if (inOwned.length === 0) continue;
    const outOwned = owners.filter((o) => ownerById.get(o.cellId) !== owner);
    if (owners.length === 1) {
      boundary.push({ ...inOwned[0], shared: false });
      continue;
    }
    if (outOwned.length > 0 && inOwned.length > 0) {
      const other = ownerById.get(outOwned[0].cellId);
      boundary.push({ ...inOwned[0], shared: other === 'player' || other === 'ai' });
    }
  }
  return boundary;
};

// Shift a segment into the owning cell. Voronoi rings are counterclockwise, so the interior is left of a → b.
// `distance` is the shift in map units. The original points stay put; the stroke uses the returned copy.
export const offsetSegmentTowardOwner = (seg, distance) => {
  const dx = seg.b[0] - seg.a[0];
  const dy = seg.b[1] - seg.a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return seg;
  // Unit step to the left of a → b, scaled by `distance`.
  const ox = (-dy / len) * distance;
  const oy = (dx / len) * distance;
  return { ...seg, a: [seg.a[0] + ox, seg.a[1] + oy], b: [seg.b[0] + ox, seg.b[1] + oy] };
};

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
// `owner` is `'player'` or `'ai'`. Segments are `{ a, b }` point pairs for the SVG stroke.
export const regionBoundary = (cells, edgesByKey, owner) => {
  const ownedSet = new Set(cells.filter((c) => c.owner === owner).map((c) => c.id));
  // Edge segments on this region's outline.
  const boundary = [];
  for (const owners of edgesByKey.values()) {
    const inOwned = owners.filter((o) => ownedSet.has(o.cellId));
    if (inOwned.length === 0) continue;
    const outOwned = owners.filter((o) => !ownedSet.has(o.cellId));
    if (owners.length === 1) { boundary.push(inOwned[0]); continue; }
    if (outOwned.length > 0 && inOwned.length > 0) boundary.push(inOwned[0]);
  }
  return boundary;
};

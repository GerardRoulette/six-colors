"use client"; 

import React, { useMemo } from "react"; 
import { Delaunay } from "d3-delaunay";

// responsive viewport (computed from window size)
const computeSize = () => {
  if (typeof window === 'undefined') return { w: 800, h: 600 };
  const w = Math.max(300, Math.floor(window.innerWidth * 0.9));
  const h = Math.max(300, Math.floor(window.innerHeight * 0.7));
  return { w, h };
};

// random diagram generation
const generateSites = (numPoints, width, height) => {
  let sites = [];
  for (let i = 0; i < numPoints; i++) {
    sites.push([Math.random() * width, Math.random() * height]);
  }
  return sites;
};

// generating the Voronoi diagram
const generateVoronoi = (sites, width, height) => {
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  return { delaunay, voronoi };
};

// converting sites into cell objects with needed properties
const PALETTE = ['orangered', 'goldenrod', 'khaki', 'orchid', 'yellowgreen', 'cadetblue'];
const createCells = (sites, voronoi, delaunay) => {
  return sites.map((site, index) => ({
    id: index,
    site: site,
    path: voronoi.renderCell(index), // svg path string for this cell
    polygon: voronoi.cellPolygon(index), // array of points [x,y] describing the cell polygon (closed)
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)], // random color
    neighbors: Array.from(delaunay.neighbors(index)) || [], // array of neighboring cells
    owner: null, // owner of the cell - 'player' / 'ai' / null
  }));
};

// finding the corner cells to use at start fiels for the game
// double check later if we need to use topleft and bottomright corners
const getCornerCellIds = (delaunay, width, height) => {
  const topLeft = delaunay.find(0, 0); 
  const topRight = delaunay.find(width, 0);
  const bottomLeft = delaunay.find(0, height); 
  const bottomRight = delaunay.find(width, height);
  return new Set([topLeft, topRight, bottomLeft, bottomRight]);
};

// Simulate a move and return how many unowned cells would be captured (matches applyMove flood fill)
const countCapturesForMove = (cells, visualNeighbors, owner, color) => {
  const next = cells.map((c) => ({ ...c }));
  const owned = new Set(next.filter((c) => c.owner === owner).map((c) => c.id));
  if (owned.size === 0) return 0;

  owned.forEach((id) => { next[id].color = color; });

  const queue = [...owned];
  const visited = new Set(queue);
  let captures = 0;

  while (queue.length > 0) {
    const cid = queue.shift();
    const nbs = visualNeighbors.get(cid) || [];
    for (const nb of nbs) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (next[nb].owner && next[nb].owner !== owner) continue;
      if (next[nb].owner === owner) {
        if (next[nb].color !== color) next[nb].color = color;
        queue.push(nb);
        continue;
      }
      if (next[nb].owner === null && next[nb].color === color) {
        next[nb].owner = owner;
        next[nb].color = color;
        queue.push(nb);
        owned.add(nb);
        captures++;
      }
    }
  }
  return captures;
};

// main interactive Voronoi diagram component
const VoronoiDiagram = ({ numPoints = 50 }) => { // 50 just to have some default value
  // compute responsive size
  const [{ w: svgWidth, h: svgHeight }, setSvgSize] = React.useState(computeSize());
  React.useEffect(() => {
    const onResize = () => setSvgSize(computeSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // stable set of random sites for the given count
  const [gameKey, setGameKey] = React.useState(0);
  const initialSites = useMemo(() => generateSites(numPoints, svgWidth, svgHeight), [numPoints, svgWidth, svgHeight, gameKey]);
  const sites = useMemo(() => [...initialSites], [initialSites]);

  // geometry derivations
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, svgWidth, svgHeight), [sites, svgWidth, svgHeight]);
  const baseCells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  // identifying the corner cells and marking them
  const cornerCellIds = useMemo(() => getCornerCellIds(delaunay, svgWidth, svgHeight), [delaunay, svgWidth, svgHeight]);
  const initialCellsWithCorners = useMemo(() =>
    baseCells.map((cell) =>
      cornerCellIds.has(cell.id)
        ? { ...cell, isCorner: true }
        : { ...cell, isCorner: false }
    ),
  [baseCells, cornerCellIds]);

  // game state
  const [cells, setCells] = React.useState(initialCellsWithCorners);
  const [turn, setTurn] = React.useState('player'); // 'player' | 'ai'
  const [playerLastColor, setPlayerLastColor] = React.useState(null);
  const [aiLastColor, setAiLastColor] = React.useState(null);
  const [gameOver, setGameOver] = React.useState(null); // 'player' | 'ai' | null

  // determining the starting cells: player bottom-left, AI top-right
  const startIds = useMemo(() => {
    const topRight = Delaunay.from(sites).find(svgWidth, 0);
    const bottomLeft = Delaunay.from(sites).find(0, svgHeight);
    return { playerStartId: bottomLeft, aiStartId: topRight };
  }, [sites, svgWidth, svgHeight]);

  // initialize ownership when a new game starts
  React.useEffect(() => {
    const next = initialCellsWithCorners.map((c) => ({ ...c }));
    if (startIds.playerStartId != null) next[startIds.playerStartId].owner = 'player';
    if (startIds.aiStartId != null) next[startIds.aiStartId].owner = 'ai';
    setCells(next);
  }, [gameKey, initialCellsWithCorners, startIds]);

  // Index all unique polygon edges (undirected). Used for region boundary or border checks.
  const edgesByKey = useMemo(() => {
    const map = new Map();
    const round = (n) => Math.round(n * 1000) / 1000; // stabilize floating point keys
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
  }, [cells]);

  // Visual adjacency: two cells are neighbors only if they share a visible clipped edge
  const visualNeighbors = useMemo(() => {
    const neighborSets = new Map(); // id -> Set of neighbor ids
    for (const cell of cells) neighborSets.set(cell.id, new Set());
    for (const owners of edgesByKey.values()) {
      if (owners.length === 2) {
        const a = owners[0].cellId;
        const b = owners[1].cellId;
        neighborSets.get(a).add(b);
        neighborSets.get(b).add(a);
      }
    }
    const result = new Map();
    for (const [id, set] of neighborSets.entries()) result.set(id, Array.from(set));
    return result;
  }, [edgesByKey, cells]);

  // Interaction state (hover only)
  const [hoveredCell, setHoveredCell] = React.useState(null);

  const handleTryAgain = () => {
    setTurn('player');
    setPlayerLastColor(null);
    setAiLastColor(null);
    setGameOver(null);
    setHoveredCell(null);
    setGameKey((k) => k + 1);
  };

  // Utility: get owned ids for a side
  const ownedIds = (owner) => cells.filter(c => c.owner === owner).map(c => c.id);

  // Utility: compute legal colors for a side based on constraints
  const computeLegalColors = (owner) => {
    const lastSelf = owner === 'player' ? playerLastColor : aiLastColor;
    const lastOpp = owner === 'player' ? aiLastColor : playerLastColor;
    const startId = owner === 'player' ? startIds.playerStartId : startIds.aiStartId;
    const startColor = startId != null ? cells[startId].color : null;
    const baseForbidden = new Set([lastSelf, lastOpp].filter(Boolean));
    // First move cannot be the initial starting color
    if (lastSelf === null) {
      if (startColor) baseForbidden.add(startColor);
    }
    return PALETTE.filter(c => !baseForbidden.has(c));
  };

  // Expand ownership for a side given a chosen color
  const applyMove = (owner, color) => {
    setCells((prev) => {
      const next = prev.map((c) => ({ ...c }));
      const owned = new Set(next.filter(c => c.owner === owner).map(c => c.id));
      if (owned.size === 0) return next;
      // Recolor owned cells
      owned.forEach((id) => { next[id].color = color; });
      // Flood fill adjacent unowned cells that match the color
      const queue = [...owned];
      const visited = new Set(queue);
      while (queue.length > 0) {
        const cid = queue.shift();
        const nbs = visualNeighbors.get(cid) || [];
        for (const nb of nbs) {
          if (visited.has(nb)) continue;
          visited.add(nb);
          // Skip opponent-owned cells (no capture)
          if (next[nb].owner && next[nb].owner !== owner) continue;
          if (next[nb].owner === owner) {
            // ensure recolor propagates across own territory
            if (next[nb].color !== color) next[nb].color = color;
            queue.push(nb);
            continue;
          }
          // Unowned cell of chosen color becomes owned
          if (next[nb].owner === null && next[nb].color === color) {
            next[nb].owner = owner;
            next[nb].color = color;
            queue.push(nb);
            owned.add(nb);
          }
        }
      }
      return next;
    });
    // Update last color
    if (owner === 'player') setPlayerLastColor(color); else setAiLastColor(color);
  };

  // Player clicks a color button
  const handlePlayerChooseColor = (color) => {
    if (turn !== 'player' || gameOver) return;
    const legal = new Set(computeLegalColors('player'));
    if (!legal.has(color)) return;
    applyMove('player', color);
    setTurn('ai');
  };

  // AI chooses best color (most cells captured via flood fill) under constraints
  React.useEffect(() => {
    if (turn !== 'ai' || gameOver) return;
    // Slight delay to visualize turns
    const t = setTimeout(() => {
      const legal = new Set(computeLegalColors('ai'));
      // Pick the color that captures the most cells (including same-color chains)
      let best = null; let bestCount = -1;
      for (const col of PALETTE) {
        if (!legal.has(col)) continue;
        const cnt = countCapturesForMove(cells, visualNeighbors, 'ai', col);
        if (cnt > bestCount) { best = col; bestCount = cnt; }
      }
      // If no frontier match, pick any legal color different from current to recolor
      if (!best) {
        for (const col of PALETTE) {
          if (legal.has(col)) { best = col; break; }
        }
      }
      if (best) {
        applyMove('ai', best);
      }
      setTurn('player');
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, gameOver, cells]);

  const controlStats = useMemo(() => {
    const total = cells.length;
    const playerCount = cells.filter((c) => c.owner === 'player').length;
    const aiCount = cells.filter((c) => c.owner === 'ai').length;
    const playerPercent = total > 0 ? Math.round((playerCount / total) * 100) : 0;
    const aiPercent = total > 0 ? Math.round((aiCount / total) * 100) : 0;
    return { total, playerCount, aiCount, playerPercent, aiPercent };
  }, [cells]);

  // Detect game over: if one side controls more than 50% of cells
  React.useEffect(() => {
    if (gameOver) return;
    if (controlStats.playerPercent > 50) setGameOver('player');
    else if (controlStats.aiPercent > 50) setGameOver('ai');
  }, [controlStats, gameOver]);

  // Compute region boundary segments for each owner (only the outer outline edges)
  const playerBoundary = useMemo(() => {
    const ownedSet = new Set(cells.filter(c => c.owner === 'player').map(c => c.id));
    const boundary = [];
    for (const owners of edgesByKey.values()) {
      const inOwned = owners.filter(o => ownedSet.has(o.cellId));
      if (inOwned.length === 0) continue;
      const outOwned = owners.filter(o => !ownedSet.has(o.cellId));
      if (owners.length === 1) { boundary.push(inOwned[0]); continue; }
      if (outOwned.length > 0 && inOwned.length > 0) boundary.push(inOwned[0]);
    }
    return boundary;
  }, [cells, edgesByKey]);
  const aiBoundary = useMemo(() => {
    const ownedSet = new Set(cells.filter(c => c.owner === 'ai').map(c => c.id));
    const boundary = [];
    for (const owners of edgesByKey.values()) {
      const inOwned = owners.filter(o => ownedSet.has(o.cellId));
      if (inOwned.length === 0) continue;
      const outOwned = owners.filter(o => !ownedSet.has(o.cellId));
      if (owners.length === 1) { boundary.push(inOwned[0]); continue; }
      if (outOwned.length > 0 && inOwned.length > 0) boundary.push(inOwned[0]);
    }
    return boundary;
  }, [cells, edgesByKey]);

  // On hover, track for subtle styling (no recolor in game mode)
  const handleCellHover = (cell) => {
    setHoveredCell(cell);
  };

  // Clear hover on leave
  const handleMouseLeave = () => {
    setHoveredCell(null);
  };

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', width: '90vw' }}>
      <div style={{ position: 'relative', width: svgWidth, height: svgHeight }}>
      <svg width={svgWidth} height={svgHeight}>
        {cells.map((cell) => {
        // Derived flags for visual state
        const isHovered =
          hoveredCell &&
          (cell.id === hoveredCell.id || (visualNeighbors.get(hoveredCell.id) || []).includes(cell.id));

        // Compute fill color with selection/hover priority (corner cells keep their base color)
        const fillColor =
            isHovered
            ? "orange"
            : cell.color;

        // Regular thin internal borders for all cells; thick outer borders are drawn as overlays
        const fillStroke = 'black';
        const widthStroke = 1;
        const zIndex = isHovered ? 'z-10' : 'z-1';

          return (
            <path
              key={cell.id}
              d={cell.path}
              fill={fillColor}
              filter={`url(#lightEffect${cell.id})`}
              stroke={fillStroke}
              strokeWidth={widthStroke}
              onMouseEnter={() => handleCellHover(cell)}
              onMouseLeave={handleMouseLeave}
              // clicks are handled via palette buttons in game mode
              className={zIndex}
            />
          );
        })}
        {/* Thick outer border overlays for owned regions */}
        {playerBoundary.length > 0 && (
          <g pointerEvents="none">
            {playerBoundary.map((seg, i) => (
              <path
                key={`p-boundary-${i}`}
                d={`M ${seg.a[0]} ${seg.a[1]} L ${seg.b[0]} ${seg.b[1]}`}
                fill="none"
                stroke="dodgerblue"
                strokeWidth={6}
              />
            ))}
          </g>
        )}
        {aiBoundary.length > 0 && (
          <g pointerEvents="none">
            {aiBoundary.map((seg, i) => (
              <path
                key={`a-boundary-${i}`}
                d={`M ${seg.a[0]} ${seg.a[1]} L ${seg.b[0]} ${seg.b[1]}`}
                fill="none"
                stroke="crimson"
                strokeWidth={6}
              />
            ))}
          </g>
        )}
      </svg>
      {gameOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.55)',
          }}
        >
          <div
            style={{
              background: 'white',
              borderRadius: 12,
              padding: '28px 36px',
              textAlign: 'center',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
              minWidth: 280,
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
              {gameOver === 'player' ? 'PLAYER WINS' : 'AI WINS'}
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 20 }}>
              <div>PLAYER controls {controlStats.playerPercent}%</div>
              <div>AI controls {controlStats.aiPercent}%</div>
            </div>
            <button
              type="button"
              onClick={handleTryAgain}
              style={{
                padding: '10px 24px',
                fontSize: 16,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                background: '#222',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              TRY AGAIN
            </button>
          </div>
        </div>
      )}
      </div>
      {/* Controls below the field */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {gameOver ? 'Game over' : (turn === 'player' ? 'Your turn' : 'AI thinking...')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PALETTE.map((c) => {
            const legal = computeLegalColors('player');
            const disabled = turn !== 'player' || gameOver || !legal.includes(c);
            return (
              <button key={c} onClick={() => handlePlayerChooseColor(c)} disabled={disabled} style={{ width: 32, height: 32, borderRadius: 4, border: '1px solid #333', background: c, opacity: disabled ? 0.4 : 1 }} />
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: '#333' }}>
          Constraints: not your previous color, not AI last color{playerLastColor === null ? ', not your starting color (first move)' : ''}.
        </div>
      </div>
    </div>
  );
};

// Breadth-first search of connected cells that share the same color
const findSameColorNeighbors = (cellId, cells) => {
  const visited = new Set();
  const queue = [cellId];
  const targetColor = cells[cellId].color;
  const sameColorCells = [];

  while (queue.length > 0) {
    const currentCellId = queue.shift();

    if (visited.has(currentCellId)) continue;
    visited.add(currentCellId);

    if (cells[currentCellId].color === targetColor) {
      sameColorCells.push(currentCellId);

      const neighbors = cells[currentCellId].neighbors;
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push(neighborId);
        }
      }
    }
  }

  return sameColorCells;
};

export default VoronoiDiagram;
"use client"; // This file runs on the client (enables hooks/event handlers)

import React, { useMemo } from "react"; // React and memoization for derived data
import { Delaunay } from "d3-delaunay"; // Delaunay/Voronoi utilities

// Fixed SVG viewport size (pixels)
const width = 800;
const height = 600;

// Create random site points within the viewport
const generateSites = (numPoints, width, height) => {
  let sites = [];
  for (let i = 0; i < numPoints; i++) {
    sites.push([Math.random() * width, Math.random() * height]);
  }
  return sites;
};

// Build Delaunay triangulation and derived Voronoi diagram clipped to our viewport
const generateVoronoi = (sites, width, height) => {
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  return { delaunay, voronoi };
};

// Convert sites into renderable cell objects with geometry, color and adjacency
const PALETTE = ['orangered', 'goldenrod', 'khaki', 'orchid', 'yellowgreen', 'cadetblue'];
const createCells = (sites, voronoi, delaunay) => {
  return sites.map((site, index) => ({
    id: index,
    site: site,
    path: voronoi.renderCell(index), // SVG path string for this Voronoi cell
    polygon: voronoi.cellPolygon(index), // Array of points [x,y] describing the cell polygon (closed)
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    neighbors: Array.from(delaunay.neighbors(index)) || [], // Cell adjacency from Delaunay graph
    owner: null, // 'player' | 'ai' | null
  }));
};

// Find which cells contain the four viewport corners so we can treat them specially if needed
const getCornerCellIds = (delaunay) => {
  const topLeft = delaunay.find(0, 0);
  const topRight = delaunay.find(width, 0);
  const bottomLeft = delaunay.find(0, height);
  const bottomRight = delaunay.find(width, height);
  return new Set([topLeft, topRight, bottomLeft, bottomRight]);
};


// Main interactive Voronoi diagram component
const VoronoiDiagram = ({ numPoints = 50 }) => {
  // Stable set of random sites for the given count
  const initialSites = useMemo(() => generateSites(numPoints, width, height), [numPoints]);
  const sites = useMemo(() => [...initialSites], [initialSites]);

  // Geometry derivations
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, width, height), [sites]);
  const baseCells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  // Identify which cells contain the four corners and mark them
  const cornerCellIds = useMemo(() => getCornerCellIds(delaunay), [delaunay]);
  const initialCellsWithCorners = useMemo(() =>
    baseCells.map((cell) =>
      cornerCellIds.has(cell.id)
        ? { ...cell, isCorner: true }
        : { ...cell, isCorner: false }
    ),
  [baseCells, cornerCellIds]);

  // Game state
  const [cells, setCells] = React.useState(initialCellsWithCorners);
  const [turn, setTurn] = React.useState('player'); // 'player' | 'ai'
  const [playerLastColor, setPlayerLastColor] = React.useState(null);
  const [aiLastColor, setAiLastColor] = React.useState(null);
  const [gameOver, setGameOver] = React.useState(null); // 'player' | 'ai' | null

  // Determine starting cells: player bottom-left, AI top-right
  const startIds = useMemo(() => {
    const topRight = Delaunay.from(sites).find(width, 0);
    const bottomLeft = Delaunay.from(sites).find(0, height);
    return { playerStartId: bottomLeft, aiStartId: topRight };
  }, [sites]);

  // Initialize ownership once on mount
  React.useEffect(() => {
    setCells((prev) => {
      const next = prev.map((c) => ({ ...c }));
      if (startIds.playerStartId != null) next[startIds.playerStartId].owner = 'player';
      if (startIds.aiStartId != null) next[startIds.aiStartId].owner = 'ai';
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Interaction state (hover only)
  const [hoveredCell, setHoveredCell] = React.useState(null);

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
        const nbs = next[cid].neighbors;
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

  // AI chooses best color (most frequent along AI frontier) under constraints
  React.useEffect(() => {
    if (turn !== 'ai' || gameOver) return;
    // Slight delay to visualize turns
    const t = setTimeout(() => {
      const legal = new Set(computeLegalColors('ai'));
      const aiOwned = new Set(ownedIds('ai'));
      const counts = new Map();
      for (const id of aiOwned) {
        for (const nb of cells[id].neighbors) {
          if (aiOwned.has(nb)) continue;
          if (cells[nb].owner) continue; // cannot capture
          const c = cells[nb].color;
          if (!legal.has(c)) continue;
          counts.set(c, (counts.get(c) || 0) + 1);
        }
      }
      // Pick the color with max count; tie-breaker: first in palette order
      let best = null; let bestCount = -1;
      for (const col of PALETTE) {
        if (!legal.has(col)) continue;
        const cnt = counts.get(col) || 0;
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

  // Detect game over: if all border cells are owned by a single side
  const isBorderPoint = (p) => {
    const [x, y] = p;
    const eps = 1e-3;
    return x < eps || y < eps || Math.abs(x - width) < eps || Math.abs(y - height) < eps;
  };
  React.useEffect(() => {
    if (gameOver) return;
    const borderCellIds = cells.filter(c => (c.polygon || []).some(isBorderPoint)).map(c => c.id);
    if (borderCellIds.length === 0) return;
    const ownedByPlayer = borderCellIds.every(id => cells[id].owner === 'player');
    const ownedByAi = borderCellIds.every(id => cells[id].owner === 'ai');
    if (ownedByPlayer) setGameOver('player');
    else if (ownedByAi) setGameOver('ai');
  }, [cells, gameOver]);

  // On hover, track for subtle styling (no recolor in game mode)
  const handleCellHover = (cell) => {
    setHoveredCell(cell);
  };

  // Restore colors on hover end
  const handleMouseLeave = () => {
    if (hoveredCell && !hoveredCell.isCorner) {
      const sameColorCells = findSameColorNeighbors(hoveredCell.id, cells);
      sameColorCells.forEach((cellId) => {
        if (!cells[cellId].isCorner) {
          cells[cellId].color = hoveredCell.color;
        }
      });
    }
    setHoveredCell(null);
  };

  return (
    <svg width={width} height={height}>
      {cells.map((cell) => {
        // Derived flags for visual state
        const isHovered =
          hoveredCell &&
          Array.isArray(hoveredCell.neighbors) &&
          (cell.id === hoveredCell.id || hoveredCell.neighbors.includes(cell.id));

        // Compute fill color with selection/hover priority (corner cells keep their base color)
        const fillColor =
            isHovered
            ? "orange"
            : cell.color;

        // Stroke by ownership
        const fillStroke =
            cell.owner === 'player' ? 'dodgerblue'
            : cell.owner === 'ai' ? 'crimson'
            : 'black';
        const widthStroke = (cell.owner ? 2 : 1);
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
            onClick={() => handleCellClick(cell)}
            className={zIndex}
          />
        );
      })}
      {/* Palette controls and status overlay */}
      <foreignObject x="10" y="10" width="300" height="200">
        <div xmlns="http://www.w3.org/1999/xhtml" style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.8)', padding: 8, borderRadius: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {gameOver ? (gameOver === 'player' ? 'Game over: You win!' : 'Game over: AI wins!') : (turn === 'player' ? 'Your turn' : 'AI thinking...')}
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
      </foreignObject>
    </svg>
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
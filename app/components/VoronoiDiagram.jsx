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

// AI search knobs — change these if thinking is too slow or too shallow.
// `belowPercent` is compared to occupied share: (player cells + AI cells) / all cells.
// Example: 10% player + 12% AI → 22% occupied, so the first matching band applies.
// `branch` = AI turns where EVERY legal color is tried (this is what sees 5–7 step sacrifices).
// `tail` = extra AI turns after that, greedy only (cheap mop-up, not a sacrifice search).
// Player replies in the simulation are always greedy (one choice), so the tree stays ~4^branch.
const AI_SEARCH = {
  maxMs: 80,
  maxNodes: 12000,
  bands: [
    { belowPercent: 14, branch: 7, tail: 3 },
    { belowPercent: 28, branch: 6, tail: 3 },
    { belowPercent: 42, branch: 5, tail: 2 },
    { belowPercent: 56, branch: 4, tail: 2 },
    { belowPercent: 70, branch: 3, tail: 1 },
    { belowPercent: 84, branch: 2, tail: 1 },
    { belowPercent: 100, branch: 1, tail: 1 },

  ],
};

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

// Pure flood-fill of one color choice. Returns a new board plus how many unowned cells were taken.
const applyMoveToCells = (cells, visualNeighbors, owner, color) => {
  const next = cells.map((c) => ({ ...c }));
  const owned = new Set(next.filter((c) => c.owner === owner).map((c) => c.id));
  if (owned.size === 0) return { cells: next, captures: 0 };
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
  return { cells: next, captures };
};

// Same color bans as the live game, but works on any simulated last-colors and board.
const getLegalColors = (owner, lastPlayer, lastAi, startIds, cells) => {
  const lastSelf = owner === 'player' ? lastPlayer : lastAi;
  const lastOpp = owner === 'player' ? lastAi : lastPlayer;
  const startId = owner === 'player' ? startIds.playerStartId : startIds.aiStartId;
  const startColor = startId != null && cells[startId] ? cells[startId].color : null;
  const forbidden = new Set([lastSelf, lastOpp].filter(Boolean));
  if (lastSelf === null && startColor) forbidden.add(startColor);
  return PALETTE.filter((c) => !forbidden.has(c));
};

// Immediate capture count for a color (used by tie detection and greedy replies).
const countCapturesForMove = (cells, visualNeighbors, owner, color) =>
  applyMoveToCells(cells, visualNeighbors, owner, color).captures;

// Apply the legal color that captures the most cells right now. Returns null if none.
const applyGreedyMove = (cells, visualNeighbors, owner, lastPlayer, lastAi, startIds) => {
  const legal = getLegalColors(owner, lastPlayer, lastAi, startIds, cells);
  let best = null;
  for (const color of legal) {
    const move = applyMoveToCells(cells, visualNeighbors, owner, color);
    if (!best || move.captures > best.captures) best = { ...move, color };
  }
  return best;
};

const searchBudgetExceeded = (budget) =>
  budget.nodes >= budget.maxNodes || (performance.now() - budget.start) >= budget.maxMs;

const planFromOccupiedPercent = (occupiedPercent) =>
  AI_SEARCH.bands.find((band) => occupiedPercent < band.belowPercent) || AI_SEARCH.bands[AI_SEARCH.bands.length - 1];

// After an AI move: player replies greedy, then remaining AI turns (search or greedy).
const capturesAfterAiMove = (board, visualNeighbors, startIds, lastPlayer, lastAi, branchLeft, tail, budget) => {
  if (branchLeft <= 0 && tail <= 0) return 0;

  const playerMove = applyGreedyMove(board, visualNeighbors, 'player', lastPlayer, lastAi, startIds);
  if (playerMove) {
    board = playerMove.cells;
    lastPlayer = playerMove.color;
  }

  const useSearch = branchLeft > 0 && !searchBudgetExceeded(budget);
  if (useSearch) {
    const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, board);
    let best = 0;
    for (const color of legal) {
      budget.nodes += 1;
      const move = applyMoveToCells(board, visualNeighbors, 'ai', color);
      const rest = capturesAfterAiMove(
        move.cells, visualNeighbors, startIds, lastPlayer, color, branchLeft - 1, tail, budget,
      );
      const total = move.captures + rest;
      if (total > best) best = total;
    }
    return best;
  }

  const greedyTurns = (branchLeft > 0 ? branchLeft : 0) + tail;
  let total = 0;
  let simLastAi = lastAi;
  for (let i = 0; i < greedyTurns; i++) {
    const aiMove = applyGreedyMove(board, visualNeighbors, 'ai', lastPlayer, simLastAi, startIds);
    if (!aiMove) break;
    total += aiMove.captures;
    board = aiMove.cells;
    simLastAi = aiMove.color;
    if (i === greedyTurns - 1) break;
    const nextPlayer = applyGreedyMove(board, visualNeighbors, 'player', lastPlayer, simLastAi, startIds);
    if (nextPlayer) {
      board = nextPlayer.cells;
      lastPlayer = nextPlayer.color;
    }
  }
  return total;
};

// Score locking in `firstColor` now, then searching later AI color choices.
const scoreColorLookahead = (cells, visualNeighbors, startIds, lastPlayer, lastAi, firstColor, branch, tail, budget) => {
  const first = applyMoveToCells(cells, visualNeighbors, 'ai', firstColor);
  return first.captures + capturesAfterAiMove(
    first.cells, visualNeighbors, startIds, lastPlayer, firstColor, branch - 1, tail, budget,
  );
};

// Deepen one ply at a time so a time/node cap never scores some first colors deeper than others.
const pickAiColorWithSearch = (cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent) => {
  const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, cells);
  if (legal.length === 0) return null;
  const plan = planFromOccupiedPercent(totalPercent);
  const startedAt = performance.now();
  let bestColor = legal[0];

  for (let depth = 1; depth <= plan.branch; depth++) {
    if (performance.now() - startedAt >= AI_SEARCH.maxMs) break;
    const budget = {
      nodes: 0,
      maxNodes: AI_SEARCH.maxNodes,
      start: startedAt,
      maxMs: AI_SEARCH.maxMs,
    };
    let iterColor = null;
    let iterScore = -1;
    let iterImmediate = -1;
    let finished = true;
    for (const color of legal) {
      if (searchBudgetExceeded(budget)) {
        finished = false;
        break;
      }
      const score = scoreColorLookahead(
        cells, visualNeighbors, startIds, lastPlayer, lastAi, color, depth, plan.tail, budget,
      );
      const immediate = countCapturesForMove(cells, visualNeighbors, 'ai', color);
      if (score > iterScore || (score === iterScore && immediate > iterImmediate)) {
        iterColor = color;
        iterScore = score;
        iterImmediate = immediate;
      }
    }
    if (!finished || iterColor == null) break;
    bestColor = iterColor;
  }

  return bestColor;
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
  const [gameOver, setGameOver] = React.useState(null); // 'player' | 'ai' | 'tie' | null

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
    setGameOver(null);
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
    setHoveredCell(null);
    setGameKey((k) => k + 1);
  };

  // Utility: get owned ids for a side
  const ownedIds = (owner) => cells.filter(c => c.owner === owner).map(c => c.id);

  // Utility: compute legal colors for a side based on constraints
  const computeLegalColors = (owner) =>
    getLegalColors(owner, playerLastColor, aiLastColor, startIds, cells);

  // Expand ownership for a side given a chosen color
  const applyMove = (owner, color) => {
    setCells((prev) => applyMoveToCells(prev, visualNeighbors, owner, color).cells);
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

  // AI chooses the legal color with the highest lookahead capture total
  React.useEffect(() => {
    if (turn !== 'ai' || gameOver) return;
    // Slight delay to visualize turns
    const t = setTimeout(() => {
      const legal = computeLegalColors('ai');
     // const aiOwned = cells.filter((c) => c.owner === 'ai').length;
    // const aiPercent = cells.length > 0 ? (aiOwned / cells.length) * 100 : 0;
    const totalOwned = cells.filter((c) => c.owner === 'ai' || c.owner === 'player').length;
    const totalPercent = cells.length > 0 ? (totalOwned / cells.length) * 100 : 0;
      const best = pickAiColorWithSearch(
        cells,
        visualNeighbors,
        startIds,
        playerLastColor,
        aiLastColor,
        totalPercent,
      ) || legal[0];
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

  // Detect game over: win above 50%, or 50-50 with no captures left
  React.useEffect(() => {
    if (gameOver) return;
    if (controlStats.playerPercent > 50) setGameOver('player');
    else if (controlStats.aiPercent > 50) setGameOver('ai');
    else if (controlStats.playerPercent === 50 && controlStats.aiPercent === 50) {
      let anyCaptures = false;
      for (const owner of ['player', 'ai']) {
        for (const col of computeLegalColors(owner)) {
          if (countCapturesForMove(cells, visualNeighbors, owner, col) > 0) {
            anyCaptures = true;
            break;
          }
        }
        if (anyCaptures) break;
      }
      if (!anyCaptures) setGameOver('tie');
    }
  }, [controlStats, gameOver, cells, visualNeighbors, playerLastColor, aiLastColor, startIds]);

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
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center  ', width: '90vw' }}>
      <div style={{ position: 'relative', width: svgWidth, height: svgHeight }}>
      <svg width={svgWidth} height={svgHeight}>
      





        {cells.map((cell) => {
        const isHovered = hoveredCell && cell.id === hoveredCell.id;

          return (
            <path
              key={cell.id}
              d={cell.path}
              fill={cell.color}
              filter={`url(#lightEffect${cell.id})`}
              stroke="black"
              strokeWidth={isHovered ? 3 : 1}
              onMouseEnter={() => handleCellHover(cell)}
              onMouseLeave={handleMouseLeave}
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
              {gameOver === 'tie' ? 'ITS A TIE' : gameOver === 'player' ? 'PLAYER WINS' : 'AI WINS'}
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
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>
          {gameOver ? 'Game over' : (turn === 'player' ? 'Your turn' : 'AI thinking...')}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {PALETTE.map((c) => {
            const legal = computeLegalColors('player');
            const disabled = turn !== 'player' || gameOver || !legal.includes(c);
            return (
              <button key={c} onClick={() => handlePlayerChooseColor(c)} disabled={disabled} style={{ width: 64, height: 32, borderRadius: 4, border: '1px solid #333', background: c, opacity: disabled ? 0.4 : 1 }} />
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



export default VoronoiDiagram;
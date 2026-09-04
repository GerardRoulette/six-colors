"use client"; 

import React, { useMemo } from "react"; 
import { Delaunay } from "d3-delaunay";
import { LanguageToggle, useTranslation } from "./LanguageSelector";

// Shared look for FAQ / difficulty chrome buttons in the row above the board.
const TOOLBAR_BUTTON_STYLE = {
  padding: '6px 14px',
  fontSize: 14,
  fontWeight: 600,
  height: 38,
  border: '1px solid #fff',
  borderRadius: 8,
  background: '#000',
  color: '#fff',
};

// Overlay actions (Try again / Close): same black fill, white border, and white label as the toolbar.
const OVERLAY_BUTTON_STYLE = {
  padding: '10px 24px',
  fontSize: 16,
  fontWeight: 600,
  border: '1px solid #fff',
  borderRadius: 8,
  background: '#000',
  color: '#fff',
  cursor: 'pointer',
};

// Horizontal padding on Home (`padding: 16` each side). Board + palette must fit inside it.
const PAGE_PADDING_X = 16;
// Space between adjacent palette swatches (px).
const PALETTE_GAP = 4;
// Default palette button edge; shrinks on narrow screens so six swatches stay on one row.
const PALETTE_BUTTON_MAX = 64;

// responsive viewport (computed from window size)
// Returns SVG pixel size from the window (~90% × ~70%). Width never exceeds the padded viewport so the board and color row stay on-screen. SSR fallback is 800×600 because `window` is missing.
const computeSize = () => {
  if (typeof window === 'undefined') return { w: 800, h: 600 };
  // Usable width inside Home's left/right padding.
  const paddedWidth = window.innerWidth - PAGE_PADDING_X * 2;
  const w = Math.max(1, Math.min(Math.floor(window.innerWidth * 0.9), paddedWidth));
  const h = Math.max(300, Math.floor(window.innerHeight * 0.7));
  return { w, h };
};

// random diagram generation
// `numPoints` random [x, y] sites in the SVG rectangle; these become Voronoi cell seeds.
const generateSites = (numPoints, width, height) => {
  let sites = [];
  for (let i = 0; i < numPoints; i++) {
    sites.push([Math.random() * width, Math.random() * height]);
  }
  return sites;
};

// generating the Voronoi diagram
// Delaunay triangulation of `sites`, then a Voronoi clipped to [0, 0, width, height].
const generateVoronoi = (sites, width, height) => {
  const delaunay = Delaunay.from(sites);
  const voronoi = delaunay.voronoi([0, 0, width, height]);
  return { delaunay, voronoi };
};

// Six legal fill colors (CSS names). Players pick from this list; cells are initialized randomly from it.
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
    { belowPercent: 30, branch: 7, tail: 3 },
    { belowPercent: 40, branch: 6, tail: 3 },
    { belowPercent: 45, branch: 5, tail: 2 },
    { belowPercent: 50, branch: 4, tail: 2 },
    { belowPercent: 55, branch: 3, tail: 1 },
    { belowPercent: 60, branch: 2, tail: 1 },
    { belowPercent: 100, branch: 1, tail: 1 },

  ],
};

// converting sites into cell objects with needed properties
// One board cell per site: SVG path, polygon, random color, Delaunay neighbors, no owner yet.
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
// Closest sites to the four SVG corners via Delaunay.find; returned as a Set of cell ids (marked `isCorner` in the UI board).
const getCornerCellIds = (delaunay, width, height) => {
  const topLeft = delaunay.find(0, 0); 
  const topRight = delaunay.find(width, 0);
  const bottomLeft = delaunay.find(0, height); 
  const bottomRight = delaunay.find(width, height);
  return new Set([topLeft, topRight, bottomLeft, bottomRight]);
};

// Pure flood-fill of one color choice. Returns a new board plus how many unowned cells were taken.
// Recolors already-owned cells to `color`, then BFS through `visualNeighbors` to capture unowned same-color neighbors. Does not mutate `cells`.
const applyMoveToCells = (cells, visualNeighbors, owner, color) => {
  // Shallow-copied board so the search/UI can keep the previous `cells` array.
  const next = cells.map((c) => ({ ...c }));
  // Frontier of this side's territory (grows as unowned matching cells are taken).
  const owned = new Set(next.filter((c) => c.owner === owner).map((c) => c.id));
  if (owned.size === 0) return { cells: next, captures: 0 };
  owned.forEach((id) => { next[id].color = color; });
  const queue = [...owned];
  const visited = new Set(queue);
  // Count of previously unowned cells claimed this move (not recolors of already-owned cells).
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
// Illegal: last color used by this side, last color used by the opponent; at match start both starting-cell colors; on a later first move for this side, that side's starting-cell color. Returns the remaining PALETTE entries.
const getLegalColors = (owner, lastPlayer, lastAi, startIds, cells) => {
  const lastSelf = owner === 'player' ? lastPlayer : lastAi;
  const lastOpp = owner === 'player' ? lastAi : lastPlayer;
  // Color currently on the player's bottom-left start cell (original until the player has moved).
  const playerStartColor = startIds.playerStartId != null && cells[startIds.playerStartId]
    ? cells[startIds.playerStartId].color
    : null;
  // Color currently on the AI's top-right start cell (original until the AI has moved).
  const aiStartColor = startIds.aiStartId != null && cells[startIds.aiStartId]
    ? cells[startIds.aiStartId].color
    : null;
  // This side's start-cell color, used when they have not moved yet but the opponent already has.
  const ownStartColor = owner === 'player' ? playerStartColor : aiStartColor;
  // Last colors already used; start-cell colors are added only before this side (or the match) has moved.
  const forbidden = new Set([lastSelf, lastOpp].filter(Boolean));
  if (lastPlayer === null && lastAi === null) {
    if (playerStartColor) forbidden.add(playerStartColor);
    if (aiStartColor) forbidden.add(aiStartColor);
  } else if (lastSelf === null && ownStartColor) {
    forbidden.add(ownStartColor);
  }
  return PALETTE.filter((c) => !forbidden.has(c));
};

// Immediate capture count for a color (used by tie detection and greedy replies).
const countCapturesForMove = (cells, visualNeighbors, owner, color) =>
  applyMoveToCells(cells, visualNeighbors, owner, color).captures;

// Apply the legal color that captures the most cells right now. Returns null if none.
const applyGreedyMove = (cells, visualNeighbors, owner, lastPlayer, lastAi, startIds) => {
  const legal = getLegalColors(owner, lastPlayer, lastAi, startIds, cells);
  // `{ cells, captures, color }` of the legal color with the most immediate captures.
  let best = null;
  for (const color of legal) {
    const move = applyMoveToCells(cells, visualNeighbors, owner, color);
    if (!best || move.captures > best.captures) best = { ...move, color };
  }
  return best;
};

// True when the search has hit `maxNodes` or `maxMs` since `budget.start` (so the tree should stop expanding).
const searchBudgetExceeded = (budget) =>
  budget.nodes >= budget.maxNodes || (performance.now() - budget.start) >= budget.maxMs;

// First AI_SEARCH band whose `belowPercent` is greater than current occupancy; last band if somehow none match.
const planFromOccupiedPercent = (occupiedPercent) =>
  AI_SEARCH.bands.find((band) => occupiedPercent < band.belowPercent) || AI_SEARCH.bands[AI_SEARCH.bands.length - 1];

// After an AI move: player replies greedy, then remaining AI turns (search or greedy).
// Returns extra captures from those later AI turns (not including the first AI ply already applied by the caller).
const capturesAfterAiMove = (board, visualNeighbors, startIds, lastPlayer, lastAi, branchLeft, tail, budget) => {
  if (branchLeft <= 0 && tail <= 0) return 0;

  const playerMove = applyGreedyMove(board, visualNeighbors, 'player', lastPlayer, lastAi, startIds);
  if (playerMove) {
    board = playerMove.cells;
    lastPlayer = playerMove.color;
  }

  // Branching search only while `branchLeft` remains and the time/node budget is not spent.
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

  // Remaining AI plies when search is skipped: leftover branch depth plus cheap `tail` mop-up.
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
  // Immediate AI ply for `firstColor`; later plies are scored by `capturesAfterAiMove`.
  const first = applyMoveToCells(cells, visualNeighbors, 'ai', firstColor);
  return first.captures + capturesAfterAiMove(
    first.cells, visualNeighbors, startIds, lastPlayer, firstColor, branch - 1, tail, budget,
  );
};

// Deepen one ply at a time so a time/node cap never scores some first colors deeper than others.
// Occupancy `totalPercent` selects the search band. Tie-break among equal lookahead scores: more immediate captures. Returns a PALETTE color or null.
const pickAiColorWithSearch = (cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent) => {
  const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, cells);
  if (legal.length === 0) return null;
  const plan = planFromOccupiedPercent(totalPercent);
  const startedAt = performance.now();
  let bestColor = legal[0];

  for (let depth = 1; depth <= plan.branch; depth++) {
    if (performance.now() - startedAt >= AI_SEARCH.maxMs) break;
    // Fresh node counter per depth so a timeout at depth N does not keep a half-scored N+1 ranking.
    const budget = {
      nodes: 0,
      maxNodes: AI_SEARCH.maxNodes,
      start: startedAt,
      maxMs: AI_SEARCH.maxMs,
    };
    let iterColor = null;
    let iterScore = -1;
    let iterImmediate = -1;
    // False if this depth aborted mid-palette; then we keep the previous completed depth's color.
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
// Full game: board geometry, ownership, palette turns, AI search, SVG + overlays. `numPoints` is how many Voronoi cells to generate.
const VoronoiDiagram = ({ numPoints = 50 }) => { // 50 just to have some default value
  // i18n: `t(key, vars)` for status, rules, and the game-over card.
  // i18n: HUD/FAQ copy, plus locale + changeLanguage for the toolbar switcher.
  const { t, locale, changeLanguage } = useTranslation();
  // compute responsive size
  // SVG width/height in pixels; `setSvgSize` reruns site generation on window resize.
  const [{ w: svgWidth, h: svgHeight }, setSvgSize] = React.useState(computeSize());
  React.useEffect(() => {
    const onResize = () => setSvgSize(computeSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // stable set of random sites for the given count
  // Incremented by Try again to rebuild sites/ownership without mutating the current arrays in place.
  const [gameKey, setGameKey] = React.useState(0);
  // Random seeds for this match (depends on `gameKey` so Try again gets a new map).
  const initialSites = useMemo(() => generateSites(numPoints, svgWidth, svgHeight), [numPoints, svgWidth, svgHeight, gameKey]);
  const sites = useMemo(() => [...initialSites], [initialSites]);

  // geometry derivations
  const { delaunay, voronoi } = useMemo(() => generateVoronoi(sites, svgWidth, svgHeight), [sites, svgWidth, svgHeight]);
  // Cells with paths/colors/neighbors, before corner flags and starting ownership.
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
  // Live board: colors, owners, polygons. Updated by `applyMove` / new-game effect.
  const [cells, setCells] = React.useState(initialCellsWithCorners);
  const [turn, setTurn] = React.useState('player'); // 'player' | 'ai'
  // Last color each side played; used with both starting-cell colors to ban illegal palette buttons.
  const [playerLastColor, setPlayerLastColor] = React.useState(null);
  const [aiLastColor, setAiLastColor] = React.useState(null);
  const [gameOver, setGameOver] = React.useState(null); // 'player' | 'ai' | 'tie' | null
  // FAQ overlay visibility; independent of the match so rules can be read mid-game.
  const [faqOpen, setFaqOpen] = React.useState(false);

  // determining the starting cells: player bottom-left, AI top-right
  const startIds = useMemo(() => {
    const topRight = Delaunay.from(sites).find(svgWidth, 0);
    const bottomLeft = Delaunay.from(sites).find(0, svgHeight);
    return { playerStartId: bottomLeft, aiStartId: topRight };
  }, [sites, svgWidth, svgHeight]);

  // initialize ownership when a new game starts
  React.useEffect(() => {
    // Fresh copies so we can assign starting owners without mutating memoized `initialCellsWithCorners`.
    const next = initialCellsWithCorners.map((c) => ({ ...c }));
    if (startIds.playerStartId != null) next[startIds.playerStartId].owner = 'player';
    if (startIds.aiStartId != null) next[startIds.aiStartId].owner = 'ai';
    setCells(next);
    setGameOver(null);
  }, [gameKey, initialCellsWithCorners, startIds]);

  // Index all unique polygon edges (undirected). Used for region boundary or border checks.
  const edgesByKey = useMemo(() => {
    // Undirected edge key → [{ cellId, a, b }, ...]. Length 1 is a map border; 2 is a shared wall.
    const map = new Map();
    const round = (n) => Math.round(n * 1000) / 1000; // stabilize floating point keys
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
    // Same adjacency as arrays (`id` → neighbor id list) for flood-fill `.get(cid)`.
    const result = new Map();
    for (const [id, set] of neighborSets.entries()) result.set(id, Array.from(set));
    return result;
  }, [edgesByKey, cells]);

  // Interaction state (hover only)
  const [hoveredCell, setHoveredCell] = React.useState(null);

  // Reset turn/colors/hover and bump `gameKey` so geometry + starting ownership re-run as a new match.
  const handleTryAgain = () => {
    setTurn('player');
    setPlayerLastColor(null);
    setAiLastColor(null);
    setHoveredCell(null);
    setGameKey((k) => k + 1);
  };

  // Open the rules FAQ overlay (copy lives in locale files under `rules.*`).
  const handleOpenFaq = () => {
    setFaqOpen(true);
  };

  // Dismiss the FAQ overlay (Close button, backdrop click, or Escape).
  const handleCloseFaq = () => {
    setFaqOpen(false);
  };

  // Close FAQ with Escape while it is open.
  React.useEffect(() => {
    if (!faqOpen) return;
    // Keyboard dismiss for the FAQ dialog (same as the Close button).
    const onKeyDown = (event) => {
      if (event.key === 'Escape') handleCloseFaq();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [faqOpen]);

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
    // `t` is the 250ms timer id; cleared if turn/cells change before the AI fires.
    const t = setTimeout(() => {
      const legal = computeLegalColors('ai');
     // const aiOwned = cells.filter((c) => c.owner === 'ai').length;
    // const aiPercent = cells.length > 0 ? (aiOwned / cells.length) * 100 : 0;
    const totalOwned = cells.filter((c) => c.owner === 'ai' || c.owner === 'player').length;
    // Occupancy % for `AI_SEARCH.bands` (not the HUD percents, which are each side vs all cells).
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

  // Cell counts and rounded board-share percents for the HUD and win check.
  const controlStats = useMemo(() => {
    const total = cells.length;
    const playerCount = cells.filter((c) => c.owner === 'player').length;
    const aiCount = cells.filter((c) => c.owner === 'ai').length;
    // Rounded share of the board; win is strictly greater than 50.
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
      // Tie only if neither side still has a legal color that would capture at least one cell.
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
    // Edge segments on the player region outline (map border or shared with a non-player cell).
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
    // Same outline logic as `playerBoundary`, for the crimson AI stroke.
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

  // Swatch edge so PALETTE.length buttons plus gaps fit the board width, capped at PALETTE_BUTTON_MAX.
  const paletteButtonSize = Math.min(
    PALETTE_BUTTON_MAX,
    Math.max(1, Math.floor((svgWidth - PALETTE_GAP * (PALETTE.length - 1)) / PALETTE.length)),
  );

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width: svgWidth, maxWidth: '100%', boxSizing: 'border-box' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'center',
          width: svgWidth,
          marginBottom: 10,
        }}
      >
        <LanguageToggle locale={locale} onChange={changeLanguage} />
        <button
          type="button"
          onClick={handleOpenFaq}
          aria-haspopup="dialog"
          aria-expanded={faqOpen}
          style={{ ...TOOLBAR_BUTTON_STYLE, cursor: 'pointer' }}
        >
          {t('button.faq')}
        </button>
        <button
          type="button"
          disabled
          title={t('toolbar.comingSoon')}
          aria-label={`${t('button.difficulty')} (${t('toolbar.comingSoon')})`}
          style={{ ...TOOLBAR_BUTTON_STYLE, cursor: 'not-allowed', opacity: 0.55 }}
        >
          {t('button.difficulty')}
        </button>
      </div>
      <div style={{ position: 'relative', width: svgWidth, height: svgHeight }}>
      <svg width={svgWidth} height={svgHeight}>
      





        {cells.map((cell) => {
        // Thicker stroke while the pointer is over this cell (hover is display-only).
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
              {gameOver === 'tie' ? t('gameOver.tie') : gameOver === 'player' ? t('gameOver.playerWins') : t('gameOver.aiWins')}
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 20 }}>
              <div>{t('stats.playerControls', { percent: controlStats.playerPercent })}</div>
              <div>{t('stats.aiControls', { percent: controlStats.aiPercent })}</div>
            </div>
            <button
              type="button"
              onClick={handleTryAgain}
              style={OVERLAY_BUTTON_STYLE}
            >
              {t('button.tryAgain')}
            </button>
          </div>
        </div>
      )}
      {faqOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="faq-title"
          onClick={handleCloseFaq}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0, 0, 0, 0.55)',
          }}
        >
          <div
            onClick={(event) => {
              // Clicks on the card must not count as backdrop dismiss.
              event.stopPropagation();
            }}
            style={{
              background: 'white',
              color: '#171717',
              borderRadius: 12,
              padding: '28px 36px',
              textAlign: 'left',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
              minWidth: 280,
              maxWidth: 520,
              maxHeight: '80vh',
              overflow: 'auto',
            }}
          >
            <div id="faq-title" style={{ fontSize: 28, fontWeight: 700, marginBottom: 16 }}>
              {t('rules.title')}
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 12 }}>
              {t('rules.welcome')}
            </div>
            <div style={{ fontSize: 16, lineHeight: 1.6, color: '#333', marginBottom: 20 }}>
              {t('rules.howToPlay')}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: '#555', marginBottom: 20 }}>
              {t('rules.constraints')}
            </div>
            <button
              type="button"
              onClick={handleCloseFaq}
              style={OVERLAY_BUTTON_STYLE}
            >
              {t('button.close')}
            </button>
          </div>
        </div>
      )}
      </div>
      {/* Controls below the field */}
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: svgWidth, maxWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>
          {gameOver ? t('status.gameOver') : (turn === 'player' ? t('status.yourTurn') : t('status.aiThinking'))}
        </div>
        <div style={{ display: 'flex', gap: PALETTE_GAP, flexWrap: 'nowrap', justifyContent: 'center', width: svgWidth, maxWidth: '100%', boxSizing: 'border-box' }}>
          {PALETTE.map((c) => { 
            const legal = computeLegalColors('player');
            // Grey + X when it is not the player's turn, the match ended, or this color is banned.
            const disabled = turn !== 'player' || gameOver || !legal.includes(c);
            return (
              <button
                key={c}
                onClick={() => handlePlayerChooseColor(c)}
                disabled={disabled}
                style={{
                  width: paletteButtonSize,
                  height: paletteButtonSize,
                  flex: '0 0 auto',
                  padding: 0,
                  boxSizing: 'border-box',
                  borderRadius: 4,
                  border: '1px solid #333',
                  background: c,
                  opacity: disabled ? 0.4 : 1,
                }}
              >

{disabled && (
   <svg
   viewBox="0 0 64 32"      // Matches button dimensions exactly
   preserveAspectRatio="none" // Forces stretch to fill the rectangle
   style={{
     position: 'relative',
     top: 0,
     left: 0,
     width: '100%',
     height: '100%',
     display: 'block',
     pointerEvents: 'none',
   }}
 >
   
   
   {/* Pure black X (thinner, drawn on top) */}
   <line x1="0" y1="0" x2="64" y2="32" stroke="black" strokeWidth="7" strokeLinecap="round" />
   <line x1="64" y1="0" x2="0" y2="32" stroke="black" strokeWidth="7" strokeLinecap="round" />
 </svg>)}

              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};



export default VoronoiDiagram;

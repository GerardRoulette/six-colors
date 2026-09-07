"use client"; 

import React, { useMemo } from "react"; 
import { Delaunay } from "d3-delaunay";
import { LanguageToggle, useTranslation } from "./LanguageSelector";
import { PALETTE, applyMoveToCells, getLegalColors, countCapturesForMove } from "../game/moves";
import { pickAiColorEasy } from "../game/aiEasy";
import { pickAiColorMedium } from "../game/aiMedium";
import { pickAiColorHard } from "../game/aiHard";

// localStorage key for the chosen AI difficulty (`easy` | `medium` | `hard`).
const DIFFICULTY_STORAGE_KEY = 'difficulty';
// Selectable AI levels shown in the difficulty overlay, in display order.
const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Default and fallback when storage is missing or invalid (original lookahead AI).
const DEFAULT_DIFFICULTY = 'hard';

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

// Overlay actions (Try again / Close / difficulty rows): same black fill, white border, and white label as the toolbar.
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

// True when `value` is one of the three AI difficulty ids.
const isValidDifficulty = (value) => DIFFICULTIES.includes(value);

// Dispatch to easy (random), medium (depth 1), or hard (occupancy-banded search). Falls back to the first legal color.
// `difficulty` is `'easy'` | `'medium'` | `'hard'`. `legal` is the live legal palette for the AI (fallback if a picker returns null).
// `totalPercent` is occupancy for hard search bands; ignored on easy/medium. Board args match the live AI effect.
const pickAiColorForDifficulty = (
  difficulty,
  cells,
  visualNeighbors,
  startIds,
  lastPlayer,
  lastAi,
  totalPercent,
  legal,
) => {
  // Chosen PALETTE color, or null if that picker found nothing legal.
  let chosen = null;
  if (difficulty === 'easy') {
    chosen = pickAiColorEasy(cells, startIds, lastPlayer, lastAi);
  } else if (difficulty === 'medium') {
    chosen = pickAiColorMedium(cells, visualNeighbors, startIds, lastPlayer, lastAi);
  } else {
    chosen = pickAiColorHard(cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent);
  }
  return chosen || legal[0];
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
  // Difficulty overlay visibility; closed independently of FAQ (opening one closes the other).
  const [difficultyOpen, setDifficultyOpen] = React.useState(false);
  // Active AI level: `'easy'` | `'medium'` | `'hard'`. Starts as hard until localStorage is read.
  const [difficulty, setDifficulty] = React.useState(DEFAULT_DIFFICULTY);

  // determining the starting cells: player bottom-left, AI top-right
  const startIds = useMemo(() => {
    const topRight = Delaunay.from(sites).find(svgWidth, 0);
    const bottomLeft = Delaunay.from(sites).find(0, svgHeight);
    return { playerStartId: bottomLeft, aiStartId: topRight };
  }, [sites, svgWidth, svgHeight]);

  // Restore a saved difficulty on mount; ignore unknown values so a bad key does not break the AI.
  React.useEffect(() => {
    // Previously chosen level, or null when the key is missing.
    const saved = localStorage.getItem(DIFFICULTY_STORAGE_KEY);
    if (isValidDifficulty(saved)) setDifficulty(saved);
  }, []);

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

  // Open the rules FAQ overlay (copy lives in locale files under `rules.*`). Closes difficulty if it was open.
  const handleOpenFaq = () => {
    setDifficultyOpen(false);
    setFaqOpen(true);
  };

  // Dismiss the FAQ overlay (Close button, backdrop click, or Escape).
  const handleCloseFaq = () => {
    setFaqOpen(false);
  };

  // Open the Easy / Medium / Hard chooser. Closes FAQ if it was open.
  const handleOpenDifficulty = () => {
    setFaqOpen(false);
    setDifficultyOpen(true);
  };

  // Dismiss the difficulty overlay (Close, backdrop, Escape, or after picking a level).
  const handleCloseDifficulty = () => {
    setDifficultyOpen(false);
  };

  // Persist `level`, restart the match when it differs from the current AI level, and close the overlay. `level` is `'easy'` | `'medium'` | `'hard'`.
  const handleChooseDifficulty = (level) => {
    if (!isValidDifficulty(level)) return;
    // Skip a new board when the player re-selects the already active level.
    const shouldRestart = level !== difficulty;
    setDifficulty(level);
    localStorage.setItem(DIFFICULTY_STORAGE_KEY, level);
    setDifficultyOpen(false);
    if (shouldRestart) handleTryAgain();
  };

  // Close the topmost overlay with Escape (difficulty first if both were somehow open).
  React.useEffect(() => {
    if (!faqOpen && !difficultyOpen) return;
    // Keyboard dismiss for FAQ or difficulty (same as each overlay's Close button).
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (difficultyOpen) handleCloseDifficulty();
      else handleCloseFaq();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [faqOpen, difficultyOpen]);

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

  // AI chooses a legal color using the selected difficulty (random / depth 1 / occupancy-banded search)
  React.useEffect(() => {
    if (turn !== 'ai' || gameOver) return;
    // Slight delay to visualize turns
    // `t` is the 250ms timer id; cleared if turn/cells/difficulty change before the AI fires.
    const t = setTimeout(() => {
      const legal = computeLegalColors('ai');
     // const aiOwned = cells.filter((c) => c.owner === 'ai').length;
    // const aiPercent = cells.length > 0 ? (aiOwned / cells.length) * 100 : 0;
    const totalOwned = cells.filter((c) => c.owner === 'ai' || c.owner === 'player').length;
    // Occupancy % for hard `AI_SEARCH.bands` (not the HUD percents, which are each side vs all cells).
    const totalPercent = cells.length > 0 ? (totalOwned / cells.length) * 100 : 0;
      const best = pickAiColorForDifficulty(
        difficulty,
        cells,
        visualNeighbors,
        startIds,
        playerLastColor,
        aiLastColor,
        totalPercent,
        legal,
      );
      if (best) {
        applyMove('ai', best);
      }
      setTurn('player');
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, gameOver, cells, difficulty]);

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
          onClick={handleOpenDifficulty}
          aria-haspopup="dialog"
          aria-expanded={difficultyOpen}
          aria-label={`${t('button.difficulty')}: ${t(`difficulty.${difficulty}`)}`}
          style={{ ...TOOLBAR_BUTTON_STYLE, cursor: 'pointer' }}
        >
          {`${t('button.difficulty')}: ${t(`difficulty.${difficulty}`)}`}
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
      {difficultyOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="difficulty-title"
          aria-describedby="difficulty-restart-notice"
          onClick={handleCloseDifficulty}
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
              maxWidth: 420,
            }}
          >
            <div id="difficulty-title" style={{ fontSize: 28, fontWeight: 700, marginBottom: 12 }}>
              {t('difficulty.title')}
            </div>
            <div
              id="difficulty-restart-notice"
              style={{ fontSize: 14, lineHeight: 1.5, color: '#555', marginBottom: 16 }}
            >
              {t('difficulty.restartNotice')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {DIFFICULTIES.map((level) => {
                // Whether this row is the currently saved AI level (pressed styling + aria-pressed).
                const active = difficulty === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => handleChooseDifficulty(level)}
                    aria-pressed={active}
                    style={{
                      ...OVERLAY_BUTTON_STYLE,
                      width: '100%',
                      opacity: active ? 1 : 0.7,
                      outline: active ? '2px solid #171717' : '2px solid transparent',
                      outlineOffset: 2,
                    }}
                  >
                    {t(`difficulty.${level}`)}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={handleCloseDifficulty}
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

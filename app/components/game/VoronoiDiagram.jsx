"use client";

import React, { useMemo } from "react";
import { LanguageToggle, useTranslation } from "../LanguageSelector";
import { applyMoveToCells, getLegalColors, countCapturesForMove } from "../../game/moves";
import { generateSites, generateVoronoi, createCells, getCornerCellIds, getStartIds } from "../../game/board/board";
import { buildEdgesByKey, buildVisualNeighbors, regionBoundary } from "../../game/board/adjacency";
import {
  DIFFICULTY_STORAGE_KEY,
  DEFAULT_DIFFICULTY,
  isValidDifficulty,
  pickAiColorForDifficulty,
} from "../../game/ai/difficulty";
import { TOOLBAR_BUTTON_STYLE } from "./chromeStyles";
import BoardSvg from "./BoardSvg";
import PaletteBar from "./PaletteBar";
import GameOverlays from "./GameOverlays";

// Horizontal padding on Home (`padding: 16` each side). Board + palette must fit inside it.
const PAGE_PADDING_X = 16;
// How long that side's tiles stay flat after its capture before the facet comes back (ms).
const FLAT_HOLD_MS = 1600;

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

// main interactive Voronoi diagram component
// Full game: board geometry, ownership, palette turns, AI search, SVG + overlays. `numPoints` is how many Voronoi cells to generate.
const VoronoiDiagram = ({ numPoints = 50 }) => { // 50 just to have some default value
  // i18n: HUD/FAQ copy, plus locale + changeLanguage for the toolbar switcher.
  const { t, locale, changeLanguage } = useTranslation();
  // SVG width/height in pixels; `setSvgSize` reruns site generation on window resize.
  const [{ w: svgWidth, h: svgHeight }, setSvgSize] = React.useState(computeSize());
  React.useEffect(() => {
    const onResize = () => setSvgSize(computeSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
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
  // Which side is drawn as flat color after its own capture. The other side, and unowned cells, stay faceted.
  const [flatSide, setFlatSide] = React.useState({ player: false, ai: false });
  // Per-side timeout ids, so the opponent's move does not raise this side before `FLAT_HOLD_MS`.
  const flatTimers = React.useRef({ player: 0, ai: 0 });

  // Player bottom-left and AI top-right, from the same triangulation as the cells.
  const startIds = useMemo(
    () => getStartIds(delaunay, svgWidth, svgHeight),
    [delaunay, svgWidth, svgHeight],
  );

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
  const edgesByKey = useMemo(() => buildEdgesByKey(cells), [cells]);

  // Visual adjacency: two cells are neighbors only if they share a visible clipped edge
  const visualNeighbors = useMemo(() => buildVisualNeighbors(cells, edgesByKey), [edgesByKey, cells]);

  // Interaction state (hover only)
  const [hoveredCell, setHoveredCell] = React.useState(null);

  // Reset turn/colors/hover and bump `gameKey` so geometry + starting ownership re-run as a new match.
  const handleTryAgain = () => {
    setTurn('player');
    setPlayerLastColor(null);
    setAiLastColor(null);
    setHoveredCell(null);
    window.clearTimeout(flatTimers.current.player);
    window.clearTimeout(flatTimers.current.ai);
    flatTimers.current = { player: 0, ai: 0 };
    setFlatSide({ player: false, ai: false });
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

  // Utility: compute legal colors for a side based on constraints
  const computeLegalColors = (owner) =>
    getLegalColors(owner, playerLastColor, aiLastColor, startIds, cells);

  // Expand ownership for a side given a chosen color
  const applyMove = (owner, color) => {
    setCells((prev) => applyMoveToCells(prev, visualNeighbors, owner, color).cells);
    if (owner === 'player') setPlayerLastColor(color); else setAiLastColor(color);
    setFlatSide((prev) => ({ ...prev, [owner]: true }));
    window.clearTimeout(flatTimers.current[owner]);
    flatTimers.current[owner] = window.setTimeout(() => {
      setFlatSide((prev) => ({ ...prev, [owner]: false }));
    }, FLAT_HOLD_MS);
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
  const playerBoundary = useMemo(
    () => regionBoundary(cells, edgesByKey, 'player'),
    [cells, edgesByKey],
  );
  const aiBoundary = useMemo(
    () => regionBoundary(cells, edgesByKey, 'ai'),
    [cells, edgesByKey],
  );

  // On hover, track for subtle styling (no recolor in game mode)
  const handleCellHover = (cell) => {
    setHoveredCell(cell);
  };

  // Clear hover on leave
  const handleMouseLeave = () => {
    setHoveredCell(null);
  };

  // Colors the player may pick right now; the palette uses this to cross out the rest.
  const playerLegalColors = computeLegalColors('player');

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
        <BoardSvg
          svgWidth={svgWidth}
          svgHeight={svgHeight}
          cells={cells}
          hoveredCell={hoveredCell}
          flatSide={flatSide}
          playerBoundary={playerBoundary}
          aiBoundary={aiBoundary}
          onCellHover={handleCellHover}
          onCellLeave={handleMouseLeave}
        />
        <GameOverlays
          t={t}
          gameOver={gameOver}
          controlStats={controlStats}
          onTryAgain={handleTryAgain}
          faqOpen={faqOpen}
          onCloseFaq={handleCloseFaq}
          difficultyOpen={difficultyOpen}
          onCloseDifficulty={handleCloseDifficulty}
          difficulty={difficulty}
          onChooseDifficulty={handleChooseDifficulty}
        />
      </div>
      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', width: svgWidth, maxWidth: '100%', boxSizing: 'border-box' }}>
        <div style={{ fontSize: 20, fontWeight: 600 }}>
          {gameOver ? t('status.gameOver') : (turn === 'player' ? t('status.yourTurn') : t('status.aiThinking'))}
        </div>
        <PaletteBar
          svgWidth={svgWidth}
          legalColors={playerLegalColors}
          interactionLocked={turn !== 'player' || !!gameOver}
          onChoose={handlePlayerChooseColor}
        />
      </div>
    </div>
  );
};

export default VoronoiDiagram;

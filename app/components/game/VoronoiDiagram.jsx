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

// How long the mover's gems blink after a capture (ms). Three pulses of the `gem-blink` keyframe (0.28s × 3).
const BLINK_MS = 840;
// Long side of a new map, in SVG units. The other side keeps the slot's shape, then the map is scaled to the window.
const BOARD_LONG_SIDE = 1000;

// Map size for a new match. Uses the full slot between the toolbar and the palette, so a wide window gets a wide board.
const logicalBoardSize = (slotWidth, slotHeight) => {
  // Slot pixels. Both stay at least 1 so a zero-height first measure cannot produce an empty map.
  const w = Math.max(1, slotWidth);
  const h = Math.max(1, slotHeight);
  // Scale so the long side is BOARD_LONG_SIDE. Stroke widths stay similar at every window size.
  const scale = BOARD_LONG_SIDE / Math.max(w, h);
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
};

// Fit an existing map into the slot. Uniform scale, so a resize does not stretch cells or rebuild them.
const fitBoardBox = (slotWidth, slotHeight, boardWidth, boardHeight) => {
  // Slot size in CSS pixels. Floor so a subpixel observer tick does not refit forever.
  const slotW = Math.max(1, Math.floor(slotWidth));
  const slotH = Math.max(1, Math.floor(slotHeight));
  const aspect = boardWidth / boardHeight;
  let w = slotW;
  let h = w / aspect;
  if (h > slotH) {
    h = slotH;
    w = h * aspect;
  }
  return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
};

// First-paint slot guess before ResizeObserver runs. Leaves room for the header row and the shorter palette.
const estimateSlot = () => {
  if (typeof window === 'undefined') return { w: 800, h: 480 };
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight - 110),
  };
};

// main interactive Voronoi diagram component
// Full game: board geometry, ownership, palette turns, AI search, SVG + overlays. `numPoints` is how many Voronoi cells to generate.
const VoronoiDiagram = ({ numPoints = 50 }) => { // 50 just to have some default value
  // i18n: HUD/FAQ copy, plus locale + changeLanguage for the toolbar switcher.
  const { t, locale, changeLanguage } = useTranslation();
  // Measured pixel box between the toolbar and the palette. Resize changes this, not the cells.
  const [slotBox, setSlotBox] = React.useState(estimateSlot);
  // SVG units for this match. Frozen after the first real measurement and replaced only on a new match.
  const [boardBox, setBoardBox] = React.useState(() => {
    const slot = estimateSlot();
    return logicalBoardSize(slot.w, slot.h);
  });
  // True once this match has captured a map size, so later slot changes only rescale the SVG.
  const boardFrozen = React.useRef(false);
  // The middle row whose content box is the largest rectangle the board may occupy.
  const slotRef = React.useRef(null);
  React.useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    // Copy the slot's content box into state when the window, toolbar wrap, or palette height changes.
    const apply = () => {
      const rect = slot.getBoundingClientRect();
      const nextW = Math.max(1, Math.floor(rect.width));
      const nextH = Math.max(1, Math.floor(rect.height));
      setSlotBox((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
      // First measurement replaces the window guess before the player can move.
      if (!boardFrozen.current && nextW > 1 && nextH > 1) {
        boardFrozen.current = true;
        setBoardBox(logicalBoardSize(nextW, nextH));
      }
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(slot);
    return () => observer.disconnect();
  }, []);
  // On-screen board size. Cell coordinates stay in `boardBox` for the whole match.
  const displaySize = fitBoardBox(slotBox.w, slotBox.h, boardBox.w, boardBox.h);
  // Incremented by Try again to rebuild sites/ownership without mutating the current arrays in place.
  const [gameKey, setGameKey] = React.useState(0);
  // Random seeds for this match. A new `gameKey` or a new map size (new match only) draws a new board.
  const initialSites = useMemo(
    () => generateSites(numPoints, boardBox.w, boardBox.h),
    [numPoints, gameKey, boardBox.w, boardBox.h],
  );
  const sites = useMemo(() => [...initialSites], [initialSites]);

  // geometry derivations
  const { delaunay, voronoi } = useMemo(
    () => generateVoronoi(sites, boardBox.w, boardBox.h),
    [sites, boardBox.w, boardBox.h],
  );
  // Cells with paths/colors/neighbors, before corner flags and starting ownership.
  const baseCells = useMemo(() => createCells(sites, voronoi, delaunay), [sites, voronoi, delaunay]);

  // identifying the corner cells and marking them
  const cornerCellIds = useMemo(
    () => getCornerCellIds(delaunay, boardBox.w, boardBox.h),
    [delaunay, boardBox.w, boardBox.h],
  );
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
  // Active AI level: `'easy'` | `'medium'` | `'hard'` | `'superHard'`. Starts as easy until localStorage is read.
  const [difficulty, setDifficulty] = React.useState(DEFAULT_DIFFICULTY);
  // Which side's gems are blinking after its capture. The other side, and unowned cells, stay steady and faceted.
  const [blinkSide, setBlinkSide] = React.useState({ player: false, ai: false });
  // Per-side timeout ids, so one side's blink ending does not stop the other's.
  const blinkTimers = React.useRef({ player: 0, ai: 0 });
  // Per-side animation-frame ids. A restart drops the blink class for one frame so the CSS animation can begin again.
  const blinkFrames = React.useRef({ player: 0, ai: 0 });

  // Player bottom-left and AI top-right, from the same triangulation as the cells.
  const startIds = useMemo(
    () => getStartIds(delaunay, boardBox.w, boardBox.h),
    [delaunay, boardBox.w, boardBox.h],
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
    window.clearTimeout(blinkTimers.current.player);
    window.clearTimeout(blinkTimers.current.ai);
    window.cancelAnimationFrame(blinkFrames.current.player);
    window.cancelAnimationFrame(blinkFrames.current.ai);
    blinkTimers.current = { player: 0, ai: 0 };
    blinkFrames.current = { player: 0, ai: 0 };
    setBlinkSide({ player: false, ai: false });
    // New match uses the slot as it is now. Resizes after this only scale that map.
    boardFrozen.current = true;
    setBoardBox(logicalBoardSize(slotBox.w, slotBox.h));
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

  // Persist `level`, restart the match when it differs from the current AI level, and close the overlay. `level` is one of `DIFFICULTIES`.
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
    window.clearTimeout(blinkTimers.current[owner]);
    window.cancelAnimationFrame(blinkFrames.current[owner]);
    // Drop the class first so a second move by the same side restarts the pulse instead of leaving a finished animation.
    setBlinkSide((prev) => ({ ...prev, [owner]: false }));
    blinkFrames.current[owner] = window.requestAnimationFrame(() => {
      setBlinkSide((prev) => ({ ...prev, [owner]: true }));
      blinkTimers.current[owner] = window.setTimeout(() => {
        setBlinkSide((prev) => ({ ...prev, [owner]: false }));
      }, BLINK_MS);
    });
  };

  // Player clicks a color button
  const handlePlayerChooseColor = (color) => {
    if (turn !== 'player' || gameOver) return;
    const legal = new Set(computeLegalColors('player'));
    if (!legal.has(color)) return;
    applyMove('player', color);
    setTurn('ai');
  };

  // AI chooses a legal color using the selected difficulty (random / depth 1 / occupancy-banded search / Monte Carlo)
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
  // Turn line in the top-left header. The result text replaces it when the match is over.
  const statusLabel = gameOver
    ? t('status.gameOver')
    : (turn === 'player' ? t('status.yourTurn') : t('status.aiThinking'));

  // Swallow the browser context menu so a right-click or long-press on the match does not leave the game.
  const handleBlockBrowserMenu = (event) => {
    event.preventDefault();
  };

  return (
    <div
      onContextMenu={handleBlockBrowserMenu}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: 8,
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'manipulation',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          flexShrink: 0,
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap' }}>
          {statusLabel}
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'flex-end',
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
      </div>
      <div
        ref={slotRef}
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ position: 'relative', width: displaySize.w, height: displaySize.h, flexShrink: 0 }}>
        <BoardSvg
          viewWidth={boardBox.w}
          viewHeight={boardBox.h}
          svgWidth={displaySize.w}
          svgHeight={displaySize.h}
          cells={cells}
          hoveredCell={hoveredCell}
          blinkSide={blinkSide}
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
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', width: '100%', flexShrink: 0, boxSizing: 'border-box' }}>
        <PaletteBar
          svgWidth={slotBox.w}
          legalColors={playerLegalColors}
          interactionLocked={turn !== 'player' || !!gameOver}
          onChoose={handlePlayerChooseColor}
        />
      </div>
    </div>
  );
};

export default VoronoiDiagram;

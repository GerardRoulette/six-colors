import {
  applyMoveToCells,
  applyGreedyMove,
  getLegalColors,
  countCapturesForMove,
} from '../moves';

// AI search knobs — change these if thinking is too slow or too shallow.
// `belowPercent` is compared to occupied share: (player cells + AI cells) / all cells.
// Example: 10% player + 12% AI → 22% occupied, so the first matching band applies.
// `branch` = AI turns where EVERY legal color is tried (this is what sees 5–7 step sacrifices).
// `tail` = extra AI turns after that, greedy only (cheap mop-up, not a sacrifice search).
// Player replies in the simulation are always greedy (one choice), so the tree stays ~4^branch.
export const AI_SEARCH = {
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
// Occupancy `totalPercent` selects the search band unless `planOverride` is passed (medium locks depth to 1).
// Tie-break among equal lookahead scores: more immediate captures. Returns a PALETTE color or null.
export const pickAiColorWithSearch = (cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent, planOverride) => {
  const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, cells);
  if (legal.length === 0) return null;
  // Occupancy band, or a caller-fixed `{ branch, tail }` (medium uses branch 1).
  const plan = planOverride || planFromOccupiedPercent(totalPercent);
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

// Hard difficulty: occupancy-banded iterative deepening (the original AI).
export const pickAiColorHard = (cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent) =>
  pickAiColorWithSearch(cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent);

import { pickAiColorWithSearch } from './aiHard';

// Medium search: one AI ply only (`branch: 1`), no extra greedy mop-up (`tail: 0`).
const MEDIUM_PLAN = { branch: 1, tail: 0 };

// Medium difficulty: same searcher as hard, but locked to depth 1 (immediate captures of each legal color).
// `totalPercent` is unused because the plan is fixed; the shared searcher still expects the argument.
export const pickAiColorMedium = (cells, visualNeighbors, startIds, lastPlayer, lastAi) =>
  pickAiColorWithSearch(cells, visualNeighbors, startIds, lastPlayer, lastAi, 0, MEDIUM_PLAN);

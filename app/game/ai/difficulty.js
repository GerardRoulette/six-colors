import { pickAiColorEasy } from './aiEasy';
import { pickAiColorMedium } from './aiMedium';
import { pickAiColorHard } from './aiHard';

// localStorage key for the chosen AI difficulty (`easy` | `medium` | `hard`).
export const DIFFICULTY_STORAGE_KEY = 'difficulty';
// Selectable AI levels shown in the difficulty overlay, in display order.
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Default and fallback when storage is missing or invalid (original lookahead AI).
export const DEFAULT_DIFFICULTY = 'hard';

// True when `value` is one of the three AI difficulty ids.
export const isValidDifficulty = (value) => DIFFICULTIES.includes(value);

// Dispatch to easy (random), medium (depth 1), or hard (occupancy-banded search). Falls back to the first legal color.
// `difficulty` is `'easy'` | `'medium'` | `'hard'`. `legal` is the live legal palette for the AI (fallback if a picker returns null).
// `totalPercent` is occupancy for hard search bands; ignored on easy/medium. Board args match the live AI effect.
export const pickAiColorForDifficulty = (
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

import { pickAiColorEasy } from './aiEasy';
import { pickAiColorMedium } from './aiMedium';
import { pickAiColorHard } from './aiHard';
import { pickAiColorExpert } from './aiExpert';

// localStorage key for the chosen AI difficulty (`easy` | `medium` | `hard` | `superHard`).
export const DIFFICULTY_STORAGE_KEY = 'difficulty';
// Selectable AI levels shown in the difficulty overlay, in display order.
export const DIFFICULTIES = ['easy', 'medium', 'hard', 'superHard'];
// Default and fallback when storage is missing or invalid (random legal color).
export const DEFAULT_DIFFICULTY = 'easy';

// True when `value` is one of the AI difficulty ids.
export const isValidDifficulty = (value) => DIFFICULTIES.includes(value);

// Dispatch to easy (random), medium (depth 1), hard (occupancy-banded search), or super hard (Monte Carlo).
// Falls back to the first legal color. `difficulty` is one of `DIFFICULTIES`.
// `legal` is the live legal palette for the AI (fallback if a picker returns null).
// `totalPercent` is occupancy for hard search bands; ignored on easy, medium, and super hard. Board args match the live AI effect.
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
  } else if (difficulty === 'superHard') {
    chosen = pickAiColorExpert(cells, visualNeighbors, startIds, lastPlayer, lastAi);
  } else {
    chosen = pickAiColorHard(cells, visualNeighbors, startIds, lastPlayer, lastAi, totalPercent);
  }
  return chosen || legal[0];
};

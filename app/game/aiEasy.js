import { getLegalColors } from './moves';

// Easy difficulty: uniform random among currently legal AI colors. No capture scoring.
export const pickAiColorEasy = (cells, startIds, lastPlayer, lastAi) => {
  // Legal palette entries for the AI on this board (same bans as the live game).
  const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, cells);
  if (legal.length === 0) return null;
  // Index into `legal` so every remaining color is equally likely.
  const index = Math.floor(Math.random() * legal.length);
  return legal[index];
};

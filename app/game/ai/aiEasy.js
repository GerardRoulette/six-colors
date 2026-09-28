import { getLegalColors } from '../moves';

// Easy difficulty: uniform random among legal colors that sit on an unowned cell touching AI territory.
// Those colors always capture at least one cell. If none are legal, falls back to any legal color.
export const pickAiColorEasy = (cells, visualNeighbors, startIds, lastPlayer, lastAi) => {
  // Legal palette entries for the AI on this board (same bans as the live game).
  const legal = getLegalColors('ai', lastPlayer, lastAi, startIds, cells);
  if (legal.length === 0) return null;
  // Set form of `legal` so border colors can be checked without a second scan of the palette.
  const legalSet = new Set(legal);
  // Colors on unowned cells that share an edge with AI territory, restricted to legal picks.
  const borderColors = new Set();
  for (const cell of cells) {
    if (cell.owner !== 'ai') continue;
    // Neighbor cell ids that share a clipped edge with this owned cell.
    const nbs = visualNeighbors.get(cell.id) || [];
    for (const nb of nbs) {
      // Unowned neighbor; its color is a capturing choice if it is still legal.
      const neighbor = cells[nb];
      if (neighbor.owner !== null) continue;
      if (legalSet.has(neighbor.color)) borderColors.add(neighbor.color);
    }
  }
  // Pool to draw from: border colors when any exist, otherwise every legal color.
  const pool = borderColors.size > 0 ? [...borderColors] : legal;
  // Index into `pool` so every remaining capturing color is equally likely.
  const index = Math.floor(Math.random() * pool.length);
  return pool[index];
};

// Six legal fill colors (CSS names). Players pick from this list; cells are initialized randomly from it.
export const PALETTE = ['orangered', 'goldenrod', 'khaki', 'orchid', 'yellowgreen', 'cadetblue'];

// Pure flood-fill of one color choice. Returns a new board plus how many unowned cells were taken.
// Recolors already-owned cells to `color`, then BFS through `visualNeighbors` to capture unowned same-color neighbors. Does not mutate `cells`.
export const applyMoveToCells = (cells, visualNeighbors, owner, color) => {
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
export const getLegalColors = (owner, lastPlayer, lastAi, startIds, cells) => {
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
export const countCapturesForMove = (cells, visualNeighbors, owner, color) =>
  applyMoveToCells(cells, visualNeighbors, owner, color).captures;

// Apply the legal color that captures the most cells right now. Returns null if none.
export const applyGreedyMove = (cells, visualNeighbors, owner, lastPlayer, lastAi, startIds) => {
  const legal = getLegalColors(owner, lastPlayer, lastAi, startIds, cells);
  // `{ cells, captures, color }` of the legal color with the most immediate captures.
  let best = null;
  for (const color of legal) {
    const move = applyMoveToCells(cells, visualNeighbors, owner, color);
    if (!best || move.captures > best.captures) best = { ...move, color };
  }
  return best;
};

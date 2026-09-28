import { PALETTE } from '../moves';

// Experimental super-hard search. Tunable if moves feel slow or shallow.
// `priorMs` is spent on a fast copy of the hard lookahead (AI branches, player replies greedy) and those scores seed the tree.
// The rest of `maxMs` is Monte Carlo tree search: UCT selection, one new color per visit, then a short greedy-biased rollout.
// Rewards are from the AI's point of view (1 win, 0 loss, and a territory margin if the rollout stops early).
export const SUPER_HARD_SEARCH = {
  maxMs: 850,
  priorMs: 200,
  maxSimulations: 5000,
  priorMaxNodes: 30000,
  lookaheadMaxBranch: 8,
  lookaheadTail: 2,
  exploration: 1.05,
  priorVisits: 8,
  priorWeight: 0.45,
  rolloutPlies: 14,
  greedyRolloutChance: 0.82,
  marginSlope: 8,
  winScore: 100000,
};

// Packed owners. 0 is unowned so a typed array can store the board without nulls.
const OWNER_NONE = 0;
const OWNER_PLAYER = 1;
const OWNER_AI = 2;

// CSS palette name → 0..5, used when packing the live board into bytes.
const COLOR_INDEX = new Map(PALETTE.map((name, index) => [name, index]));

// Same rounded percent as the HUD win check (`Math.round(count / total * 100) > 50`).
const roundedPercent = (count, total) => (total > 0 ? Math.round((count / total) * 100) : 0);

// True when the AI's rounded share is already a win, so search can stop this line.
const aiHasWon = (state) => roundedPercent(state.aiCount, state.color.length) > 50;

// True when the player's rounded share is already a win.
const playerHasWon = (state) => roundedPercent(state.playerCount, state.color.length) > 50;

// Score in (0, 1) when a rollout ends before anyone passes 50%. Even territory is 0.5; an AI lead rises toward 1.
const marginReward = (state) => {
  // Signed share difference. Positive means the AI owns more of the board than the player.
  const diff = (state.aiCount - state.playerCount) / (state.color.length || 1);
  return 1 / (1 + Math.exp(-SUPER_HARD_SEARCH.marginSlope * diff));
};

// `id` → neighbor id list, copied once per AI turn so flood-fill does not call `Map.get` on every edge.
const buildNeighborLists = (cellCount, visualNeighbors) => {
  // Parallel to cell ids. Missing map entries become an empty list.
  const lists = new Array(cellCount);
  for (let id = 0; id < cellCount; id++) {
    // Neighbor set for this cell from the live Voronoi adjacency.
    const nbs = visualNeighbors.get(id);
    lists[id] = nbs ? Array.from(nbs) : [];
  }
  return lists;
};

// Live React cells → compact state the search clones. `toMove` starts as the AI because this runs on the AI's turn.
const packState = (cells, lastPlayer, lastAi) => {
  // Color index per cell. Length is the board size; index is the cell id.
  const color = new Uint8Array(cells.length);
  // Owner byte per cell (`OWNER_*`).
  const owner = new Uint8Array(cells.length);
  // Cell ids the player currently owns, so a move can recolor territory without scanning the whole board.
  const ownedPlayer = [];
  // Cell ids the AI currently owns.
  const ownedAi = [];
  for (let i = 0; i < cells.length; i++) {
    // Source cell. `id` matches the array index on boards from `createCells`.
    const cell = cells[i];
    // Palette index, or 0 if a color is somehow outside `PALETTE` (keeps the byte array valid).
    const idx = COLOR_INDEX.get(cell.color);
    color[cell.id] = idx == null ? 0 : idx;
    if (cell.owner === 'player') {
      owner[cell.id] = OWNER_PLAYER;
      ownedPlayer.push(cell.id);
    } else if (cell.owner === 'ai') {
      owner[cell.id] = OWNER_AI;
      ownedAi.push(cell.id);
    }
  }
  return {
    color,
    owner,
    ownedPlayer,
    ownedAi,
    playerCount: ownedPlayer.length,
    aiCount: ownedAi.length,
    lastPlayer: lastPlayer == null ? -1 : (COLOR_INDEX.get(lastPlayer) ?? -1),
    lastAi: lastAi == null ? -1 : (COLOR_INDEX.get(lastAi) ?? -1),
    toMove: OWNER_AI,
  };
};

// Deep copy of the bytes the next ply mutates. Neighbor lists stay shared.
const cloneState = (state) => ({
  color: state.color.slice(),
  owner: state.owner.slice(),
  ownedPlayer: state.ownedPlayer.slice(),
  ownedAi: state.ownedAi.slice(),
  playerCount: state.playerCount,
  aiCount: state.aiCount,
  lastPlayer: state.lastPlayer,
  lastAi: state.lastAi,
  toMove: state.toMove,
});

// Generation stamp for `scratch.visited`. Wraps at 255 by clearing the stamp array so ids can be reused.
const nextGeneration = (scratch) => {
  // Next stamp. 0 is reserved for "never visited" after a wrap clear.
  let gen = scratch.gen + 1;
  if (gen === 256) {
    scratch.visited.fill(0);
    gen = 1;
  }
  scratch.gen = gen;
  return gen;
};

// Legal palette indexes for `state.toMove`, matching `getLegalColors` (last colors, and start-cell colors before that side has moved).
const legalColorIndices = (state, startIds) => {
  // Current color of the player's start cell, or -1 when that id is missing.
  const playerStartColor = startIds.playerStartId == null ? -1 : state.color[startIds.playerStartId];
  // Current color of the AI start cell.
  const aiStartColor = startIds.aiStartId == null ? -1 : state.color[startIds.aiStartId];
  // Who is choosing: their own last color and the opponent's last color are both banned.
  const lastSelf = state.toMove === OWNER_PLAYER ? state.lastPlayer : state.lastAi;
  const lastOpp = state.toMove === OWNER_PLAYER ? state.lastAi : state.lastPlayer;
  // This side's start-cell color, banned only when they have not moved yet.
  const ownStart = state.toMove === OWNER_PLAYER ? playerStartColor : aiStartColor;
  // Banned palette indexes for this ply.
  const forbidden = new Set();
  if (lastSelf >= 0) forbidden.add(lastSelf);
  if (lastOpp >= 0) forbidden.add(lastOpp);
  if (state.lastPlayer < 0 && state.lastAi < 0) {
    if (playerStartColor >= 0) forbidden.add(playerStartColor);
    if (aiStartColor >= 0) forbidden.add(aiStartColor);
  } else if (lastSelf < 0 && ownStart >= 0) {
    forbidden.add(ownStart);
  }
  // Remaining colors in palette order so equal capture counts stay stable.
  const legal = [];
  for (let color = 0; color < PALETTE.length; color++) {
    if (!forbidden.has(color)) legal.push(color);
  }
  return legal;
};

// How many unowned cells `moveColor` would take for `state.toMove`. Does not mutate the board.
const countCaptures = (state, moveColor, neighbors, scratch) => {
  // Side that would play `moveColor`.
  const who = state.toMove;
  // Territory ids recolored by this move. Not copied; this walk is read-only.
  const owned = who === OWNER_AI ? state.ownedAi : state.ownedPlayer;
  // Stamp for this walk so it does not collide with earlier counts in the same search.
  const gen = nextGeneration(scratch);
  // Reused queue of cell ids. `qt` is the write head, `qh` the read head.
  const queue = scratch.queue;
  let qh = 0;
  let qt = 0;
  // Unowned cells that would change owner.
  let captures = 0;
  for (let i = 0; i < owned.length; i++) {
    // Already-owned cell. Marked visited so neighbors do not enqueue it again.
    const id = owned[i];
    scratch.visited[id] = gen;
    queue[qt++] = id;
  }
  while (qh < qt) {
    const id = queue[qh++];
    // Cells that share a clipped edge with `id`.
    const nbs = neighbors[id];
    for (let k = 0; k < nbs.length; k++) {
      const nb = nbs[k];
      if (scratch.visited[nb] === gen) continue;
      scratch.visited[nb] = gen;
      // Owner byte currently on the neighbor.
      const ow = state.owner[nb];
      if (ow !== OWNER_NONE && ow !== who) continue;
      if (ow === who) {
        queue[qt++] = nb;
        continue;
      }
      if (state.color[nb] === moveColor) {
        queue[qt++] = nb;
        captures++;
      }
    }
  }
  return captures;
};

// Play `moveColor` for `state.toMove` in place. Returns how many unowned cells were taken.
const applyInPlace = (state, moveColor, neighbors, scratch) => {
  // Side playing this ply. Flipped at the end so the opponent is next.
  const who = state.toMove;
  // Territory to recolor. Pushed to when a cell is captured.
  const owned = who === OWNER_AI ? state.ownedAi : state.ownedPlayer;
  const gen = nextGeneration(scratch);
  const queue = scratch.queue;
  let qh = 0;
  let qt = 0;
  let captures = 0;
  for (let i = 0; i < owned.length; i++) {
    const id = owned[i];
    state.color[id] = moveColor;
    scratch.visited[id] = gen;
    queue[qt++] = id;
  }
  while (qh < qt) {
    const id = queue[qh++];
    const nbs = neighbors[id];
    for (let k = 0; k < nbs.length; k++) {
      const nb = nbs[k];
      if (scratch.visited[nb] === gen) continue;
      scratch.visited[nb] = gen;
      const ow = state.owner[nb];
      if (ow !== OWNER_NONE && ow !== who) continue;
      if (ow === who) {
        if (state.color[nb] !== moveColor) state.color[nb] = moveColor;
        queue[qt++] = nb;
        continue;
      }
      if (state.color[nb] === moveColor) {
        state.owner[nb] = who;
        owned.push(nb);
        queue[qt++] = nb;
        captures++;
      }
    }
  }
  if (who === OWNER_AI) state.aiCount += captures;
  else state.playerCount += captures;
  if (who === OWNER_PLAYER) state.lastPlayer = moveColor;
  else state.lastAi = moveColor;
  state.toMove = who === OWNER_AI ? OWNER_PLAYER : OWNER_AI;
  return captures;
};

// Legal color with the most immediate captures for whoever is to move. Null when nothing is legal.
const bestGreedyColor = (state, neighbors, scratch, startIds) => {
  // Legal indexes for `state.toMove`.
  const legal = legalColorIndices(state, startIds);
  // Best index so far, kept in palette order on ties (`>` not `>=`).
  let best = null;
  let bestCaps = -1;
  for (let i = 0; i < legal.length; i++) {
    // Candidate color and how many cells it takes right now.
    const color = legal[i];
    const caps = countCaptures(state, color, neighbors, scratch);
    if (caps > bestCaps) {
      bestCaps = caps;
      best = color;
    }
  }
  return best;
};

// Greedy ply in place, or a pass that only flips the turn when no color is legal. Returns captures (0 on a pass).
const applyGreedyInPlace = (state, neighbors, scratch, startIds) => {
  // Color the greedy policy would click, or null when the palette is empty.
  const color = bestGreedyColor(state, neighbors, scratch, startIds);
  if (color == null) {
    state.toMove = state.toMove === OWNER_AI ? OWNER_PLAYER : OWNER_AI;
    return 0;
  }
  return applyInPlace(state, color, neighbors, scratch);
};

// Cheap mop-up after the branching search stops. `state` is the player's turn. Counts later AI captures only.
const greedyTailCaptures = (state, aiTurns, neighbors, scratch, startIds) => {
  if (aiTurns <= 0) return 0;
  // Copy so the caller's node state stays put.
  const sim = cloneState(state);
  applyGreedyInPlace(sim, neighbors, scratch, startIds);
  if (playerHasWon(sim)) return -SUPER_HARD_SEARCH.winScore;
  // Sum of AI captures across `aiTurns` greedy plies (player replies between them are not added).
  let total = 0;
  for (let i = 0; i < aiTurns; i++) {
    total += applyGreedyInPlace(sim, neighbors, scratch, startIds);
    if (aiHasWon(sim)) return total + SUPER_HARD_SEARCH.winScore;
    if (i === aiTurns - 1) break;
    applyGreedyInPlace(sim, neighbors, scratch, startIds);
    if (playerHasWon(sim)) return -SUPER_HARD_SEARCH.winScore;
  }
  return total;
};

// After an AI ply: player answers greedy, then either branch on every AI color or finish with `tail` greedy AI turns.
// Returns extra AI captures after the ply the caller already counted. Huge positive/negative scores mean someone has won.
const scoreAfterAiMove = (state, branchLeft, tail, budget, neighbors, scratch, startIds) => {
  if (aiHasWon(state)) return SUPER_HARD_SEARCH.winScore;
  if (playerHasWon(state)) return -SUPER_HARD_SEARCH.winScore;
  if (branchLeft <= 0 && tail <= 0) return 0;
  // Stop expanding this line once the prior budget is spent; the root discards a depth that does not finish.
  const timedOut = performance.now() >= budget.deadline || budget.nodes >= budget.maxNodes;
  if (timedOut || branchLeft <= 0) {
    // Leftover branching depth is played greedy, plus the usual mop-up turns.
    const aiTurns = (branchLeft > 0 ? branchLeft : 0) + tail;
    return greedyTailCaptures(state, aiTurns, neighbors, scratch, startIds);
  }
  // Player's greedy answer on a copy. `state` stays the position after the AI ply.
  const afterPlayer = cloneState(state);
  applyGreedyInPlace(afterPlayer, neighbors, scratch, startIds);
  if (playerHasWon(afterPlayer)) return -SUPER_HARD_SEARCH.winScore;
  if (aiHasWon(afterPlayer)) return SUPER_HARD_SEARCH.winScore;
  // AI colors still legal after that reply.
  const legal = legalColorIndices(afterPlayer, startIds);
  if (legal.length === 0) return 0;
  // Best extra captures among those colors. Starts below any real line so a forced loss stays negative.
  let best = -Infinity;
  for (let i = 0; i < legal.length; i++) {
    budget.nodes += 1;
    const next = cloneState(afterPlayer);
    const caps = applyInPlace(next, legal[i], neighbors, scratch);
    const rest = scoreAfterAiMove(
      next, branchLeft - 1, tail, budget, neighbors, scratch, startIds,
    );
    const total = caps + rest;
    if (total > best) best = total;
  }
  return best;
};

// Iterative-deepening scores for each legal AI color at the root. Unfinished depths are thrown away.
// Map values are capture totals (plus `winScore` when the line already wins).
const rankRootByLookahead = (rootState, legal, neighbors, scratch, startIds, deadline) => {
  // Last depth that scored every root color. Starts even so a timeout before depth 1 still has an entry per color.
  let finishedScores = new Map();
  for (let i = 0; i < legal.length; i++) finishedScores.set(legal[i], 0);
  for (let depth = 1; depth <= SUPER_HARD_SEARCH.lookaheadMaxBranch; depth++) {
    if (performance.now() >= deadline) break;
    // Fresh node counter per depth, same deadline as the whole prior phase.
    const budget = {
      nodes: 0,
      deadline,
      maxNodes: SUPER_HARD_SEARCH.priorMaxNodes,
    };
    // Scores for this depth only. Copied over `finishedScores` when every color completes.
    const iterScores = new Map();
    let finished = true;
    for (let i = 0; i < legal.length; i++) {
      if (performance.now() >= deadline || budget.nodes >= budget.maxNodes) {
        finished = false;
        break;
      }
      // Root AI ply for this color, then the shared lookahead from the player's reply.
      const color = legal[i];
      const next = cloneState(rootState);
      const caps = applyInPlace(next, color, neighbors, scratch);
      const rest = scoreAfterAiMove(
        next,
        depth - 1,
        SUPER_HARD_SEARCH.lookaheadTail,
        budget,
        neighbors,
        scratch,
        startIds,
      );
      iterScores.set(color, caps + rest);
    }
    if (!finished) break;
    finishedScores = iterScores;
  }
  return finishedScores;
};

// Map lookahead capture scores onto a 0.15–1 reward so a win stays ahead without zeroing the other colors.
const rewardFromLookahead = (score, minScore, span) => 0.15 + 0.85 * ((score - minScore) / span);

// Scratch buffers reused for every flood-fill in one AI decision.
const makeScratch = (cellCount) => ({
  visited: new Uint8Array(cellCount),
  queue: new Int32Array(cellCount),
  gen: 0,
});

// Tree node: the position in `state`, untried colors sorted low-capture first (so `pop` tries the biggest grab), and children already expanded.
const makeNode = (state, neighbors, scratch, startIds) => {
  // 1, 0, or null when the game is still going. Null is not the same as a player win (0).
  let terminalReward = null;
  if (aiHasWon(state)) terminalReward = 1;
  else if (playerHasWon(state)) terminalReward = 0;
  // `{ color, caps }` still to expand. Empty when the position is already decided.
  const untried = [];
  if (terminalReward == null) {
    const legal = legalColorIndices(state, startIds);
    for (let i = 0; i < legal.length; i++) {
      const color = legal[i];
      untried.push({ color, caps: countCaptures(state, color, neighbors, scratch) });
    }
    untried.sort((a, b) => a.caps - b.caps);
  }
  return {
    state,
    visits: 0,
    rewardSum: 0,
    untried,
    children: [],
    terminalReward,
  };
};

// UCT child for the side about to move. AI maximizes reward; the player maximizes `1 - reward`. A child with no visits is tried before the scored ones.
const selectChild = (node) => {
  // True when the AI is the one choosing among `node.children`.
  const maximizingAi = node.state.toMove === OWNER_AI;
  // Best child wrapper so far (`{ color, prior, node }`).
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    // Visits already include the expansion rollout, and root children also include lookahead virtual visits.
    const visits = child.node.visits;
    if (visits <= 0) return child;
    const q = child.node.rewardSum / visits;
    const exploit = maximizingAi ? q : 1 - q;
    // `node.visits` is at least 1 after seeding; the max keeps a bad node from producing NaN.
    const explore = SUPER_HARD_SEARCH.exploration * Math.sqrt(Math.log(Math.max(node.visits, 1)) / visits);
    const bias = (child.prior * SUPER_HARD_SEARCH.priorWeight) / (visits + 1);
    const score = exploit + explore + bias;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }
  return best;
};

// Add one child for the highest-capture color still untried. Returns that child node (already linked).
const expandChild = (node, neighbors, scratch, startIds) => {
  // Next color to try. `untried` is sorted so the last entry captures the most.
  const picked = node.untried.pop();
  const next = cloneState(node.state);
  const caps = applyInPlace(next, picked.color, neighbors, scratch);
  // Capture prior in (0, 1). Bigger grabs keep a small bias after the visit count grows.
  const prior = caps / (caps + 10);
  const child = makeNode(next, neighbors, scratch, startIds);
  node.children.push({ color: picked.color, prior, node: child });
  return child;
};

// Rollout policy: usually the greedy capture, otherwise a random legal color weighted by captures + 1.
const pickRolloutColor = (state, legal, neighbors, scratch) => {
  // Weights parallel to `legal`. `total` is their sum for the random draw.
  const weights = new Array(legal.length);
  let total = 0;
  let bestColor = legal[0];
  let bestCaps = -1;
  for (let i = 0; i < legal.length; i++) {
    const caps = countCaptures(state, legal[i], neighbors, scratch);
    const weight = caps + 1;
    weights[i] = weight;
    total += weight;
    if (caps > bestCaps) {
      bestCaps = caps;
      bestColor = legal[i];
    }
  }
  if (Math.random() < SUPER_HARD_SEARCH.greedyRolloutChance) return bestColor;
  // Ticket in [0, total). Walk weights until it is spent.
  let ticket = Math.random() * total;
  for (let i = 0; i < legal.length; i++) {
    ticket -= weights[i];
    if (ticket <= 0) return legal[i];
  }
  return legal[legal.length - 1];
};

// Play both sides for a few plies from `state` and return an AI reward in [0, 1]. Does not mutate `state`.
const rolloutReward = (state, neighbors, scratch, startIds) => {
  if (aiHasWon(state)) return 1;
  if (playerHasWon(state)) return 0;
  const sim = cloneState(state);
  for (let ply = 0; ply < SUPER_HARD_SEARCH.rolloutPlies; ply++) {
    const legal = legalColorIndices(sim, startIds);
    if (legal.length === 0) {
      sim.toMove = sim.toMove === OWNER_AI ? OWNER_PLAYER : OWNER_AI;
      continue;
    }
    const color = pickRolloutColor(sim, legal, neighbors, scratch);
    applyInPlace(sim, color, neighbors, scratch);
    if (aiHasWon(sim)) return 1;
    if (playerHasWon(sim)) return 0;
  }
  return marginReward(sim);
};

// Monte Carlo search from `rootState`. Lookahead `scores` seed root visits so a thin tree does not ignore a deep tactical move.
// Returns a palette color, or null when the AI has no legal move.
const runMcts = (rootState, scores, neighbors, scratch, startIds, deadline) => {
  const root = makeNode(rootState, neighbors, scratch, startIds);
  if (root.terminalReward != null || root.untried.length === 0) return null;
  // Spread of lookahead scores. A zero span means every root color looked the same.
  let minScore = Infinity;
  let maxScore = -Infinity;
  for (let i = 0; i < root.untried.length; i++) {
    const score = scores.get(root.untried[i].color) ?? 0;
    if (score < minScore) minScore = score;
    if (score > maxScore) maxScore = score;
  }
  const span = maxScore - minScore || 1;
  // Expand every root color once so each of them has a prior before UCT runs.
  while (root.untried.length > 0) {
    const child = expandChild(root, neighbors, scratch, startIds);
    // Lookahead score for the color that was just popped (last child).
    const wrapped = root.children[root.children.length - 1];
    const score = scores.get(wrapped.color) ?? 0;
    const seeded = rewardFromLookahead(score, minScore, span);
    child.visits = SUPER_HARD_SEARCH.priorVisits;
    child.rewardSum = seeded * SUPER_HARD_SEARCH.priorVisits;
    // Mix the lookahead into the capture prior so UCT keeps a preference after real visits arrive.
    wrapped.prior = 0.5 * wrapped.prior + 0.5 * seeded;
  }
  // Parent visit count for the log term. Matches the virtual visits just written onto the children.
  root.visits = root.children.length * SUPER_HARD_SEARCH.priorVisits;
  root.rewardSum = 0;
  for (let i = 0; i < root.children.length; i++) root.rewardSum += root.children[i].node.rewardSum;

  // Completed simulations. The cap is a backstop if the clock never advances.
  let simulations = 0;
  while (performance.now() < deadline && simulations < SUPER_HARD_SEARCH.maxSimulations) {
    simulations += 1;
    // Nodes that receive this simulation's reward, root first.
    const path = [root];
    let node = root;
    while (node.terminalReward == null && node.untried.length === 0 && node.children.length > 0) {
      const child = selectChild(node);
      node = child.node;
      path.push(node);
    }
    if (node.terminalReward == null && node.untried.length > 0) {
      node = expandChild(node, neighbors, scratch, startIds);
      path.push(node);
    }
    // Terminal positions skip the rollout. Otherwise play the greedy-biased playout from this node.
    const reward = node.terminalReward != null
      ? node.terminalReward
      : rolloutReward(node.state, neighbors, scratch, startIds);
    for (let i = 0; i < path.length; i++) {
      path[i].visits += 1;
      path[i].rewardSum += reward;
    }
  }

  // Robust child: most real-looking visits, then higher mean reward, then the lookahead prior.
  let best = root.children[0];
  for (let i = 1; i < root.children.length; i++) {
    const child = root.children[i];
    const visitsBetter = child.node.visits > best.node.visits;
    const visitsTied = child.node.visits === best.node.visits;
    const qBetter = child.node.rewardSum / child.node.visits > best.node.rewardSum / best.node.visits;
    if (visitsBetter || (visitsTied && qBetter)) best = child;
  }
  return PALETTE[best.color];
};

// Expert AI color. Immediate wins are taken without spending the tree budget.
// Otherwise a short lookahead seeds MCTS, and the most-visited root color is played.
export const pickAiColorExpert = (cells, visualNeighbors, startIds, lastPlayer, lastAi) => {
  if (!cells || cells.length === 0) return null;
  // Compact board, neighbor lists, and flood-fill scratch for this decision only.
  const rootState = packState(cells, lastPlayer, lastAi);
  const neighbors = buildNeighborLists(cells.length, visualNeighbors);
  const scratch = makeScratch(cells.length);
  const legal = legalColorIndices(rootState, startIds);
  if (legal.length === 0) return null;
  if (legal.length === 1) return PALETTE[legal[0]];

  // Winning color with the most captures, if any legal move already crosses 50%.
  let winningColor = null;
  let winningCaps = -1;
  for (let i = 0; i < legal.length; i++) {
    const next = cloneState(rootState);
    const caps = applyInPlace(next, legal[i], neighbors, scratch);
    if (aiHasWon(next) && caps > winningCaps) {
      winningCaps = caps;
      winningColor = legal[i];
    }
  }
  if (winningColor != null) return PALETTE[winningColor];

  // Wall-clock start. The prior phase ends at `priorMs`; the tree stops at `maxMs`.
  const startedAt = performance.now();
  const scores = rankRootByLookahead(
    rootState,
    legal,
    neighbors,
    scratch,
    startIds,
    startedAt + SUPER_HARD_SEARCH.priorMs,
  );
  return runMcts(
    rootState,
    scores,
    neighbors,
    scratch,
    startIds,
    startedAt + SUPER_HARD_SEARCH.maxMs,
  );
};

// The heart of the app: ask Jev to pick a move.
//
// Design (why chess is the perfect Jev demo):
//   - The board position (FEN) is the `state`.
//   - Every LEGAL move is an option of a single `Choice` question, so an
//     illegal move is impossible by construction — Jev can only answer within
//     the options we give it.
//   - A `Score` question rates the position, which drives the eval bar.
//   - The returned per-move probabilities render as heat on the board.

import { CONFIG } from "./config.js";
import { getToken } from "./auth.js";

// Jev's Choice options share a token budget, so hundreds of options degrade.
// Chess rarely exceeds ~40 legal moves, well within range. If a position
// somehow exceeds this, we shortlist by a light heuristic before asking.
const MAX_OPTIONS = 40;

// Build a human-readable description for each candidate move so Jev has
// something meaningful to weigh, not just cryptic SAN.
function describeMove(m) {
  const parts = [];
  if (m.captured) parts.push(`captures ${pieceName(m.captured)}`);
  if (m.san.includes("+")) parts.push("gives check");
  if (m.san.includes("#")) parts.push("checkmate");
  if (m.promotion) parts.push(`promotes to ${pieceName(m.promotion)}`);
  if (m.flags.includes("k") || m.flags.includes("q")) parts.push("castles");
  const piece = pieceName(m.piece);
  const base = `${piece} ${m.from}→${m.to}`;
  return parts.length ? `${base} (${parts.join(", ")})` : base;
}

function pieceName(p) {
  return (
    {
      p: "pawn",
      n: "knight",
      b: "bishop",
      r: "rook",
      q: "queen",
      k: "king",
    }[p.toLowerCase()] || p
  );
}

// Ask Jev for its move given a chess.js instance whose turn it is.
// Returns { move: <san>, probabilities: {san: p}, confidence, evalScore, evalLegend }.
export async function chooseMove(game) {
  const token = getToken();
  if (!token) {
    const err = new Error("not_connected");
    err.code = "not_connected";
    throw err;
  }

  const verboseMoves = game.moves({ verbose: true });
  if (verboseMoves.length === 0) {
    return { move: null, probabilities: {}, confidence: null };
  }

  // Optional shortlist if a position is unusually branchy.
  let candidates = verboseMoves;
  if (candidates.length > MAX_OPTIONS) {
    // Prefer captures/checks/promotions, then fill with the rest.
    const scored = candidates
      .map((m) => ({
        m,
        w:
          (m.captured ? 2 : 0) +
          (m.san.includes("+") || m.san.includes("#") ? 1 : 0) +
          (m.promotion ? 1 : 0),
      }))
      .sort((a, b) => b.w - a.w);
    candidates = scored.slice(0, MAX_OPTIONS).map((s) => s.m);
  }

  const sideToMove = game.turn() === "w" ? "White" : "Black";

  // Choice criteria: SAN → description.
  const criteria = {};
  for (const m of candidates) criteria[m.san] = describeMove(m);

  const state = {
    position_fen: game.fen(),
    side_to_move: sideToMove,
    ascii_board: game.ascii(),
    move_number: Math.floor(game.history().length / 2) + 1,
    in_check: game.inCheck?.() ?? game.in_check?.() ?? false,
  };

  const questions = {
    best_move: {
      type: "choice",
      instructions:
        `You are playing chess as ${sideToMove}. Choose the strongest legal move ` +
        `for ${sideToMove} in this position. Consider material, king safety, and threats.`,
      criteria,
    },
    evaluation: {
      type: "score",
      instructions:
        "From White's perspective, who stands better in this position?",
      criteria: [
        "Black is winning",
        "Black is better",
        "roughly equal",
        "White is better",
        "White is winning",
      ],
    },
  };

  const res = await fetch(`${CONFIG.API_BASE}/alpha/decisions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: CONFIG.MODEL, state, questions }),
  });

  if (!res.ok) {
    const err = new Error("http_" + res.status);
    err.code = res.status;
    if (res.status === 429) err.retryAfter = Number(res.headers.get("Retry-After")) || 2;
    try {
      err.body = await res.json();
    } catch {
      /* ignore */
    }
    throw err;
  }

  const data = await res.json();
  const choice = data.answers?.best_move;
  const evalAns = data.answers?.evaluation;

  // Guard: the returned choice MUST be one of our legal SANs. If the API ever
  // returns something off-menu, fall back to the highest-probability legal SAN,
  // then to a random legal move. An illegal move must never reach the board.
  const legalSans = new Set(candidates.map((m) => m.san));
  let move = choice?.choice;
  if (!move || !legalSans.has(move)) {
    const probs = choice?.probabilities || {};
    const best = Object.entries(probs)
      .filter(([san]) => legalSans.has(san))
      .sort((a, b) => b[1] - a[1])[0];
    move = best ? best[0] : candidates[Math.floor(Math.random() * candidates.length)].san;
  }

  return {
    move,
    probabilities: choice?.probabilities || {},
    confidence: typeof choice?.confidence === "number" ? choice.confidence : null,
    evalScore: typeof evalAns?.score === "number" ? evalAns.score : null,
    evalLegend: evalAns?.legend || null,
    usage: data.usage || null,
  };
}

// Retry once on 429.
export async function chooseMoveWithRetry(game) {
  try {
    return await chooseMove(game);
  } catch (e) {
    if (e.code === 429) {
      await new Promise((r) => setTimeout(r, (e.retryAfter || 2) * 1000));
      return await chooseMove(game);
    }
    throw e;
  }
}

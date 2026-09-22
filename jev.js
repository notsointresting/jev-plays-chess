// The heart of the app: ask Jev to pick a move — now with the sliday method.
//
//   - Code (analysis.js) resolves exchanges, flags hanging material, and finds
//     mate-in-1. It writes the CONSEQUENCE of each move into that move's
//     description as finished prose, because Jev does no lookahead and is weak
//     at arithmetic.
//   - Every legal move is one option of a single `Choice` question, so an
//     illegal move is impossible by construction.
//   - A `Score` question rates the position for the eval bar.
//   - Jev makes ONE decision per move over options that already state their
//     consequences. That is what makes it play a real game instead of hanging
//     pieces.

import { CONFIG } from "./config.js";
import { getToken } from "./auth.js";
import { analysePosition } from "./analysis.js";

// Chess Choice rarely exceeds ~40 legal moves; well within Jev's option budget.
const MAX_OPTIONS = 60;

// Result: { move, probabilities, confidence, evalScore, source, usage }
// source ∈ "jev" | "fallback:offmenu" | "fallback:no-legal"
export async function chooseMove(game, ChessCtor) {
  const token = getToken();
  if (!token) {
    const err = new Error("not_connected");
    err.code = "not_connected";
    throw err;
  }

  const legalVerbose = game.moves({ verbose: true });
  if (legalVerbose.length === 0) {
    return { move: null, probabilities: {}, confidence: null, source: "fallback:no-legal" };
  }

  // In-code analysis: annotate every move with its consequence.
  const analysis = analysePosition(ChessCtor, game.fen());
  let moves = analysis.moves;

  // If a position is unusually branchy, keep the most relevant options.
  if (moves.length > MAX_OPTIONS) {
    moves = [...moves]
      .sort((a, b) => weight(b) - weight(a))
      .slice(0, MAX_OPTIONS);
  }

  const sideToMove = game.turn() === "w" ? "White" : "Black";
  const legalSans = new Set(moves.map((m) => m.san));

  // criteria: SAN -> consequence-annotated description.
  const criteria = {};
  for (const m of moves) criteria[m.san] = m.description;

  const state = {
    instructions_to_reader:
      `YOU ARE PLAYING ${sideToMove.toUpperCase()}. It is your turn. ` +
      `Uppercase letters on the board are your pieces; lowercase are the opponent's.`,
    position_fen: game.fen(),
    board: game.ascii(),
    situation: analysis.summary,
  };

  const questions = {
    best_move: {
      type: "choice",
      instructions:
        `You are playing chess as ${sideToMove} and it is your turn. Pick the strongest move. ` +
        `Take free material when it is offered, deliver checkmate when it is available, and escape check. ` +
        `Do not play a move described as a blunder or as losing material unless every alternative is worse.`,
      criteria,
    },
    evaluation: {
      type: "score",
      instructions: "From White's perspective, who stands better right now?",
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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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

  // Honest fallback: an illegal move is unrepresentable, but if the API ever
  // returns a key we didn't send, we say so via `source` rather than hiding it.
  let move = choice?.choice;
  let source = "jev";
  if (!move || !legalSans.has(move)) {
    const probs = choice?.probabilities || {};
    const best = Object.entries(probs)
      .filter(([san]) => legalSans.has(san))
      .sort((a, b) => b[1] - a[1])[0];
    if (best) {
      move = best[0];
      source = "fallback:offmenu"; // still Jev's distribution, just not its top pick
    } else {
      move = moves[0].san;
      source = "fallback:offmenu";
    }
  }

  return {
    move,
    probabilities: choice?.probabilities || {},
    confidence: typeof choice?.confidence === "number" ? choice.confidence : null,
    evalScore: typeof evalAns?.score === "number" ? evalAns.score : null,
    evalLegend: evalAns?.legend || null,
    mateAvailable: analysis.mateMove,
    source,
    usage: data.usage || null,
  };
}

// Move weight for shortlisting branchy positions: prefer mates, checks,
// captures, and material gains.
function weight(m) {
  return (m.matesNow ? 100 : 0) + (m.givesCheck ? 2 : 0) + (m.net > 0 ? m.net : 0) + (m.net < 0 ? -1 : 0);
}

export async function chooseMoveWithRetry(game, ChessCtor) {
  try {
    return await chooseMove(game, ChessCtor);
  } catch (e) {
    if (e.code === 429) {
      await new Promise((r) => setTimeout(r, (e.retryAfter || 2) * 1000));
      return await chooseMove(game, ChessCtor);
    }
    throw e;
  }
}

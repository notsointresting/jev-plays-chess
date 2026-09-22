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

  // In-code analysis: annotate every legal move with its consequence, and build
  // the rich state (material balance, checkmate headline, board, history).
  const history = game.history();
  const analysis = analysePosition(ChessCtor, game.fen(), history);
  let moves = analysis.moves;

  // If a position is unusually branchy, keep the most relevant options.
  if (moves.length > MAX_OPTIONS) {
    moves = [...moves].sort((a, b) => weight(b) - weight(a)).slice(0, MAX_OPTIONS);
  }

  const sideToMove = game.turn() === "w" ? "White" : "Black";
  const legalSans = new Set(moves.map((m) => m.san));

  // criteria: SAN -> consequence-annotated description.
  const criteria = {};
  for (const m of moves) criteria[m.san] = m.description;

  const state = analysis.summary;

  const questions = {
    best_move: {
      type: "choice",
      instructions:
        "You are playing this game of chess and it is your turn. Pick the strongest move. " +
        "Take free material when it is offered, deliver checkmate when it is available, and escape check. " +
        "Do not play a move described as a blunder or as losing material unless every alternative is worse.",
      criteria,
    },
    // These ride along in the same request. Jev answers them in parallel and
    // can't read each other, so they cost almost nothing on top of the move.
    king_in_danger: {
      type: "noul",
      instructions: "Your own king is in serious danger in this position.",
    },
    posture: {
      type: "choice",
      instructions: "What should you be doing in this position right now?",
      criteria: {
        attack: "go after the opponent's king",
        develop: "bring out pieces and castle",
        grab_material: "win material that is hanging",
        defend: "parry a threat or protect a weakness",
        endgame: "push pawns and activate the king",
      },
    },
    evaluation: {
      type: "score",
      instructions: `From ${sideToMove}'s perspective, who stands better right now?`,
      criteria: ["losing badly", "worse", "roughly equal", "better", "winning"],
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
  const posture = data.answers?.posture;
  const kingDanger = data.answers?.king_in_danger;

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

  // The eval Score is from the side-to-move's perspective (0=losing..4=winning).
  // Normalize to White's perspective so the eval bar is stable across turns.
  let evalWhite = null;
  if (typeof evalAns?.score === "number") {
    evalWhite = game.turn() === "w" ? evalAns.score : 4 - evalAns.score;
  }

  return {
    move,
    probabilities: choice?.probabilities || {},
    confidence: typeof choice?.confidence === "number" ? choice.confidence : null,
    evalScore: evalWhite, // 0=Black winning .. 4=White winning
    posture: posture?.choice ?? null,
    kingDanger: typeof kingDanger?.noul === "number" ? kingDanger.noul : null,
    mateAvailable: analysis.mateMove,
    source,
    usage: data.usage || null,
  };
}

// Move weight for shortlisting branchy positions: prefer mates, checks,
// captures, and material gains.
function weight(m) {
  return (m.givesMate ? 100 : 0) + (m.givesCheck ? 2 : 0) + (m.net > 0 ? m.net : 0) + (m.net < 0 ? -1 : 0);
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

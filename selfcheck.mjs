// Self-check for the exchange / hanging-material analysis.
// Run: npm test   (needs chess.js: npm i)
//
// The key case is the double-attacker position from sliday/jev-chess-algo:
// a piece attacked twice, defended once. A naive "one capture + one recapture"
// check wrongly reports it as safe. The exchange-to-the-end sees the piece falls.

import assert from "node:assert";
import { Chess } from "chess.js";
import { exchangeOn, analyseMoves, analysePosition, materialBalance } from "./analysis.js";

// --- A free hanging pawn wins material ------------------------------------
{
  const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
  const moves = analyseMoves(Chess, fen);
  const exd5 = moves.find((m) => m.san === "exd5");
  assert.ok(exd5, "exd5 should be legal");
  assert.ok(exd5.materialGain >= 1, `exd5 should win a pawn, got ${exd5.materialGain}`);
  assert.ok(exd5.net >= 1, `exd5 net should be positive, got ${exd5.net}`);
}

// --- The documented double-attacker bug -----------------------------------
// Black to move. Knight e4 attacked twice, defended once. Quiet moves must be
// flagged as losing the knight; the buggy one-recapture check said 0 for all.
{
  const fen = "2kr1b1r/ppp1pppp/2nq4/5b2/3PnP2/P1NBPN2/1P4PP/R1BQK2R b KQ - 2 9";
  const a = analysePosition(Chess, fen);
  const quiet = a.moves.filter(
    (m) => !m.isCapture && !m.givesCheck && !m.givesMate,
  );
  const hangs = quiet.filter((m) => m.net < 0);
  assert.ok(hangs.length > 0, "at least one quiet move must be flagged as losing material");
  // The refutation should be named on a hanging move.
  assert.ok(
    hangs.some((m) => m.refutedBy && m.net <= -2),
    "a hanging quiet move should name the refuting capture and be net-negative",
  );
  // The state summary should reflect that not all moves are safe.
  const total = a.moves.length;
  const safe = a.moves.filter((m) => m.net >= 0).length;
  assert.ok(safe < total, `some moves must lose material here (safe=${safe}/${total})`);
}

// --- exchangeOn is non-negative -------------------------------------------
{
  const chess = new Chess("4k3/8/8/8/3q4/8/3R4/3RK3 w - - 0 1");
  assert.ok(exchangeOn(chess, "d4") >= 0, "exchangeOn must be non-negative");
}

// --- Mate-in-1 detected and surfaced in the state -------------------------
{
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
  const a = analysePosition(Chess, fen);
  assert.equal(a.mateMove, "Qxf7#", `should find Qxf7# mate, got ${a.mateMove}`);
  assert.ok(a.summary.includes("CHECKMATE IS AVAILABLE"), "summary must announce mate");
  // When mate is available, material headline must not appear.
  assert.ok(!a.summary.includes("wins") || a.summary.indexOf("CHECKMATE") < a.summary.indexOf("wins the game"),
    "mate headline should dominate");
}

// --- Material balance from side-to-move perspective -----------------------
{
  // White up a full rook.
  const chess = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
  assert.equal(materialBalance(chess), 5, "white to move, up a rook = +5");
}

// --- Descriptions read as finished prose (no bare subtraction) ------------
{
  const moves = analyseMoves(Chess, "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
  const mate = moves.find((m) => m.givesMate);
  assert.ok(mate && /CHECKMATE/.test(mate.description), "mate move should be described as checkmate");
}

console.log("selfcheck: all analysis assertions passed");

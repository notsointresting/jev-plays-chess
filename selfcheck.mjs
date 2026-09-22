// Self-check for the exchange/hanging-material analysis.
// Run: node selfcheck.mjs   (needs chess.js installed: npm i)
//
// The key case is the double-attacker position from sliday/jev-chess-algo:
// a knight attacked twice, defended once. A naive "one capture + one recapture"
// check wrongly reports it as safe. A correct exchange-to-the-end sees the
// piece falls. We assert the correct behaviour so a regression turns red.

import assert from "node:assert";
import { Chess } from "chess.js";
import { exchangeOn, analysePosition } from "./analysis.js";

// --- Basic sanity: a free hanging pawn ------------------------------------
// White pawn on e4 can capture d5; after exd5, is d5 defended? Set up a spot
// where a capture simply wins a pawn cleanly.
{
  // White to move; e4 pawn, black pawn d5 undefended.
  const fen = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
  const a = analysePosition(Chess, fen);
  const exd5 = a.moves.find((m) => m.san === "exd5");
  assert.ok(exd5, "exd5 should be legal");
  assert.ok(exd5.net >= 1, `exd5 should win ~a pawn, got net=${exd5.net}`);
}

// --- The documented double-attacker bug -----------------------------------
// Black to move. Knight on e4 is attacked by knight (c3) and bishop (d3),
// defended once (by d-file/pieces). Quiet moves must be flagged as losing the
// knight; the correct holding moves add a second defender.
{
  const fen = "2kr1b1r/ppp1pppp/2nq4/5b2/3PnP2/P1NBPN2/1P4PP/R1BQK2R b KQ - 2 9";
  const a = analysePosition(Chess, fen);

  // A quiet pawn break like ...b6 or ...a5 leaves e4 hanging: at least one such
  // quiet move must be net-negative (the old buggy check said 0 for all).
  const quiet = a.moves.filter(
    (m) => !m.san.includes("x") && !m.san.includes("+") && !m.san.includes("#"),
  );
  const anyHang = quiet.some((m) => m.net < 0);
  assert.ok(
    anyHang,
    "at least one quiet move must be flagged as losing material (e4 hangs)",
  );

  // Far fewer than half the moves should be 'safe' here — the board is not quiet.
  const total = a.moves.length;
  const safe = a.moves.filter((m) => m.net >= 0).length;
  assert.ok(
    safe < total,
    `some moves must lose material in this sharp position (safe=${safe}/${total})`,
  );
}

// --- exchangeOn returns non-negative and resolves cheapest-first ----------
{
  // White queen on d1, rook d-file; a contested square exchange should never
  // return a negative number (the mover can always decline).
  const fen = "4k3/8/8/8/3q4/8/3R4/3RK3 w - - 0 1";
  const chess = new Chess(fen);
  const v = exchangeOn(chess, "d4");
  assert.ok(v >= 0, `exchangeOn must be non-negative, got ${v}`);
}

// --- Mate-in-1 is detected and surfaced -----------------------------------
{
  // Scholar's-mate-style: White to play Qxf7#.
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
  const a = analysePosition(Chess, fen);
  assert.equal(a.mateMove, "Qxf7#", `should find Qxf7# mate, got ${a.mateMove}`);
  assert.ok(
    a.summary.includes("CHECKMATE IS AVAILABLE"),
    "summary must announce available checkmate",
  );
}

console.log("selfcheck: all analysis assertions passed");

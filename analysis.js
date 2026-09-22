// In-code chess analysis. The model is bad at arithmetic and does no lookahead,
// so ALL counting and one-ply tactics happen here in plain code; the RESULT is
// written into each move's description as finished prose. Jev then makes one
// Choice among options that already state their consequences.
//
// Method follows sliday/jev-chess-algo (MIT): every legal move stays on the
// list (blunders included, described as blunders); the exchange on a square is
// played out with the CHEAPEST attacker first, to the end, because capturing
// with a queen what a pawn could take turns a won exchange into a lost one.
//
// Works with a `chess.js` Chess constructor passed in (browser loads it from a
// CDN; the self-check passes it from npm).

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function pieceName(p) {
  return { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" }[
    p.toLowerCase()
  ] || p;
}

// Resolve the capture sequence on `target` for the side to move in `chess`.
// Returns the net points the side to move gains by initiating/continuing the
// exchange, assuming each side takes with its cheapest attacker and stops when
// continuing would lose. One board is walked with move/undo (fast).
export function exchangeOn(chess, target) {
  let cheapest = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== target || !m.captured) continue;
    if (!cheapest || (PIECE_VALUE[m.piece] ?? 0) < (PIECE_VALUE[cheapest.piece] ?? 0)) {
      cheapest = m;
    }
  }
  if (!cheapest) return 0;
  chess.move(cheapest.san);
  const deeper = exchangeOn(chess, target);
  chess.undo();
  // Either side may decline: only continue an exchange that gains something.
  return Math.max(0, (PIECE_VALUE[cheapest.captured] ?? 0) - deeper);
}

// Net material change (in points, from the mover's perspective) after playing
// `move` in `chess`: what you capture now, minus what the opponent wins back by
// the best exchange on your landing square. Positive = you gain, negative =
// you hang material.
function netMaterialAfter(ChessCtor, chess, move) {
  const gain = move.captured ? PIECE_VALUE[move.captured] ?? 0 : 0;
  const after = new ChessCtor(chess.fen());
  after.move(move.san);
  // Now it's the opponent's move; how much can they win back on `move.to`?
  const lossBack = exchangeOn(after, move.to);
  return gain - lossBack;
}

const isCheck = (g) => (g.inCheck?.() ?? g.in_check?.() ?? false);
const isMate = (g) => (g.isCheckmate?.() ?? g.in_checkmate?.() ?? false);

// Analyse the position for the side to move. Returns:
//   { moves: [{san, description, net, matesNow, givesCheck}], summary, mateMove }
export function analysePosition(ChessCtor, fen) {
  const chess = new ChessCtor(fen);
  const inCheckNow = isCheck(chess);
  const verbose = chess.moves({ verbose: true });

  const results = [];
  let mateMove = null;
  let loseMaterialCount = 0;

  for (const m of verbose) {
    // Look one ply ahead for mate / check by actually playing the move.
    const after = new ChessCtor(chess.fen());
    after.move(m.san);
    const matesNow = isMate(after);
    const givesCheck = isCheck(after);
    if (matesNow) mateMove = m.san;

    const net = netMaterialAfter(ChessCtor, chess, m);
    if (net < 0) loseMaterialCount++;

    results.push({ san: m.san, net, matesNow, givesCheck, move: m });
  }

  // Build descriptions. Counting/subtraction already done above.
  for (const r of results) {
    const m = r.move;
    const base = `${pieceName(m.piece)} ${m.from} to ${m.to}`;
    const bits = [];
    if (r.matesNow) {
      r.description = `${base}, delivering checkmate — wins the game outright`;
      continue;
    }
    if (m.captured) bits.push(`captures a ${pieceName(m.captured)}`);
    if (m.promotion) bits.push(`promotes to ${pieceName(m.promotion)}`);
    if (m.flags.includes("k")) bits.push("castles kingside");
    if (m.flags.includes("q")) bits.push("castles queenside");
    if (r.givesCheck) bits.push("gives check");

    let consequence = "";
    if (r.net <= -2) {
      consequence = `, but then the opponent wins ${-r.net} points, leaving you ${-r.net} points down overall — a serious blunder`;
    } else if (r.net === -1) {
      consequence = `, but then the opponent comes out 1 point ahead — loses material`;
    } else if (r.net >= 2 && m.captured) {
      consequence = `, winning ${r.net} points of material`;
    } else if (r.net >= 1 && m.captured) {
      consequence = `, winning a pawn's worth of material`;
    }
    r.description = bits.length ? `${base} (${bits.join(", ")})${consequence}` : `${base}${consequence}`;
  }

  const total = results.length;
  const safe = total - loseMaterialCount;
  let summary = inCheckNow
    ? "You are in check and must respond to it."
    : "You are not in check.";
  summary += ` Legal moves available: ${total}. Of these, ${safe} lose no material.`;
  if (mateMove) {
    summary =
      `CHECKMATE IS AVAILABLE THIS MOVE: ${mateMove}. Playing it wins the game outright. Nothing else in this position matters. ` +
      summary;
  }

  return {
    moves: results.map(({ san, description, net, matesNow, givesCheck }) => ({
      san,
      description,
      net,
      matesNow,
      givesCheck,
    })),
    summary,
    mateMove,
  };
}

export { PIECE_VALUE, pieceName };

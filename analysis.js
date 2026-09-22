// In-code chess analysis — the "what hangs, in code" layer.
//
// Faithfully ports the method in sliday/jev-chess-algo (MIT): Jev is bad at
// arithmetic and does no lookahead, so EVERY number a chess decision needs —
// what a capture really wins after the recapture, what the opponent wins in
// reply — is worked out here and handed to Jev as a finished sentence. This is
// one ply of lookahead, not a search. It DESCRIBES every legal move; it never
// ranks, prunes, or picks. Jev picks.
//
// A `chess.js` Chess constructor is passed in (browser: window.Chess; the
// self-check: the npm import).

export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const CENTRE = new Set(["d4", "e4", "d5", "e5"]);

const inCheck = (g) => (g.inCheck?.() ?? g.in_check?.() ?? false);
const isMate = (g) => (g.isCheckmate?.() ?? g.in_checkmate?.() ?? false);
const isStalemate = (g) => (g.isStalemate?.() ?? g.in_stalemate?.() ?? false);
const isOver = (g) => (g.isGameOver?.() ?? g.game_over?.() ?? false);
const moveNumber = (g) => (g.moveNumber?.() ?? Math.floor((g.history?.() ?? []).length / 2) + 1);

// Static exchange on one square: side to move takes with its CHEAPEST attacker,
// the other side decides whether to take back, and so on. Either side may stop
// (the Math.max(0, ...)). Taking cheapest-first matters — a queen taking what a
// pawn could take turns a won exchange into a lost one. One board, move/undo.
export function exchangeOn(chess, target) {
  let cheapest = null;
  for (const m of chess.moves({ verbose: true })) {
    if (m.to !== target || !m.captured) continue;
    if (!cheapest || (PIECE_VALUE[m.piece] ?? 0) < (PIECE_VALUE[cheapest.piece] ?? 0)) cheapest = m;
  }
  if (!cheapest) return 0;
  chess.move(cheapest.san);
  const deeper = exchangeOn(chess, target);
  chess.undo();
  return Math.max(0, (PIECE_VALUE[cheapest.captured] ?? 0) - deeper);
}

// Material the side to move can win right now, exchange played to the end.
// The hanging-piece check: is there a capture that still nets material after
// every attacker and defender of that square has had its turn.
function bestCaptureGain(chess) {
  let best = 0;
  let bestSan = null;
  for (const m of chess.moves({ verbose: true })) {
    if (!m.captured) continue;
    chess.move(m.san);
    const gain = (PIECE_VALUE[m.captured] ?? 0) - exchangeOn(chess, m.to);
    chess.undo();
    if (gain > best) {
      best = gain;
      bestSan = m.san;
    }
  }
  return { gain: best, san: bestSan };
}

function materialFor(chess, colour) {
  let total = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (sq && sq.color === colour) total += PIECE_VALUE[sq.type] ?? 0;
    }
  }
  return total;
}

export function materialBalance(chess) {
  const me = chess.turn();
  const them = me === "w" ? "b" : "w";
  return materialFor(chess, me) - materialFor(chess, them);
}

// One move, as a sentence. The bottom line is stated outright rather than left
// as a subtraction ("leaving you 2 points down overall", not "wins 3, loses 5").
function phrase(r) {
  if (r.givesMate) return "CHECKMATE, wins the game immediately";
  const bits = [`${PIECE_NAME[r.piece]} ${r.from} to ${r.to}`];
  if (r.isCastle) bits.push(r.san === "O-O" ? "castles kingside, king to safety" : "castles queenside, king to safety");
  if (r.isPromotion) bits.push("promotes to a queen");
  if (r.givesCheck) bits.push("gives check");
  if (r.materialGain > 0) bits.push(`wins ${r.materialGain} point${r.materialGain === 1 ? "" : "s"} of material`);
  else if (r.materialGain < 0) bits.push(`loses ${-r.materialGain} points in the exchange`);
  else if (r.isCapture) bits.push("an even trade");
  if (r.threatAgainst >= 1) {
    bits.push(
      `but then the opponent wins ${r.threatAgainst} point${r.threatAgainst === 1 ? "" : "s"}` +
        (r.refutedBy ? ` with ${r.refutedBy}` : ""),
    );
    if (r.net > 0) bits.push(`leaving you ${r.net} point${r.net === 1 ? "" : "s"} up overall`);
    else if (r.net < 0) bits.push(`leaving you ${-r.net} point${r.net === -1 ? "" : "s"} down overall`);
    else bits.push("breaking even overall");
  }
  if (r.causesStalemate) bits.push("STALEMATE, throws away the win and only draws");
  if (r.net >= 3) bits.push("clearly winning material");
  else if (r.net <= -3) bits.push("a serious blunder");
  else if (r.net <= -1) bits.push("loses material");
  if (r.net >= 0 && !r.isCapture) {
    if (r.takesCentre) bits.push("takes the centre");
    if (r.developsPiece) bits.push("develops a new piece");
  }
  return bits.join(", ");
}

// Analyse every legal move. The full list, never pruned.
export function analyseMoves(ChessCtor, fen) {
  const chess = new ChessCtor(fen);
  return chess.moves({ verbose: true }).map((m) => {
    const after = new ChessCtor(fen);
    after.move(m.san);

    let materialGain = 0;
    if (m.captured) materialGain = (PIECE_VALUE[m.captured] ?? 0) - exchangeOn(after, m.to);
    if (m.promotion) materialGain += (PIECE_VALUE[m.promotion] ?? 0) - 1;

    const givesMate = isMate(after);
    const causesStalemate = isStalemate(after);
    const threat = givesMate || isOver(after) ? { gain: 0, san: null } : bestCaptureGain(after);
    const backRank = m.color === "w" ? "1" : "8";

    const r = {
      san: m.san,
      from: m.from,
      to: m.to,
      piece: m.piece,
      materialGain,
      threatAgainst: threat.gain,
      net: materialGain - threat.gain,
      givesCheck: inCheck(after) && !givesMate,
      givesMate,
      causesStalemate,
      isCapture: Boolean(m.captured),
      isPromotion: Boolean(m.promotion),
      isCastle: m.san === "O-O" || m.san === "O-O-O",
      developsPiece: (m.piece === "n" || m.piece === "b") && m.from[1] === backRank,
      takesCentre: CENTRE.has(m.to),
      refutedBy: threat.gain >= 1 ? threat.san : null,
      description: "",
    };
    r.description = phrase(r);
    return r;
  });
}

// The position written out as Jev's `state`. Reader is always the side to move,
// addressed as "you"; its colour and which letter-case is its own are stated
// outright (the model answers literally, so tell it rather than make it infer).
export function describePosition(ChessCtor, fen, reports, history = []) {
  const chess = new ChessCtor(fen);
  const you = chess.turn() === "w" ? "White" : "Black";
  const them = chess.turn() === "w" ? "Black" : "White";
  const yourCase = chess.turn() === "w" ? "UPPERCASE" : "lowercase";
  const theirCase = chess.turn() === "w" ? "lowercase" : "UPPERCASE";
  const balance = materialBalance(chess);
  const standing =
    balance > 0 ? `you are ahead by ${balance} points`
      : balance < 0 ? `you are behind by ${-balance} points`
      : "material is level";
  const best = Math.max(...reports.map((r) => r.net), 0);
  const safe = reports.filter((r) => r.net >= 0).length;
  const mates = reports.filter((r) => r.givesMate).map((r) => r.san);

  const headline = mates.length
    ? `CHECKMATE IS AVAILABLE THIS MOVE: ${mates.join(" or ")}. Playing it wins the game outright. Nothing else in this position matters.`
    : best > 0
      ? `The best available move wins ${best} points of material.`
      : "No move wins material outright.";

  const theirLast = history.length > 0 ? history[history.length - 1] : null;

  return [
    `YOU ARE PLAYING ${you.toUpperCase()}. Your opponent is ${them}. It is your turn to move now.`,
    "",
    `Position (FEN): ${chess.fen()}`,
    `Move number: ${moveNumber(chess)}`,
    `Material: ${standing}`,
    inCheck(chess) ? "YOU ARE IN CHECK and must deal with it." : "You are not in check.",
    `Legal moves available to you: ${reports.length}. Of these, ${safe} lose no material.`,
    headline,
    "",
    history.length > 0 ? `The game so far: ${formatHistory(history)}` : "No moves have been played yet.",
    theirLast ? `Your opponent has just played ${theirLast}.` : null,
    "",
    `The board. Your pieces are the ${yourCase} letters; your opponent's are the ${theirCase} ones.`,
    "p=pawn n=knight b=bishop r=rook q=queen k=king, and a dot is an empty square.",
    chess.ascii(),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

export function formatHistory(history) {
  const out = [];
  for (let i = 0; i < history.length; i += 2) {
    out.push(`${i / 2 + 1}. ${history[i]}${history[i + 1] ? ` ${history[i + 1]}` : ""}`);
  }
  return out.join(" ");
}

// Convenience: everything the caller needs for one position.
export function analysePosition(ChessCtor, fen, history = []) {
  const moves = analyseMoves(ChessCtor, fen);
  const mateMove = moves.find((m) => m.givesMate)?.san ?? null;
  const summary = describePosition(ChessCtor, fen, moves, history);
  return { moves, summary, mateMove };
}

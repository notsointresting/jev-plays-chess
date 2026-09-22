// Board rendering + click-to-move interaction. Pure DOM, Unicode glyphs, no
// image assets. Renders from a chess.js instance and paints Jev's move
// probabilities as heat on destination squares.

const GLYPH = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];

export class Board {
  // el: container element. onUserMove(from, to): called with a legal-looking
  // user move attempt; controller validates + applies. orientation: "w" | "b".
  constructor(el, onUserMove) {
    this.el = el;
    this.onUserMove = onUserMove;
    this.orientation = "w";
    this.selected = null; // selected source square
    this.legalForSelected = []; // destination squares for the selected piece
    this.heat = {}; // { squareTo: probability } for Jev's last decision
    this.lastMove = null; // { from, to }
    this.interactive = true;
    this._squares = {}; // square -> element
    this._build();
  }

  _build() {
    this.el.innerHTML = "";
    this.el.classList.add("board");
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    const files = [...FILES];
    const rankOrder = this.orientation === "w" ? ranks : [...ranks].reverse();
    const fileOrder = this.orientation === "w" ? files : [...files].reverse();
    for (const r of rankOrder) {
      for (const f of fileOrder) {
        const sq = f + r;
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className =
          "sq " + ((FILES.indexOf(f) + r) % 2 === 0 ? "dark" : "light");
        cell.dataset.square = sq;
        cell.addEventListener("click", () => this._onClick(sq));
        this._squares[sq] = cell;
        this.el.appendChild(cell);
      }
    }
  }

  setOrientation(o) {
    this.orientation = o;
    this._build();
  }

  setInteractive(v) {
    this.interactive = v;
  }

  // Render pieces from a chess.js instance.
  render(game) {
    this.game = game;
    const board = game.board(); // 8x8 from rank 8 to rank 1
    for (let rIdx = 0; rIdx < 8; rIdx++) {
      for (let fIdx = 0; fIdx < 8; fIdx++) {
        const sq = FILES[fIdx] + (8 - rIdx);
        const piece = board[rIdx][fIdx];
        const cell = this._squares[sq];
        if (!cell) continue;
        cell.textContent = piece ? GLYPH[piece.color + piece.type] : "";
        cell.classList.toggle("has-piece", !!piece);
      }
    }
    this._paint();
  }

  // Highlight state: selection, legal targets, last move, heat.
  _paint() {
    for (const [sq, cell] of Object.entries(this._squares)) {
      cell.classList.remove("sel", "target", "lastmove");
      cell.style.removeProperty("--heat");
      cell.classList.remove("heat");
      if (this.lastMove && (sq === this.lastMove.from || sq === this.lastMove.to))
        cell.classList.add("lastmove");
      if (sq === this.selected) cell.classList.add("sel");
      if (this.legalForSelected.includes(sq)) cell.classList.add("target");
      const h = this.heat[sq];
      if (typeof h === "number" && h > 0.01) {
        cell.classList.add("heat");
        cell.style.setProperty("--heat", h.toFixed(3));
      }
    }
  }

  clearHeat() {
    this.heat = {};
    this._paint();
  }

  // Paint destination-square heat from a {san: prob} map using the game to
  // resolve each SAN to its destination square.
  showHeat(game, probabilities) {
    this.heat = {};
    const verbose = game.moves({ verbose: true });
    const bySan = {};
    for (const m of verbose) bySan[m.san] = m.to;
    for (const [san, p] of Object.entries(probabilities || {})) {
      const to = bySan[san];
      if (to) this.heat[to] = Math.max(this.heat[to] || 0, p);
    }
    this._paint();
  }

  setLastMove(from, to) {
    this.lastMove = { from, to };
    this._paint();
  }

  _onClick(sq) {
    if (!this.interactive || !this.game) return;
    const piece = this.game.get(sq);

    // Second click: attempt a move to this square.
    if (this.selected && this.legalForSelected.includes(sq)) {
      const from = this.selected;
      this.selected = null;
      this.legalForSelected = [];
      this._paint();
      this.onUserMove(from, sq);
      return;
    }

    // Select own piece to move.
    if (piece && piece.color === this.game.turn()) {
      this.selected = sq;
      this.legalForSelected = this.game
        .moves({ square: sq, verbose: true })
        .map((m) => m.to);
      this.clearHeat();
      this._paint();
      return;
    }

    // Click elsewhere: deselect.
    this.selected = null;
    this.legalForSelected = [];
    this._paint();
  }
}

// Jev Plays Chess — controller. Wires board + jev + auth into a game loop.

import { CONFIG } from "./config.js";
import {
  login,
  disconnect,
  isConnected,
  fetchUserInfo,
  handleRedirectCallback,
} from "./auth.js";
import { Board } from "./board.js";
import { chooseMoveWithRetry } from "./jev.js";

const $ = (id) => document.getElementById(id);
const Chess = window.Chess;

const el = {
  connect: $("connect-btn"),
  disconnect: $("disconnect-btn"),
  status: $("conn-status"),
  banner: $("banner"),
  board: $("board"),
  evalFill: $("eval-fill"),
  evalLabel: $("eval-label"),
  sideSeg: $("side-seg"),
  newGame: $("new-game"),
  statusLine: $("status"),
  jevMove: $("jev-move"),
  jmSan: $("jm-san"),
  jmConf: $("jm-conf"),
  jmTop: $("jm-top"),
  moves: $("moves"),
};

let game = new Chess();
let humanColor = "w";
let board;
let busy = false;

// --- banner ---------------------------------------------------------------
function showBanner(kind, html) {
  el.banner.hidden = false;
  el.banner.dataset.kind = kind;
  el.banner.innerHTML = html;
}
function hideBanner() {
  el.banner.hidden = true;
}

// --- auth UI --------------------------------------------------------------
function refreshAuthUI() {
  const connected = isConnected();
  el.status.dataset.state = connected ? "on" : "off";
  el.status.textContent = connected ? "Connected" : "Not connected";
  el.connect.hidden = connected;
  el.disconnect.hidden = !connected;
  if (connected) {
    fetchUserInfo().then((u) => {
      if (u && (u.username || u.name) && isConnected())
        el.status.textContent = "Connected as " + (u.username || u.name);
    });
  }
}

el.connect.addEventListener("click", async () => {
  try {
    await login();
  } catch (e) {
    showBanner(
      "error",
      `${escapeHtml(e.message)} <a href="${CONFIG.KEYS_DASHBOARD}" target="_blank" rel="noopener">Key dashboard →</a>`,
    );
  }
});
el.disconnect.addEventListener("click", () => {
  disconnect();
  refreshAuthUI();
});

// --- side selection + new game -------------------------------------------
el.sideSeg.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-side]");
  if (!btn) return;
  [...el.sideSeg.children].forEach((b) => b.classList.toggle("active", b === btn));
  humanColor = btn.dataset.side;
  newGame();
});
el.newGame.addEventListener("click", newGame);

function newGame() {
  if (busy) return;
  game = new Chess();
  board.setOrientation(humanColor);
  board.setLastMove(null, null);
  board.lastMove = null;
  board.clearHeat();
  board.render(game);
  el.jevMove.hidden = true;
  updateMoves();
  updateEval(2); // start "roughly equal" (index 2 of 5)
  hideBanner();
  // If the human is black, Jev (white) moves first.
  if (humanColor === "b") {
    setStatus("Jev is thinking", true);
    jevTurn();
  } else {
    setStatus("Your move.");
  }
}

// --- user move ------------------------------------------------------------
async function onUserMove(from, to) {
  if (busy) return;
  // Handle promotion: auto-queen for simplicity (most common).
  const moves = game.moves({ verbose: true });
  const m = moves.find((x) => x.from === from && x.to === to);
  if (!m) return;
  const opts = { from, to };
  if (m.promotion) opts.promotion = "q";
  const made = game.move(opts);
  if (!made) return;

  board.setLastMove(from, to);
  board.render(game);
  updateMoves();
  el.jevMove.hidden = true;

  if (checkGameOver()) return;

  await jevTurn();
}

// --- Jev's turn -----------------------------------------------------------
async function jevTurn() {
  if (!isConnected()) {
    setStatus("");
    showBanner("info", "Connect your Pollen first — then it's Jev's move.");
    return;
  }
  busy = true;
  board.setInteractive(false);
  setStatus("Jev is thinking", true);
  try {
    const result = await chooseMoveWithRetry(game);
    if (!result.move) {
      checkGameOver();
      return;
    }
    // Capture the pre-move position so heat maps to the right destination
    // squares, then apply Jev's move.
    const preMove = new Chess(game.fen());
    const made = game.move(result.move);
    const applied = made || game.move(game.moves()[0]);
    board.setLastMove(applied.from, applied.to);
    board.render(game);
    board.showHeat(preMove, result.probabilities);
    renderJevMove(result);
    updateMoves();
    if (typeof result.evalScore === "number") updateEval(result.evalScore);
    checkGameOver();
    if (!isOver()) setStatus("Your move.");
  } catch (e) {
    handleApiError(e);
  } finally {
    busy = false;
    board.setInteractive(true);
  }
}

function renderJevMove(result) {
  el.jevMove.hidden = false;
  el.jmSan.textContent = result.move;
  el.jmConf.textContent =
    typeof result.confidence === "number"
      ? `· ${Math.round(result.confidence * 100)}% confident`
      : "";
  const entries = Object.entries(result.probabilities || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  el.jmTop.innerHTML = entries
    .map(
      ([san, p]) => `
      <div class="tm-row">
        <span class="tm-san">${escapeHtml(san)}</span>
        <span class="tm-track"><span class="tm-fill" style="width:${(p * 100).toFixed(0)}%"></span></span>
        <span class="tm-val">${(p * 100).toFixed(0)}%</span>
      </div>`,
    )
    .join("");
}

// --- eval bar (0..4 score → white share) ----------------------------------
function updateEval(score) {
  // score 0 = Black winning, 4 = White winning. Map to a white % height.
  const clamped = Math.max(0, Math.min(4, score));
  const whitePct = (clamped / 4) * 100;
  el.evalFill.style.height = whitePct.toFixed(0) + "%";
  el.evalLabel.textContent = Math.round(whitePct);
}

// --- game state helpers ---------------------------------------------------
function isOver() {
  return game.isGameOver?.() ?? game.game_over?.() ?? false;
}
function checkGameOver() {
  if (!isOver()) return false;
  board.setInteractive(false);
  let msg;
  const checkmate = game.isCheckmate?.() ?? game.in_checkmate?.();
  const draw = game.isDraw?.() ?? game.in_draw?.();
  if (checkmate) {
    const loser = game.turn() === "w" ? "White" : "Black";
    const winner = loser === "White" ? "Black" : "White";
    const youWon = (winner === "White" ? "w" : "b") === humanColor;
    msg = `Checkmate — ${winner} wins. ${youWon ? "You beat Jev! 🎉" : "Jev wins."}`;
  } else if (draw) {
    msg = "Draw.";
  } else {
    msg = "Game over.";
  }
  setStatus(msg);
  showBanner("info", msg + ' <a href="#" id="again">New game</a>');
  const again = document.getElementById("again");
  if (again) again.addEventListener("click", (e) => { e.preventDefault(); newGame(); });
  return true;
}

function updateMoves() {
  const hist = game.history();
  if (hist.length === 0) {
    el.moves.textContent = "No moves yet.";
    return;
  }
  let out = "";
  for (let i = 0; i < hist.length; i += 2) {
    const n = i / 2 + 1;
    out += `${n}. ${hist[i]}${hist[i + 1] ? " " + hist[i + 1] : ""}   `;
  }
  el.moves.textContent = out.trim();
  el.moves.scrollTop = el.moves.scrollHeight;
}

function setStatus(text, thinking = false) {
  el.statusLine.textContent = text;
  el.statusLine.classList.toggle("thinking", !!thinking);
  el.statusLine.classList.toggle("muted", !thinking && !text.includes("wins") && !text.includes("beat"));
}

function handleApiError(e) {
  setStatus("Your move.");
  if (e.code === 402) {
    showBanner("error", `Out of Pollen budget. <a href="${CONFIG.KEYS_DASHBOARD}" target="_blank" rel="noopener">Top up or reconnect →</a>`);
  } else if (e.code === 401 || e.code === "not_connected") {
    disconnect();
    refreshAuthUI();
    showBanner("error", "Session expired — connect again to keep playing.");
  } else {
    showBanner("error", `Jev couldn't move (${escapeHtml(String(e.code || e.message))}). Try again or start a new game.`);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- boot -----------------------------------------------------------------
async function boot() {
  board = new Board(el.board, onUserMove);
  board.setOrientation(humanColor);
  board.render(game);
  updateEval(2);

  const outcome = await handleRedirectCallback();
  if (outcome === "connected") {
    showBanner("info", "Connected. Make a move — Jev will answer.");
  } else if (outcome && outcome.startsWith("error:")) {
    const reason = outcome.slice(6);
    if (reason !== "access_denied") showBanner("error", `Sign-in failed: ${escapeHtml(reason)}.`);
  }
  refreshAuthUI();
  if (humanColor === "w") setStatus("Your move.");
}

boot();

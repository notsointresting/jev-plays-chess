# Jev Plays Chess ♞

**Play chess against a model that never *generates* a move.**

Jev is a *decision* model, not a chat model. In this app, every legal move in
the current position becomes one option of a single typed **Choice** question.
Jev returns a probability for each legal move and plays the one it believes in —
there is **no chess engine underneath and no generated text**, so an illegal
move is impossible by construction.

- **You vs Jev**, single-player, in your browser. Play as White or Black.
- **Eval bar** driven by a `Score` question ("who's better?").
- **Move-probability heat** on the board + Jev's confidence and top 3 candidate
  moves shown every turn — you see *how it thinks*, not just what it plays.
- **Free.** No signup. Paid from **your own** Pollen (Bring Your Own Pollen).

Powered by [Pollinations](https://gen.pollinations.ai)' typed-decision endpoint
(`jev`). Curious what a decision model is? See
[awesome-jev-family](https://github.com/notsointresting/awesome-jev-family).

## How it works

Each time it's Jev's move:

1. The board position (FEN + ASCII) is sent as the `state`.
2. Every legal move (from `chess.js`) becomes an option of one `Choice`
   question, described in plain terms ("knight f3→e5 (captures pawn)").
3. A `Score` question rates the position for the eval bar.
4. Jev returns per-move probabilities; the app plays the top legal move and
   paints the probabilities as heat on the board.

`chess.js` handles move generation, legality, check, checkmate, and draws.
Jev only ever *chooses among legal moves*; a guard rejects any off-menu answer
so an illegal move can never reach the board.

## Run locally

```bash
python -m http.server 8000
# open http://localhost:8000/
```

Uses a Pollinations **App Key** (public `pk_`) set in `config.js`. `chess.js`
loads from a CDN, so just serve the folder.

## Setup: App Key redirect URIs

This app reuses a Pollinations App Key. On that key at
[enter.pollinations.ai/keys](https://enter.pollinations.ai/keys), add both
Redirect URIs (exact match):

- `https://notsointresting.github.io/jev-plays-chess/`
- `http://localhost:8000/`

The `pk_` App Key is a public client id — safe in the browser. Never put an
`sk_` secret key here.

## How this differs from other Jev-chess projects

- **jevchess.com** — collective: the whole internet plays one shared board.
- **JevChessBot (Lichess)** — a bot account playing rated games on Lichess.
- **This** — a standalone, no-signup, personal *you-vs-Jev* game with an eval
  bar, move-probability heat, and per-move confidence. Open a page, play in
  seconds, see how the model decides.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell; loads `chess.js` from CDN. |
| `styles.css` | Board, pieces (Unicode), heat, eval bar. |
| `config.js` | App Key + endpoints. |
| `auth.js` | BYOP OAuth 2.1 + PKCE. |
| `jev.js` | Builds the Choice-over-legal-moves + Score request; parses the answer. |
| `board.js` | Board rendering, click-to-move, probability heat. |
| `app.js` | Game loop / controller. |

## License

MIT

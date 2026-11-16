# Arcade — six turn-based games, offline

Open `index.html` in any browser. No server, no build, no network calls.
Your win/loss record and settings live in this browser's `localStorage`.

    firefox index.html

## The games

| # | Game            | Opponent                     | What the AI does                                  |
|---|-----------------|------------------------------|---------------------------------------------------|
| 1 | Tic-Tac-Toe     | perfect / near-perfect       | full minimax, with deliberate slips on Easy        |
| 2 | Connect Four    | depth 4 / 6 / 8              | negamax + alpha-beta, window scoring, time-capped  |
| 3 | Reversi         | depth 2 / 4 / 5              | alpha-beta with positional weights + mobility      |
| 4 | Checkers        | depth 2 / 5 / 8              | alpha-beta, mandatory-capture move generation      |
| 5 | Five in a Row   | heuristic / 1-ply / 2-ply    | pattern scoring, own-win and block checks          |
| 6 | Mancala         | depth 4 / 6 / 8              | alpha-beta with extra-turn handling                |

Every search has an iterative-deepening time budget (200 ms / 520 ms / 950 ms), so
`Ruthless` thinks longer instead of freezing the page.

## Controls

- **vs Talia** or **2 players** — hotseat on the same keyboard.
- **Easy / Steady / Ruthless** — changes search depth and how often the AI errs.
- **Undo** — rewinds your last move *and* the AI's reply.
- **Hint** — searches a shallow line for whoever is to move and flashes the square.
- **Esc** — back to the board list. **♪** — sound on/off (all audio is synthesised,
  no files).

## Layout

    index.html   markup + all CSS
    arcade.js    game engines + shell (no dependencies)
    icon.svg     launcher icon

## Adding a game

Append an object to the `GAMES` array in `arcade.js`:

    {
      id: 'x', name: 'Name', tag: 'one line', blurb: '…', rules: '…',
      mount(ctx) {
        // ctx.boardEl      container to draw into
        // ctx.mode         'ai' | 'two'
        // ctx.diff         0 | 1 | 2
        // ctx.setStatus(text, kind)  kind: you|ai|win|lose|draw
        // ctx.end(res, label)        res: 'w'|'l'|'d' or null for hotseat
        // ctx.flash(text)            transient message
        // ctx.alive()                false once the view is torn down
        return { undo, hint };       // both optional
      }
    }

`ctx.alive()` matters: AI turns run after `await` delays, so check it before
touching the DOM or a queued move will paint into a game you already left.

## Known limits

- No online play, no accounts, no undo history beyond the current game.
- Threefold-repetition and draw rules aren't implemented in Checkers or Reversi
  (Reversi does end when both sides are stuck).
- The record is per browser profile. Clearing site data resets it.

# Arcade — ten games, offline

**Play now: <https://nxgenwidgeter.github.io/arcade/>**

No accounts, no server, no build, no network calls. Your win/loss record and
settings live in that browser's `localStorage`.

That link is the edition to use on a Chromebook — or on any machine without
GTK. Nothing to install, and the desktop window described further down is
Linux-only and optional.

## Running it

| Where                          | How                                                                  |
|--------------------------------|----------------------------------------------------------------------|
| ChromeOS, Chrome, Firefox, Safari | open <https://nxgenwidgeter.github.io/arcade/>                    |
| Linux, as its own app window   | `./arcade` — needs `python3` with GTK 3 and WebKit2 4.1               |
| any browser, from a checkout   | open `index.html`                                                     |

Opening `index.html` straight off disk works, but a `file://` page has no stable
origin, so the record may be forgotten between reloads. That is exactly why the
desktop app serves the same three files from a fixed `127.0.0.1` port.

## The games

| # | Game            | Opponent                     | What the AI does                                  |
|---|-----------------|------------------------------|---------------------------------------------------|
| 1 | Tic-Tac-Toe     | perfect / near-perfect       | full minimax, with deliberate slips on Easy        |
| 2 | Connect Four    | depth 4 / 6 / 8              | negamax + alpha-beta, window scoring, time-capped  |
| 3 | Reversi         | depth 2 / 4 / 5              | alpha-beta with positional weights + mobility      |
| 4 | Checkers        | depth 2 / 5 / 8              | alpha-beta, mandatory-capture move generation      |
| 5 | Chess           | depth 1 / 3 / 5              | alpha-beta + quiescence, material and piece-square |
| 6 | Five in a Row   | heuristic / 1-ply / 2-ply    | pattern scoring, own-win and block checks          |
| 7 | Mancala         | depth 4 / 6 / 8              | alpha-beta with extra-turn handling                |
| 8 | Blackjack       | six decks, dealer stands 17  | — (house game, no opponent AI)                     |
| 9 | Big Two         | three AI seats               | climbs legal plays, holds back on Easy             |
| 10| Stickman Party  | a second human, best of five | — (real-time, no AI)                               |

Every search has an iterative-deepening time budget (200 ms / 520 ms / 950 ms), so
`Ruthless` thinks longer instead of freezing the page.

## Stickman Party

The one game that is not turn-based. Five short duels, shuffled each match: **Ring
out** (shove your rival off a shrinking disc), **Anvils** (dodge the shadows, last one
standing), **The run** (left/right through falling barriers, first to the line),
**Tug of war** (mash your keys, drag the knot past your marker) and **Quick draw**
(first key after the flare; press early and you lose). Most round wins takes the
match, and a tie gets one more round.

Player 1 uses `W A S D`. Player 2 uses the arrow keys. The arena is a canvas with a
fixed 60 fps loop, so both sets of keys are live at once. Losing window focus pauses
the round; click the arena to resume. There is no AI opponent and nothing is recorded
in the win/loss strip, because there is no winner to credit.

## Controls

- **vs Talia** or **2 players** — hotseat on the same keyboard.
- **Easy / Steady / Ruthless** — changes search depth and how often the AI errs.
- **Undo** — rewinds your last move *and* the AI's reply (in Chess, promotion and
  castling included).
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
`hideMode` / `hideDiff` drop the opponent and mood segments; Stickman Party sets
both, and draws into a canvas instead of DOM squares.

## Known limits

- No online play, no accounts, no undo history beyond the current game.
- Threefold-repetition and draw rules aren't implemented in Checkers or Reversi
  (Reversi does end when both sides are stuck).
- Chess covers the full rule set — castling, en passant, promotion, checkmate,
  stalemate, the fifty-move rule and dead positions — but not threefold
  repetition, and there are no clocks. Its move generator is verified against
  perft: `ARCADE_PORT=8799 /usr/bin/python3 ctest.py`.
- Stickman Party is keyboard-only (no gamepads) and its duels are deliberately
  short; `stest.py` drives all five through the real WebView.
- `window.__nxChess` and `window.__nxParty` are test hooks (perft + FEN loader, and
  minigame state) used by `ctest.py` / `stest.py`; nothing in the UI depends on them.
- The record is per browser profile. Clearing site data resets it.

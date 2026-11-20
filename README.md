# Arcade — eleven games, offline

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
| 10 | Poker          | Talia, fixed-limit hold'em   | hand strength vs pot odds, looser and pushier by mood |
| 11 | Ball Party     | a second human, best of five | — (real-time, no AI)                               |

Every search has an iterative-deepening time budget (200 ms / 520 ms / 950 ms), so
`Ruthless` thinks longer instead of freezing the page.

## Ball Party

The one game that is not turn-based. Eight short duels, five of them drawn at random
for each match: **Ring out** (shove your rival off a shrinking disc), **Anvils** (dodge
the shadows, last one standing), **The run** (left/right through falling barriers,
first to the line), **Tug of war** (mash your keys, drag the knot past your marker),
**Quick draw** (first key after the flare; press early and you lose), **Paint war**
(claim floor tiles for eighteen seconds, most tiles wins), **Trail** (grid snakes:
eat pellets, grow, make the other one crash) and **Rally** (paddle tennis to three
points). Most round wins takes the match, and a tie gets one more round.

Player 1 uses `W A S D`. Player 2 uses the arrow keys. The arena is a canvas with a
fixed 60 fps loop, so both sets of keys are live at once. Losing window focus pauses
the round; click the arena to resume. There is no AI opponent and nothing is recorded
in the win/loss strip, because there is no winner to credit.

## Poker

Heads-up Texas hold'em against Talia, fixed limit. Both players start with 500 chips
and the stacks carry over between hands (refilled when someone goes broke). Blinds are
10/20, bets and raises are 20 before the turn and 40 after, four raises a street. She
posts the small blind on alternate hands — the button alternates, and preflop the small
blind acts first.

Fold, call/check and bet/raise are the only decisions; the rest is the board. At
showdown the best five of seven decides, and the evaluator covers every category down
to the wheel (`A-2-3-4-5`) with proper kickers. **Undo** rewinds your last action *and*
whatever Talia did in reply. **Hint** names your hand and what it costs to stay in.

## Controls

- **vs Talia** or **2 players** — hotseat on the same keyboard.
- **Easy / Steady / Ruthless** — changes search depth and how often the AI errs.
- **Undo** — rewinds your last move *and* the AI's reply (in Chess, promotion and
  castling included).
- **Hint** — searches a shallow line for whoever is to move and flashes the square.
- **Esc** — back to the board list. **u** / **h** / **n** — undo, hint and new game.
  **♪** — sound on/off (all audio is synthesised, no files).

## Features

Eleven games, one page, no install: Tic-Tac-Toe, Connect Four, Reversi, Checkers, Chess,
Five in a Row, Mancala, Blackjack, Big Two, Poker and Ball Party. They are all entries in
one `GAMES` array, so the hub cards, the tagline and the rules panel are generated from
the game object itself.

- **Three moods** — Easy, Steady, Ruthless — change search depth and set a thinking
  budget of 200 ms, 520 ms, 950 ms.
- **Hotseat** — `vs Talia` or `2 players` on one keyboard. Hotseat games aren't scored:
  there's no winner to credit.
- **Undo** everywhere a take-back makes sense: the eight turn-based board games, Poker,
  and Blackjack. It rewinds your move and the reply. In Blackjack a settled hand comes
  back to the decision point — the cards, the stake and the chips are restored, and the
  win/loss entry it added is removed from the record.
- **Hint** in ten games. In Blackjack it's a basic-strategy advisor ("Basic play says:
  hit"), not a peek at the shoe; in Poker it names your made hand and the price of
  calling.
- **Record** — wins, losses and draws per game, kept in `localStorage` and shown on the
  hub card (`1W · 2L · 0D`) and in the game panel. A fresh profile reads
  `no games played`. `Download record` in the footer saves it as JSON; `Clear record`
  wipes it after a confirm.
- **Blackjack bankroll** — chips and your bet size carry over between visits, and Deal
  stays disabled while the bank can't cover the bet.
- **Ball Party** — eight real-time duels, five drawn per match, best of five, one
  extra round on a tie. Losing window focus pauses the round; click the arena to
  resume.
- **Sound** is synthesised at runtime, so there are no audio files to lose. **Esc**
  returns to the hub from any game.
- **Keyboard and touch** — board squares are real buttons with `aria-label`s, and the
  chess and checkers boards take `Tab` and answer `Enter`/`Space`. The layout reflows at
  560 px, and `prefers-reduced-motion` turns the animation off.

The desktop window adds its own chrome: F11 fullscreen, Ctrl+Q quit, Ctrl+R reload, F12
inspector, Ctrl `+` / `-` / `0` zoom, and window size, maximised state and zoom restored
on the next launch.

## Customizability

Everything you can change without editing a file:

| Knob | Where | Values |
|---|---|---|
| Sound | the ♪ button in the top bar | on / off |
| Opponent | "Opponent" segment in the game panel | vs Talia / 2 players |
| Mood | "Mood" segment in the game panel | Easy / Steady / Ruthless |
| Blackjack bet | the chip buttons while betting | 10 / 25 / 50 / 100 |

Those settings, the per-game record and the Blackjack bankroll share one `localStorage`
key, `nxgen.arcade.v1`. Four games hide the opponent segment (Big Two is always three
AI seats; Blackjack, Poker and Ball Party have no opponent to choose); three hide
the mood segment (Blackjack and Ball Party — Poker keeps it, because it sets how
loose Talia plays). That's the `hideMode` / `hideDiff` flag on the game object,
not something you can toggle.

For the desktop window: `ARCADE_PORT` (default 8788) and `ARCADE_DEBUG=1` for console
output. `~/.local/share/arcade/window.json` holds width, height, maximised and zoom; the
WebKit profile beside it is what makes the record survive a restart.

There is no theme switcher. The palette is 16 CSS custom properties in `:root` at the top
of `index.html` — twelve colours, three font stacks and a corner radius. Change `--accent`
and the rest of the set follows it.

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
        // ctx.record(res) / ctx.unrecord(res)  add or take back a record entry
        return { undo, hint };       // both optional
      }
    }

`ctx.alive()` matters: AI turns run after `await` delays, so check it before
touching the DOM or a queued move will paint into a game you already left.
`hideMode` / `hideDiff` drop the opponent and mood segments; Ball Party sets
both, and draws into a canvas instead of DOM squares.

## Known limits

- No online play, no accounts, no undo history beyond the current game.
- Threefold repetition is a draw in Chess, Checkers and Reversi; Chess also has
  stalemate, the fifty-move rule and dead positions. (Reversi ends when both sides
  are stuck.) There is no draw-by-agreement and no clocks anywhere.
- Chess covers the full rule set — castling, en passant, promotion, checkmate,
  stalemate, the fifty-move rule and dead positions — and threefold repetition.
  Its move generator is verified against perft:
  `ARCADE_PORT=8799 /usr/bin/python3 ctest.py`.
- Ball Party is keyboard-only (no gamepads) and its duels are deliberately
  short; `stest.py` drives all eight through the real WebView. Touch devices get a
  "needs a keyboard" badge on its hub card.
- `window.__nxChess`, `window.__nxParty` and `window.__nxPoker` are test hooks (perft +
  FEN loader, minigame state, and the hand evaluator plus a scripted hand) used by
  `ctest.py`, `stest.py` and `ptest.py`; nothing in the UI depends on them.
- The record is per browser profile. Clearing site data resets it.

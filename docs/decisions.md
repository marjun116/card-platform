# Decisions

Answers to spec ambiguities and design choices, newest last.

## 2026-10-06: Rules engine design (Phase 1)

Agreed before building `packages/engine`.

### Seats, dealer and turn order

- Players are identified by seat number, `0` to `n-1`. The server maps accounts to seats.
- Seat `i+1` sits to the left of seat `i`. "Clockwise" and "left" mean increasing seat
  numbers.
- The seeded RNG picks the first dealer. With `dealerRotation: "left"` the deal then moves to
  the next active player on the left each round.
- Cards are dealt one at a time, starting left of the dealer.

### Player actions versus engine effects

The spec's action library mixes moves a player chooses with things the engine does.

- **Player actions** (appear in `actions`): `play`, `playToTrick`, `draw`, `discard`, `pass`,
  `meld`, `layOff`, `pickUpPile`, `bid`, `passBid`, `declareTrump`.
- **Effects** (appear in `effects` and `afterTrick`): `set`, `choose`, `resolveTrick`,
  `moveTrick`, `nextPlayer`, `skip`, `reverse`, `winnerLeads`, `breakSuit`.

### Phases and turns

- `rounds: n`: the phase ends once every active player has taken `n` turns.
- `repeat: n` (trick phases): the phase ends after `n` tricks. Without `repeat`, it ends when
  the leader has no cards left.
- A phase is a trick phase if it contains a `playToTrick` action. A trick is complete once
  every active player has played to it.
- `until` is checked after every move.
- After the last phase the round is scored. If the end condition isn't met, a new round is
  dealt.
- A player with no legal move is skipped automatically. If every active player in a row has
  no legal move, the phase ends (for example: the stock and discard pile are exhausted).

### Multi-step turns

- `actions` describes a turn of exactly one move.
- `turn` lists ordered steps for longer turns, such as rummy:
  `[{ "actions": [draw…] }, { "actions": [meld…, layOff…], "optional": true, "repeatable": true }, { "actions": [discard…] }]`.
  An optional step can be skipped by making a move from a later step. A repeatable step can be
  taken again and again. If every remaining step is optional, the player may `endTurn`.
- `"then": "mayPlayDrawnCard"` on a draw creates a second step: the player may play the card
  they just drew (if a `play` action allows it) or end their turn.

### Expression language

- Literals: numbers, `'strings'` or `"strings"`, `true`, `false`, `null`, `[arrays]`.
- Operators: `!`, unary `-`, `* / %`, `+ -`, `< <= > >=`, `in`, `== !=`, `&&`, `||`, `? :`,
  parentheses, and `.` to read a property.
- Calls are only to the engine's fixed list of functions and methods. There's no assignment,
  no loops and no way to define functions. Expressions are limited in length and nesting.
- Comparing values of different types gives `false`. Arithmetic on non-numbers is an error.
  `&&`, `||`, `!` and `?:` need booleans; `null` counts as `false`.
- Reading a property of `null` gives `null`, so `discard.top.rank` is `null` when the pile is
  empty.
- `anyPlayer`, `everyPlayer`, `anyTeam` and `everyTeam` mean "true for at least one / for
  all". The whole expression is evaluated once per active (not eliminated) player, or once
  per team. Only one of them may
  appear in an expression.
- Custom values (`state.x`) start as `null` and are reset at the start of every round.
  Values that must last across rounds (such as bags) use scoring `track`.
- `trick` always means the current trick, or the one just finished until the next starts.
  So `afterTrick` effects can still read `trick.containsSuit('spades')` after the cards have
  been moved to the winner's pile.

### Spec syntax clean-ups

- `hand.allSpades` becomes `hand.onlySuit('spades')`.
- `setup.flip` can take its own `set`, for example
  `"set": { "state.activeSuit": "card.suit" }`. This fixes the Sevens Up example, where
  `state.activeSuit` was never set for the starting card.
- `set` has three forms: `"set": "state.x"` sets `true`; `"set": { "state.x": "expr" }` sets
  the expression's value; `"choose": "suit", "set": "state.x"` lets the acting player pick a
  suit and stores it.

### Hidden information

- `owner`: the owner sees the cards; everyone else sees only how many there are.
- `all`: everyone sees everything.
- `none`: nobody sees the cards; the count is shown only with `countVisible: true`.
- `topCardOnly`: everyone sees the top card and the count.
- `viewFor` also removes the RNG state (it would predict shuffles), cards being passed, and
  log entries that would reveal hidden cards.

### Blind bids (blind nil)

- If a game file mentions `player.hasLookedAtHand`, each player's own hand stays hidden from
  them until they make a `lookAtHand` move, which is allowed at any time.
- Making any move other than a bid counts as looking.

### Tricks, bids and scores

- The engine counts tricks won per player and per team, since nil needs per-player counts.
- `team.bid` is the sum of the partners' numeric bids; non-numeric bids such as `"nil"` count
  as 0.
- Scores belong to teams. A game without `meta.teams` gives each player their own team, so
  `player.score` and `team.score` are the same thing there.
- Scoring runs `perTeam` rules, then `perPlayer` rules, each list in file order. A rule sees
  values changed by earlier rules (for example bags).
- `track` adds to a named counter that lasts across rounds, such as `bags`.

### Game end

- The end condition is checked after each round's scoring and elimination.
- Ties: by default, if the winners would be tied, play continues with another round.
  `"ties": "share"` on `endCondition` lets tied players share the win instead.
- If elimination would knock out every remaining player at once, nobody is eliminated that
  round.

### Passing cards (hearts)

- Players pass one at a time in turn order. Passed cards are held out of sight until everyone
  has passed, then delivered together.

### Melds

- Sets (same rank) and runs (same suit, consecutive in `cardOrder.ranks`) with a minimum
  size. Wild cards in melds come later (Phase 5).

## 2026-10-06: Spades mercy rule

- Spades has a `mercyRule` option, **on by default**: the game ends when a team falls to
  -200 or below, and the team with the higher score wins. Table hosts can turn it off.
- End condition: `anyTeam.score >= options.targetScore || (options.mercyRule && anyTeam.score <= -200)`.
- Why: without it, a game with consistently bad bidding can go on forever, and the Phase 2
  random-play simulation needs every game to finish.

## 2026-10-06: Game file validation (Phase 2)

- `createGame` validates every game file before playing it (once per file object) and
  throws a `GameFileError` listing every problem. `validate(file)` can be called directly
  and also returns warnings (things that are probably mistakes but not fatal).
- Unknown keys are errors, so typos like `"visiblity"` are caught.
- Every game needs a per-player zone called `hand`: trick play, passing and "next player
  draws" all use it.
- These names can't be zone names because expressions already use them: `player`, `team`,
  `card`, `state`, `options`, `round`, `activePlayers`, `cardValue`, `sum`, `min`, `max`,
  `abs`, `anyPlayer`, `everyPlayer`, `anyTeam`, `everyTeam`.
- Every phase must be able to end: trick phases end by themselves; other phases need
  `rounds`, `until`, or a `whenEmpty` rule that ends the round.
- The starting card (`setup.flip.from`) must come from the undealt cards (`setup.rest`).
- `resolveTrick`, `moveTrick` and `winnerLeads` only work in `afterTrick`; `choose` only in
  an action's effects (where there is a player to choose).
- Expressions are checked for names that don't exist or aren't available in that place
  (for example `card` outside card actions, or `player` in the end condition), undeclared
  options, and misspelled suits and ranks.
- Hands start face down (for blind bids) only if a blind bid is possible: an expression that
  mentions `player.hasLookedAtHand` doesn't count when it also requires an option that is
  switched off. So spades with blind nil off (the default) deals hands face up.

## 2026-10-06: Running out of stock (rummy)

- Rummy-style games reshuffle the discard pile (all but its top card) into a new stock
  **as many times as needed by default**. The table host can set a limit when starting a
  game (option values: unlimited, 1, 2, 3). Once the limit is used up, the next time the
  stock runs out the round ends and hands are scored as usual. The count resets each round.
- Game file form: `"whenEmpty": { "stock": { "policy": "reshuffleDiscardExceptTop",
  "limit": "options.reshuffles" } }`. The limit may be a number or an expression;
  `"unlimited"` (or null) means no limit. The plain string `"reshuffleDiscardExceptTop"`
  still means "no limit".
- A pile running out never cuts a turn short: the round only ends at the start of the next
  player's turn (this applies to `"endRound"` too).
- Known gap: with unlimited reshuffles a hand can reach a stalemate nobody can win (every
  card that could be laid off is already melded). Real players would agree to stop; the
  engine currently stops any round after 10,000 moves with an error. Tables will need a
  "call it a draw" button (Phase 7's manual buttons). Simulations always set a limit.

## 2026-10-07: Multiplayer server (Phase 3)

Agreed before building `apps/server`.

### Accounts and guests

- Anyone can play built-in games, signed in or not. A first visit creates a **guest**: a user
  with a display name and no email, plus a session cookie. Guests can host and join tables of
  built-in games.
- Creating custom games (Phase 6) needs a **signed-in account** (a user with a verified
  email). Custom games can be shared with anyone, guests included.
- Sign-in is by **email magic link**, built in-house: single-use links that expire after
  15 minutes; only a hash of each token is stored. Emails are sent with Resend through plain
  `fetch`; in development and tests the link is printed to the console instead.
- Every sign-in method ends in the same httpOnly session cookie, so "Sign in with Google" can
  be added later without other changes.
- When a guest opens a magic link **in the same browser**, the guest becomes the account (or,
  if the email already has an account, the guest's seats and tables move to it). A link
  opened anywhere else just signs in, without touching any guest. Otherwise someone could
  request a link for another person's email while holding a guest session and end up signed
  in as them once that person clicks it.
- Known weak spot: a guest who clears cookies or changes device loses their identity and seat.
  The host can free a seat so the person can retake it; signing in avoids this.

### Tables

- A table's state is never stored. It is rebuilt with `replay()` from the pinned game version,
  options, player count, seed and move log, and kept in memory while the table is in use.
- Each table handles one message at a time. A move is saved before anyone is told about it;
  the move log's `(table, seq)` key rejects a second move with the same number.
- One server process for now (enough until Phase 8).
- Only seated players get game state. Others connected to a table see only the lobby (seats,
  options, status). No spectating until the engine has a spectator view.
- The client's `move.player` is ignored and replaced with the sender's seat.
- Clients send `seq` (moves seen so far) with a move; a stale `seq` is rejected, which stops
  double clicks and moves made against an out-of-date view.
- Host controls: start (all seats filled), pause/resume, end (table becomes `abandoned`, no
  result recorded), free a seat.
- The seed is never sent to clients.

### Turn nudges

- `TurnNotifier` is a hook; for now it only logs. Email or push delivery comes later.
- Manual: a seated player can nudge the player whose turn it is, at most once every 5 minutes
  per seat.
- Idle: a timer notifies a player whose turn has lasted longer than a limit (default 12 hours)
  while they have no connection open, once per turn.

### Tests

- Database access goes through a `Store` interface with a Prisma version and an in-memory
  version. The WebSocket and hidden-card tests use the in-memory store, so they run in CI
  without a database. The same store tests run against real Postgres when
  `TEST_DATABASE_URL` is set.

### Settled while building

- **Tables are identified by their invite code** (10 characters from 32 letters and digits,
  about 50 bits) in every URL and message. The database id is never shown. Having the code is
  what lets you see a table and take a seat.
- **Blind nil and legal moves.** A player who hasn't looked at a face-down hand isn't sent
  legal moves that name cards (that would show them their hand), and the server rejects card
  moves from them with "Look at your hand first". Otherwise they could find out what they
  hold by guessing card ids and watching which moves fail. They must send `lookAtHand` first.
  The hidden-card tests found this.
- **WebSocket origin check.** A WebSocket request whose `Origin` header isn't `PUBLIC_URL` is
  refused, so another website can't open a table connection with a visitor's cookie.
- **Presence.** The server pings each connection every 30 seconds and drops ones that stop
  answering, so "connected" in the lobby stays accurate.
- **Messages** from clients are limited to 16 KB.

## 2026-10-07: Server hardening before the first push

- **Shutdown:** Ctrl+C or the host stopping the server closes every WebSocket, then the
  database connection, then exits.
- **Connections that close while being set up** are removed from the table straight away
  (before this, they stayed listed as "connected" forever).
- **Rate limit per WebSocket:** a burst of 40 messages, refilled at 20 a second. Extra
  messages get a `RATE_LIMITED` error carrying the message's id, so the client always gets an
  answer; the connection stays open. Tests use a much higher limit (bots move far faster
  than people), except the test of the limit itself. At most 50 messages are
  held while a connection is being set up; more than that closes it.
- **Logs** never contain sign-in tokens (they're replaced with `[redacted]` in logged URLs).
- **Unexpected server errors** are logged in full, but clients only see "Something went
  wrong on the server".
- **Expired sessions and sign-in links** (and used links) are deleted from the database
  every 10 minutes.
- **Left for Phase 8** (security review and rate limits): limits on how often one person can
  create guests, tables and sign-in emails to many different addresses; and closing a
  user's open WebSockets when they sign out.
- **Test tables use fixed seeds** (`test-table-1`, `test-table-2`, ...) instead of random ones,
  so every test run deals the same cards and a failure can be replayed exactly.

## 2026-10-07: Web client (Phase 4)

Agreed before building `apps/web`.

### The table view is generic

- Nothing in the web app knows which game is being played. Zones are placed by their settings
  in the game file and what the player's view contains:
  - your own per-player zones (your hand) along the bottom, face up;
  - other players' per-player zones at their seats, as counts (or melds, if visible);
  - shared zones in the middle: the current trick arranged by who played each card, piles as
    stacks showing their count and, for `topCardOnly`, the top card;
  - per-team zones (won tricks) as counts in the scoreboard.
- Seats are drawn relative to the viewer: you are always at the bottom, the others clockwise
  from your left.
- Controls come only from the legal moves the server sends. Moves with one card are made by
  clicking that card; moves with several cards (pass, meld) by selecting cards and confirming,
  allowed only when the selection matches a legal move; moves from a pile by clicking the
  pile; everything else (bid, pass bid, trump, suit choice, look at hand, end turn) as
  buttons.

### Round history in the engine

- The engine keeps `history`: for each finished round, every team's points that round, total
  score, tricks and counters (bags), and every player's bid, tricks and whether they were
  knocked out. It's public information, so `viewFor` sends it to every player. The round
  summary and game-over screens are built from it.

### Dependencies

- `react-router` for page URLs (invite links open `/t/<code>` directly).
- `@testing-library/react` and `jsdom` (development only) for component tests.
- The web app imports the server's protocol types from `@card-table/server/protocol`
  (types only; nothing from the server ends up in the browser bundle).

### Cards

- Card faces are Dmitry Fomin's English pattern set from Wikimedia Commons, CC0 (public
  domain). Credit is on the About page and in `apps/web/public/cards/CREDITS.txt`. The card
  back and jokers are drawn by us (the set has neither).
- Suits are red and black, as on real cards (a four-colour option was tried and removed;
  see "First playtest feedback" below). Suits also differ by shape, and every card has a
  spoken label, so colour is never the only way to tell them apart.

### Settled while building

- **Selecting before playing.** The first tap on a card selects it; tapping it again plays it,
  but only when that's the only thing the card can do. Otherwise the possible moves appear as
  buttons. This stops a stray tap on a phone from playing a card.
- **Unusable cards are greyed only when some card can be used**, so the hand isn't greyed out
  while bidding.
- **Hands are sorted** by suit (spades, hearts, clubs, diamonds, so the colours alternate),
  then from 2 up to ace. It's only a display order; the game's own rank order isn't sent to
  the client.
- **The engine says which zones hold tricks.** Each view lists `trickZones` (the zones any
  `playToTrick` action plays into) and each trick says which zone it's in, so the table never
  draws a trick zone as an ordinary pile, even before the first trick.
- **Face-down hands** (blind nil): your own cards show as backs with "Your cards are face
  down", and the "Look at your cards" move appears as a button like any other.
- **Round summary**: a dialog opens whenever a new entry appears in the round history; the
  "Every round" button shows them all. When the game ends, the game-over screen replaces the
  table.
- **Phone layout** (narrower than 700px): the other players become a strip across the top,
  scores and log fold away behind a "Scores" button, and your hand and buttons stay pinned to
  the bottom of the screen. The hand overlaps more as it grows so 13 cards fit at phone width;
  past that it scrolls sideways.
- **The table screen fits the window** (2026-10-14, after a euchre playtest where the hand and
  Play button were below the fold on a laptop). On every screen size the game page is exactly
  one window tall: the table shrinks to whatever room is left after the header and your
  hand, and the scores and log scroll beside it. Your hand and buttons are always on screen.
  Only a window too short for the table's minimum height (300px, 380px from 7 players)
  scrolls, and then your hand stays pinned to the bottom. On short laptop windows (under
  760px tall) the cards in your hand are a little smaller.
- **The game's values have a fixed place** (2026-10-15, after a euchre playtest where trump
  and "Called by" jumped as cards were played). Values a game shows on the table sit in the
  bottom-left of the table, in three rows filled top to bottom (then a new column), so a
  value that comes and goes never moves the others; the "Last trick" button is bottom-right.
  In trick games that button is always there, greyed out while there's nothing else to show
  (before the first trick ends, and while a finished trick is still on the table), so it
  doesn't pop in and out every trick.
  On phones they sit just under the other players.
- **The dealer's seat is outlined in light blue** (2026-10-15, after a playtest), with
  "Dealer" in the same colour among the seat's details. It's an outline, not the border, so
  it shows alongside the yellow border of whoever's turn it is. When you're the dealer, the
  line under the table says "You're the dealer."
- **Looking at the table before moving on** (2026-10-15, after a playtest). The round scores
  pop-up has "Hide to see the table", which leaves "Round 2 is over." with Show scores and
  Continue under the table; Continue counts as closing the scores. A game that ends while
  you're playing stays on the table ("The game is over." with See results) until you ask
  for the results; a table that was already over when you opened it goes straight to them,
  and so does one the host ended early.
- **The card winning the trick is outlined** (2026-10-15, picked by Arjun from four options).
  Each trick in the view has `leading`: who would take it if it ended now, by the same
  `resolveTrick` rule that will decide it (the winner once it's decided). It's left out
  (null) when some of the trick's cards are hidden from that player, so it never gives
  anything away. The table outlines that card in yellow, as it does the winning card of a
  finished trick, and says "Ana is winning" under the trick until it becomes "Ana wins the
  trick". Your hand isn't marked: no hints about which of your cards would win.

## 2026-10-07: Tables with more than 4 players

- Games can have up to 10 players (engine, server and web all allow it); built-in and custom
  games alike.
- **The trick** is a ring of cards, each on the side of the player who played it. The ring
  grows until no two cards overlap (`trickLayout` in `apps/web/src/table/zones.ts`), and uses
  smaller cards from 5 players up.
- **Seats**: from 7 players the seat panels are smaller and the table taller. Piles at a seat
  that can only be counted (like another player's won tricks) are a line of text, not a
  picture. "Nudge" sits next to the player's name, so a panel doesn't grow on their turn.
- **Phones, up to 4 players**: the other players share a strip across the top.
- **Phones, 5 or more players**: every player is a small two-line "chip" placed around the
  table, as on wide screens, so everyone is on screen at once. Line one is the name (cut short
  if needed) and cards in hand; line two is the bid and tricks won (for example "B3 · W1"),
  showing only what the game has. Tapping a chip opens that player's full panel (full name,
  dealer, piles, Nudge). The trick ring is taller and narrower there, so the chips at the
  sides have room.
- **Scoreboard**: one-player teams take one line each (name, score, bid and tricks).

## 2026-10-07: First playtest feedback

- **Red and black only.** The four-colour suits option (diamonds blue, clubs green) is gone,
  along with its recoloured card files and the header checkbox. Suits still differ by shape,
  as on a real deck.
- **Card corners use the artwork's own index.** Our drawn rank-and-suit box on top of each
  card looked odd and was only there for the four colours. Only tiny cards (other players'
  piles), where the artwork can't be read, show a drawn rank and suit, filling the card.
- **Decisions go in the middle of the table.** Moves that don't use a card from your hand
  (bids, suit or trump choices, drawing from a pile, pass, look at your cards, end turn) are
  buttons in a panel in the centre of the table, where players are already looking. Buttons
  for selected cards stay under the hand. The line above the hand says what to do, for
  example "Your turn: choose your bid." Before this, the bid buttons were below the hand and
  needed scrolling on a laptop.

## 2026-10-07: Rulebook (planned for Phase 5)

Agreed now, built later (see the Phase 5 checklist):

- Each game gets a rulebook that can be opened at any time: a **Rules** button on the table
  (opening over the game, without interrupting it) and in the lobby, and a Rules link on the
  Games page.
- It has two parts: written rules (for built-in games, drafted and then reviewed before they
  go in) and an "At this table" section generated from the table's settings, so the house
  rules shown always match the game being played.
- Built-in rules live in a rules file next to each game file in `packages/games` and aren't
  stored per game version (no database change). An old table could show newer rules if a
  game changes; accepted for now.
- Rules use a small formatting subset (headings, paragraphs, bullet lists, bold) shown by our
  own small renderer: no new dependency and no raw HTML, because custom-game rules will be
  AI-written.
- Custom games (Phase 6): the AI's plain-English summary becomes the rulebook, saved with
  each game version and shown in the same viewer.

## 2026-10-07: One header, phone menus, no jumping

- **One header during a game.** The table's bar (game, round, phase, buttons) moved into the
  site header, saving a row. While a game is on screen, the header's Home, Games and About
  links and Sign out step aside ("Card Table" still links home); they're on every other page.
  Pages fill the header through a slot (`apps/web/src/headerSlot.ts`).
- **Phone menus.** On phones the game header is one line: name, round ("R3"), phase, a
  **Scores** button and a **⋯** menu with the occasional actions: Pause/Resume and End game
  (host only), and Every round. On other pages the phone header is "Card Table" and a
  **☰ Menu** with Home, Games, About, who is signed in and Sign out. Wide screens keep
  everything visible. The menus are our own (`components/Menu.tsx`): arrow keys, Esc, and
  tapping outside all work.
- **Nothing jumps when selecting cards.** The row under the hand (buttons for selected
  cards, hints such as "Choose 3 cards to pass") always keeps one row's height, even when
  empty, so selecting or clearing never changes the page height; its contents fade in.
  After "Clear selection", keyboard focus goes back to the card that was selected.
- **The trick sits a little below the middle of the table** (the bottom, where your seat
  would be, is empty), and on short laptop screens (under 760px tall) its cards are drawn at
  62px, so it stays clear of the players at the top.


## 2026-10-07: Guests can't sign out

- A guest has no email address, so signing out would lose their seats and tables for good.
  Guests see **Sign in** instead of Sign out. The sign-in page then offers only the email
  link, and opening it in the same browser turns the guest into an account, keeping their
  name, seats and tables. Signed-in accounts keep Sign out.
- House-rule values in the lobby read "On" and "Off".

## 2026-10-07: `pnpm dev` on Windows

- `pnpm dev` runs `dev.ts` (Node runs TypeScript directly since version 23.6), which starts
  the server (`tsx watch`) and the website (`vite`) with Node itself and labels their output.
- Why: pnpm runs package scripts through Command Prompt on Windows, and `tsx` and `vite`
  start through `.cmd` files. On Ctrl+C, pnpm exited first while those batch files were still
  asking "Terminate batch job (Y/N)?" in the same terminal, and answering could close it.
  With no batch files involved, Ctrl+C stops both apps (each shuts down cleanly) and exits
  without errors.
- Running one app on its own (`pnpm --filter @card-table/server dev`) still uses pnpm's
  script runner and may still ask that question; answering either way is harmless there.
- 2026-10-15: on Arjun's machine `pnpm` itself is a batch file underneath: nvm's
  `pnpm.exe` launcher runs `cmd.exe /c pnpm.cmd`, which runs corepack. So `pnpm dev` still
  asked "Terminate batch job (Y/N)?" after Ctrl+C, fighting PowerShell for input. Nothing in
  the repo can change that; `node dev.ts` (no pnpm) avoids it, and the README says so.


## 2026-10-08: House rules for every built-in game (Phase 5)

- Every built-in game includes its **common house rules and variants as options** chosen when
  a table is created. Every option **defaults to the standard game**, so a table that changes
  nothing plays the base rules.

## 2026-10-08: Hearts

- **Players:** 3, 4 or 5. With 3 players the 2♦ is removed (17 cards each); with 5 the 2♦
  and 2♠ (10 each). Six players is left out for now: sources disagree on which four cards
  to remove.
- **Standard rules:** pass 3 cards (left, right, across, hold; with 3 or 5 players: left,
  right, hold). The 2♣ leads the first trick. No hearts or Q♠ on the first trick unless your
  hand holds nothing else. Hearts can't be led until broken (unless you hold only hearts);
  the Q♠ doesn't break hearts. Hearts 1 point each, Q♠ 13. Taking all 26 is shooting the
  moon: 0 for the shooter, 26 for everyone else. Play to 100; lowest score wins; a tie for
  lowest plays another hand.
- **House rules (options):** play to 50/75/100/150; moon scoring (others +26, shooter −26,
  or the shooter chooses); J♦ worth −10; points allowed on the first trick; Q♠ breaks
  hearts; hearts may be led any time; passing pattern (standard, no hold round, always
  left, no passing); first lead by the player left of the dealer (any card); tied players
  share the win.
- With the J♦ rule, shooting the moon still means taking all 26 heart and Q♠ points; the
  J♦'s −10 is scored separately.
- **Left out for now:** landing on exactly 100 resets your score; partnership hearts;
  shooting the sun; Black Maria.

## 2026-10-08: Building blocks added for hearts

General parts of the game format, added because hearts needed them; none mention hearts.

- **Play restrictions** (`restrictions` on `playToTrick`): a list of
  `{ "if", "mustPlay" | "cannotPlay" }`, checked in order after following suit. Each keeps
  (or removes) the cards its expression matches, but is skipped if that would leave nothing
  to play. So "can't lead hearts unless you only have hearts" is just `cannotPlay` hearts.
  Spades still uses the older `leadRestriction`, which works the same way for leads.
- **Card codes**: a card is written as rank + suit letter, `"QS"`, `"10H"`, `"2C"` (every
  copy in multi-deck games). Used by `card.code`, `pile.hasCard('QS')`, `holderOf('2C')` (the
  seat whose hand holds it, or null), `deck.remove` and `cardValue` keys.
- **`cardValue` keys** can be a card (`"QS"`), rank (`"Q"`), suit (`"hearts"`), `JOKER` or
  `default`; the most specific entry wins, in that order.
- **`deck.remove`**: `[{ "if": "activePlayers.count == 3", "cards": ["2D"] }]` takes cards out
  (every copy) when the condition holds; no `if` means always.
- **`trick.number`**: 1 for the first trick of the phase, 2 for the second, and so on.
- **Settings house rules can change**: pass `direction`, `leader.first` and
  `endCondition.ties` take their usual fixed values or an expression giving one, e.g.
  `"direction": "options.passing"`. `leader.first` may also give a seat number
  (`holderOf('2C')`); null means left of the dealer.
- **`rotateNoHold`** pass direction: left, right, across (four players) or left, right.
- **`choose` action**: `{ "type": "choose", "values": [...], "labels": {...}, "set":
  "state.x" }` lets a player pick one named choice; the pick is stored in `state.x`. The web
  app shows choices as buttons in the middle of the table, using the labels, which reach the
  client as `view.choiceLabels`. Euchre's "go alone" can use this too.
- **Option `labels`**: words for option values, shown when creating a table and in the
  lobby, e.g. `"rotate": "Left, right, across, hold"`.
- **Simulation**: built-in games can list house-rule sets in `simulation.test.ts`
  (`VARIANTS`); each set plays 200 extra random games, so options are tested too.

## 2026-10-08: Crazy eights

- **Players:** 2 to 10. One deck, except two decks for 8 or more players, or when the hands
  dealt would leave too small a stock (players × cards dealt over 40, e.g. 8 cards each for
  6 players).
- **Standard rules (Hoyle):** 7 cards each for two players, 5 for more. A starting 8 is put
  back in the stock and another card turned. Match the top card's suit or rank; 8s are wild
  and the player names the suit (not when it's their last card). If you can't play, draw
  until you can; you may also draw when you could play. No reshuffle: with the stock empty,
  a player who can't play passes. The first player out scores the cards left in other hands
  (8 = 50, K/Q/J = 10, A = 1, others face value). A blocked hand is won by the lowest hand,
  which scores the difference to each other hand; players tied for lowest both score. First
  to 100 wins.
- **House rules (options):** play to 100/200/500 or one hand; penalty scoring (everyone
  scores their own cards, lowest wins); drawing (draw one and play it if you can, or draw up
  to 3 then pass); reshuffle the discard pile; cards dealt (7 or 8 each); a starting 8
  counts as a normal card; 2s make the next player draw 2 and miss a turn; stacking 2s;
  jacks skip; aces reverse (a skip with two players); queen of spades makes the next player
  draw 5 and miss a turn.
- **Left out:** calling "last card" (table talk).

## 2026-10-08: Building blocks added for crazy eights

General parts of the game format, added because crazy eights needed them.

- **`deck.copies`** can be an expression, e.g. `"activePlayers.count >= 8 ? 2 : 1"`.
- **`setup.flip.reflipIf`**: while the turned card matches, it's put back in the stock at a
  random spot below the top (seeded) and the next card is turned. If every card would be put
  back, the last one turned stays.
- **`scoring.playerValues`**: named values worked out per player, used as functions:
  `{ "handValue": "sum(player.hand, cardValue)" }` gives `handValue(player)`. `sum`, `min`
  and `max` also accept `activePlayers`, e.g. `sum(activePlayers, handValue)`. A player value
  can't use another one (it could go round in circles).
- **Draw counts** (`draw.count`, `nextPlayer.draw`) can be expressions, e.g. `"state.penalty"`.
- **`turn.draws`**: cards the current player has drawn this turn.
- **`whenEmpty` rules take an `if`**, so a house rule can switch reshuffling on. A reshuffle
  rule with no `limit` never ends the round (the player just can't draw once both piles are
  used up); with a `limit`, the round ends once it's used up, as before.
- **`endCondition.winner`** can be an expression, like `ties`.
- **Expressions:** comparing `null` with `<`, `>` and so on is an error, so a custom value that
  may not be set yet needs a starting value (`setup.flip.set` here sets `state.penalty` to 0).

## 2026-10-08: Rummy and gin rummy

Two separate built-in games. Rummy 500 (scoring melds, taking deeper into the discard pile)
would be a third game, later.

### Rummy

- **Defaults follow the 13-card ("Indian") style the family plays**, with Hoyle's basic rummy
  reachable through house rules: 2 to 6 players, 13 cards each, decks added as needed (one deck
  while players × cards dealt is 38 or less, leaving a stock of about 14; two beyond that).
- **Jokers:** two printed jokers per deck, plus a **cut joker**: after the deal a card is
  turned face up and every card of its rank is wild (if it's a printed joker, aces are wild).
  The cut card stays out of play. A wild card stands in for any card in a meld.
- **Pure run:** a run with no wild card standing in for another card. A player needs one
  before laying down any meld that uses a wild card, and to go out. A loser with no pure run
  counts every card in their hand.
- **Melds** are laid down as you go (Hoyle); a house rule keeps them in hand until a player
  goes out by showing their whole hand arranged into melds (discarding their last card).
- **Scoring:** the player who goes out scores the unconnected cards (deadwood) left in the
  other hands, counted the way that leaves the fewest points: face cards 10, aces 1, others
  their number, printed jokers 0. First to 100.
- **House rules:** play to 100/150/250/500; penalty scoring (lowest wins); aces high, or high
  or low (not K-A-2); must discard to go out; "going rummy" doubles the score (on by default);
  throwing back the card just taken from the discard pile (not allowed by default); empty
  stock (reuse the discard pile by default, reuse it once, or end the hand); melds kept in hand;
  cards dealt (13, 10, or Hoyle's 10/7/6 by player count); jokers (printed + cut, printed
  only, none); the pure-run rule (on by default).
- **Left out:** a minimum value for a player's first meld.

### Gin rummy

- **Hoyle:** 2 players, 10 cards each, aces low. First turn: non-dealer, then dealer, may take
  the upcard; if both pass, the non-dealer draws from the stock. Knock with 10 or less
  deadwood after discarding; the opponent lays off onto the knocker's melds (not after gin).
  Knock: difference in deadwood; undercut: difference + 25 to the opponent; gin: opponent's
  deadwood + 25. A hand with 2 cards left in the stock and no knock is a draw. Game to 100,
  then +100 game bonus, +25 per hand won (box), and the winner's score doubled on a shutout.
- **House rules:** play to 100/150/250; gin bonus (20/25/50); undercut bonus (10/20/25); big
  gin (all 11 cards melded, bonus 31 or 50); Oklahoma gin (the upcard sets the knock limit,
  an ace means gin only, a spade upcard doubles the hand); box and game bonuses (on by
  default); aces high or low.

### Players arrange their own hands

- In rummy-family games each player groups the cards in their hand themselves, at any time
  (it doesn't use a turn and works when it's not their turn). Groups are private. New cards
  arrive ungrouped. The engine only checks groups: is each one a valid set or run (and is
  there a pure run if one is needed)? Cards outside valid groups are deadwood.
- Rummy losers get a last turn to fix their groups and confirm ("Show my hand") before the
  hand is scored. Gin's knocker chooses their own melds by how they've grouped them.
- Because there are far too many ways to group a hand to list, an arrangement isn't one of the
  legal moves; the engine checks it when it arrives. The server doesn't apply the stale-move
  check to arrangements (they only touch the player's own groups).
- **"Sort into melds"** arranges the hand for you, using the engine's best-arrangement search
  (the least deadwood, with wild cards and the pure-run rule). It is a legal move like any
  other, and a house rule can switch it off. Bots and simulations use the same search, but
  only when they need it, never to work out legal moves.

### A pile running out for good ends the phase, not the whole round

- When a `whenEmpty` rule says a pile running out ends things (`"endRound"`, or a reshuffle
  limit used up), the current phase now ends; any later phases still happen before the round
  is scored. Games with one phase behave exactly as before. Rummy needs this: when the stock
  runs out, players still get to show their hands.

## 2026-10-08: Building blocks added for rummy and gin

General parts of the game format, added because rummy and gin needed them.

- **`meldRules`** (top level): `kinds`, `minSize`, `aces` ("low", "high" or "both"; a setting
  house rules can change), `pureRunRequired`, `autoArrange` (the "Sort into melds" move) and
  the per-player meld `zone`. With meld rules, players arrange their hands (see above), meld
  moves are their valid groups, and lay-offs follow the same rules.
- **`cardOrder.wild`**: which cards are wild in melds, e.g.
  `"card.isJoker || card.rank == state.cutRank"`. A card of a wild rank in its natural place
  counts as itself, so 4♥ 5♥ 6♥ is still a pure run when fives are wild. Sets hold at most one
  card of each suit (so two decks can't make a set of two 7♥s); runs go up to 13 cards and
  never round the corner (K-A-2).
- **Meld conditions** can read the group being melded: `meld.kind`, `meld.size`,
  `meld.isPure`, `meld.usesWild`. Players have `player.deadwood` (points outside valid groups,
  or every card if a needed pure run is missing) and `player.hasPureRun` (on the table).
- **`showHand` action**: go out by discarding one card when every other card is in a valid
  group. **`layOutMelds` effect**: move a player's valid groups onto the table.
- **Per-player custom values**: `"set": { "player.x": … }`, read as `player.x`, reset every
  round and never sent to anyone. Rummy remembers the card a player just took from the
  discard pile this way (in `state.x` everyone would see which card it is).
- **`set` can store `null`**, to clear a value.
- **Draw effects see the card drawn** as `card`, when one card is drawn.
- **`setup.flip`** can be a list, each with an optional `if` (rummy turns the upcard, then the
  cut joker).
- **`deck.jokers`** can be an expression.
- **`scoring.atGameEnd`**: rules run once when the game ends, before the winner is decided
  (gin's bonuses). If a tie means play goes on after all, they're undone.
- **A turn with nothing left to do ends by itself**: when ending the turn is the only legal
  move (say an optional knock that isn't possible), the engine ends it, counting it as a pass.
- **Legal moves are remembered per game state** handed back by `createGame`/`applyMove`
  (those are never changed), so asking several times costs nothing. Simulations of rummy
  and gin were otherwise too slow.
- **Simulating rummy and gin**: purely random players never arrange their hands, so nobody
  would go out. Their random games use random legal moves, except that they meld, lay off or
  go out whenever they can and arrange their hand after each draw.

## 2026-10-08: Euchre

- **Standard rules:** 4 players in partnerships, 24 cards (9 to A), 5 each, the rest is the
  kitty with its top card turned up. Trump order: right bower (jack of trump), left bower (the
  other jack of the same colour, which counts as a trump), A, K, Q, 10, 9. First round: order
  up the upcard (the dealer takes it and discards) or pass; second round: name another suit
  or pass; all pass twice: the hand is thrown in. The maker may go alone (partner sits out).
  Makers 3–4 tricks: 1; all 5: 2; alone and all 5: 4; euchred: 2 to the defenders. Game to 10.
- **House rules (options):** play to 5/7/10/11; stick the dealer (off by default: the dealer
  must name trump in the second round); euchring a loner scores 4; defending alone; partner
  ordering up the dealer must go alone ("Canadian loner"); a lone march scores 5.
- **Left out:** the Joker ("Benny"), the 32-card deck, 2- and 3-player versions, and
  redealing weak hands.

## 2026-10-08: Building blocks added for euchre

- **`cardOrder.bowers`**: the jack of trump ranks highest and the other jack of the same
  colour second; that jack counts as trump everywhere a suit matters (following suit, the led
  suit, `trick.ledSuit`, the trick's winner). `card.suit` in expressions is still the suit
  printed on the card. Five Hundred, Bid Euchre and Pepper use the same rule.
- **A `declareTrump` action's `if` can read `suit`**, the suit being considered, so the second
  round can offer "any suit but the one turned down": `"suit != upcard.top.suit"`.
- **`sitOut` effect**: `{ "sitOut": "(player.id + 2) % 4" }` takes that seat out of play until
  the round ends (a lone player's partner). It takes no turns, tricks complete with one card
  fewer, and the lead passes it by; its team still scores and it's back next round. The view
  shows `sittingOut` per player, and the table shows "Sitting out" on that seat.
- Euchre's dealer exchange is an ordinary phase (`"order": "dealer"`) whose actions are only
  for the dealer; when the dealer sits out (their partner went alone, or defends alone), nobody
  takes the upcard.

## 2026-10-08: Oh Hell

- **Standard rules:** 3 to 7 players, each alone. Hands go up then down: 1 card each, then 2,
  … up to 10 (lower with more players, so one card is left to turn up), then back down to 1.
  The card after the deal is turned up for trump; with none left, the hand has no trump. Bids
  from the left of the dealer, 0 up to the cards held; the hook: the dealer may not make the
  bids add up to the number of tricks. Exact bid: 10 + bid; otherwise 0. Highest total after
  the last hand wins; ties share.
- **House rules (options):** hand sequence (up then down, down then up, up only, down only);
  most cards in a hand (10, 7, 13, or as many as the deck allows); the hook (on by default);
  scoring (1 per trick + 10 when exact, or −1 per trick off); blind bids (bid before looking,
  double if made); the top hand played with no trump.
- **Left out:** secret bids revealed together (not turn-based) and team versions.

## 2026-10-08: Building block added for Oh Hell

- **A `bid` action's `if` can read `bid`**, the value being considered (like `suit` for
  `declareTrump`), so bids can depend on the hand and the table: Oh Hell offers
  `"bid <= hand.count"`, and the hook stops the dealer making the total equal the tricks.
- Oh Hell's changing hand sizes need no new block: the deal count and the number of hands are
  expressions of `round`, the player count and the options (integer division is written with
  `%`, as `(51 - 51 % n) / n`).

## 2026-10-08: Cribbage

- **Standard rules:** 2 players (3 alone, or 4 as two partnerships also allowed). 6 cards each
  for two players, 5 for three or four. Each player puts cards in the dealer's crib until
  they hold 4 (with three players, one card from the deck goes in too). The dealer turns up
  the starter; a jack pegs 2 for the dealer (his heels). In the play, the count can't pass
  31: fifteen 2, 31 2, pairs 2/6/12, runs 1 per card (any order), go 1, last card 1. The
  show: the pone's hand, then the dealer's, then the crib, each with the starter: fifteens 2,
  pairs 2, runs 1 per card (double runs count twice), flush 4 (5 with the starter; the crib
  only with all 5), nobs 1. First to 121, the moment it happens, even mid-hand.
- **Counting is automatic**, but each player presses "Count my hand" (and the dealer turns
  over the crib) so the order is visible and everyone sees each hand. Muggins is left out.
- **"Go" is automatic:** a player who can't play is passed over. After each card, if nobody
  can play, the player who played it scores the go (or 2 for 31) and the count starts
  again with the next player.
- **Skunks** (loser under 91, double under 61; under 31 when playing to 61) are shown with
  the result, not counted as extra wins.
- **House rules (options):** play to 121 or 61; five-card cribbage (two players: 5 cards each,
  keep 3, the pone pegs 3 each hand); a four-card crib flush counts; a hand flush needs the
  starter too; his heels (on by default).
- **Left out:** muggins, lowball (first to 121 loses), and the six-player game.

## 2026-10-08: Building blocks added for cribbage

General parts of the game format, added because cribbage needed them; none mention it.

- **`score` effect**: `{ "score": <expr>, "label": "Fifteen" }` adds points to the acting
  player's team at once (only in an action's effects). Each score is kept in
  `scoreEvents` (public, in the view) and shown in the game log: "Raj: Fifteen for 2". A
  score of 0 is skipped. The round summary now counts points from the round's start, so
  points scored during the round are included.
- **`endCondition.immediate`**: the end condition is also checked after every `score`; when
  it holds the game ends at once, the rest of the effects and the round are skipped, and the
  round is recorded as it stands.
- **`endCondition.notes`**: `[{ "if": …, "text": "Skunk!" }]`, evaluated when the game ends,
  shown under the result (`view.notes`).
- **`display`** (top level): `[{ "label": "Count", "value": "state.total", "if": … }]`, values
  shown in the middle of the table (skipped while null). Every player sees them, so they may
  only use `state`, `options` and `round` (never a pile, which could hold hidden cards).
- **`returnCards` effect**: `{ "returnCards": "pegging", "to": "played" }` gives each card in a
  shared pile back to the player who played it. The engine remembers who played each card
  this round (never sent to players).
- **Pattern counting**: `countSums(15, a, b…)` (different groups adding up to 15, by
  `cardValue`), `countPairs(a, b…)`, `runCards(a, b…)` (cards in runs of 3+, each different
  run counted: 3-3-4-5 gives 6), all taking piles or card lists. Piles also have
  `sameRankAtEnd` and `runAtEnd` (the top cards, in any order). `hasCard('J', suit)` takes a
  rank and a suit as well as a card code.
- **Teams by player count**: `"teams": { "4": [[0, 2], [1, 3]] }`; other counts play alone.
  The game list says "2–4 players, partners with 4".
- **`draw` can go to a shared zone** (turning up a starter card).
- **Shared face-up piles are spread out** on the table, so every card in them can be seen.
- **Validator warning for `!anyPlayer…`**: `anyPlayer`/`everyPlayer` apply to the whole
  expression, so `!anyPlayer.hasLegalPlay` means "some player can't play", not "nobody can".
  The validator now warns and suggests `everyPlayer.hasLegalPlay == false`. (Cribbage's
  first draft made exactly this mistake.)

## 2026-10-08: Pinochle

- **Standard rules:** four-handed partnership auction pinochle. 48 cards (two copies of 9 to
  A), 12 each; rank A, 10, K, Q, J, 9. Bids go up from 20; passing takes you out of the
  auction; if the first three pass, the dealer must bid. The high bidder names trump. Meld:
  run 15 (double 150), royal marriage 4, marriage 2, dix 1, aces/kings/queens/jacks around
  10/8/6/4 (doubled 100/80/60/40), pinochle 4 (double 30); a run's K-Q isn't also a royal
  marriage. Play: follow suit; if you can't, trump; beat the trick when you can (including
  overtrumping); the first of two identical cards wins. Aces, tens and kings are 1 point,
  the last trick 1. Meld counts only for a team that takes a trick. The bidding team scores
  meld + points if that reaches the bid, otherwise loses the bid; the other team scores its
  meld + points. First to 150; when both pass 150 in the same hand, the bidding team wins.
- **Passing is on by default:** the bidder's partner passes 4 cards to the bidder, who
  passes 4 back (two separate phases, so the bidder sees the cards first).
- **Scoring:** simple 1-point counters by default; classic scoring (A 11, 10 10, K 4, Q 3,
  J 2, last trick 10; meld, bids and the target ×10, bids in tens) is a house rule.
- **House rules (options):** passing (on); classic scoring; play to 150/100/200; lowest bid
  20/25/50; the dealer must bid (on; off means a redeal when everyone passes); the bidder
  may throw in the hand before play, losing only the bid; must beat the trick (on).
- **Meld is counted by the engine** when each player presses "Show my meld"; the log lists
  each meld. The cards themselves aren't shown on the table (that needs a "show these cards
  for a while" block; left for after the playtest).
- **Left out:** three-handed and double-deck pinochle (different enough to be games of
  their own).
- **Simulation:** random bids are mostly far too high, so every hand is set and games never
  end. Random players pass or make the lowest bid on offer, and rarely throw in a hand.

## 2026-10-08: Building blocks added for pinochle

- **`trick.isBeatenBy(card)`**: would this card take the trick so far (trump beats other
  suits; of two identical cards the first played wins)? With play restrictions it gives
  "must beat the trick" and "must overtrump": `{ "mustPlay": "trick.isBeatenBy(card)" }`.
- **`countCard`**: `hand.countCard('QS')` or `hand.countCard('A', state.trump)` counts copies
  (multi-deck games); with `min([...])` it counts doubled melds.
- **Held points**: `{ "score": 10, "label": "Aces around", "into": "meld" }` notes the points in
  the log ("Ana: Aces around for 10 (meld)") and adds them to a team counter `team.meld`
  instead of the score. Held points show on the scoreboard and in the round summary, and
  are cleared every round; the round's scoring decides whether they count.
- **`endCondition.priority`**: a team condition; teams meeting it win ahead of the others
  (pinochle's bidding team when both teams pass the target).
- **Web: wide bid ranges.** With more than 14 numeric bids, the lowest 6 are buttons and the
  rest are in a list with a Bid button; named bids (nil) stay buttons. Spades and Oh Hell
  are unchanged.
- **Faster bid lists**: bids and suits are checked against one scope per player instead of
  building one per value; pinochle's simulation went from 374 to 132 ms a game.
- Test helper: card specs can name a deck copy, e.g. `"AS.1"`.

## 2026-10-08: Canasta

- **Standard rules (classic):** two decks with four jokers (108 cards); jokers and 2s are
  wild. 4 players in partnerships (11 cards each), or 3 (13 each) or 2 (15 each, draw 2,
  two canastas to go out) playing alone. Red 3s are laid down at once and replaced: 100
  each, 800 for all four, counted against a team that never melds. Draw 1 or take the whole
  discard pile by melding its top card; meld sets of 3+ (at least 2 natural cards, at most
  3 wild); discard. A team's first melds must reach 50 (15 below 0, 90 from 1,500, 120
  from 3,000); the pile's top card counts, other pile cards don't. The pile is frozen for a
  team that hasn't melded, and for everyone once a wild card is discarded (thawed when
  taken): then taking it needs two natural cards matching the top card. A wild card or
  black 3 on top stops anyone taking it. Canastas (7+ cards): natural 500, mixed 300. Going
  out needs a canasta: 100, or 200 concealed (melding the whole hand in one turn); a
  concealed go-out needn't meet the first-meld minimum. Black 3s can only be melded when
  going out (three or four, no wild cards; kept by request: it's a classic rule). Cards
  left in hands count against. When the stock is empty, play goes on while the player to
  draw can take the pile (they must); otherwise the hand ends. First to 5,000.
- **House rules (options):** play to 5,000/3,000/10,000; draw 2 (default 1); pile always
  frozen; "May I go out?" (ask your partner first and obey; default off); going out
  concealed needs your partner to have melded; any number of wild cards in a meld.
- **How a turn plays here:** draw or take the pile; arrange your cards into groups (as in
  rummy, with "Sort into melds"); the team's first melds go down together with "Lay down
  my melds" (or with the pile's top card when taking it); after that, meld group by group
  and add to your team's melds; then discard or go out. You may not meld or lay off your
  last card unless you're going out (you must keep one to discard).
- **"May I go out?"** is offered only when you could go out. "Yes" means you must; "No"
  means you can't this turn.
- **Starting the pile:** a wild card or red 3 turned up is covered by the next card (up to
  four times), and the pile starts frozen.
- **"Sort into melds"** groups by rank and spends wild cards on the most valuable short
  groups: a good arrangement, not always the best.
- **Simulation:** random players take the pile, meld and go out whenever they can and sort
  after drawing (purely random players never arrange, so they'd never meld).

## 2026-10-08: Building blocks added for canasta

General parts of the game format, added because canasta needed them; none mention it.

- **`meldRules.sets: "anySuits"`**: sets may repeat a suit and have any size (multi-deck).
- **`meldRules.allowed`**: a condition every meld must meet, reading `meld.rank`,
  `meld.naturals`, `meld.wilds`, `meld.size`, `meld.points`, `meld.goingOut` and so on. It
  applies everywhere groups are judged (your arrangement, melding, laying off, taking a
  pile). **Going-out mode:** `meld.goingOut` is true when the melds being judged would
  empty the hand (going out), so a meld can be allowed only then (black 3s).
- **Meld zones per team** (`"per": "team"`), and **`layOff.own`**: lay off only on your own
  (or your team's) melds.
- **`pickUpPile.meldTop`**: take the pile by putting its top card straight into a meld: a
  new one with cards from your hand (2 by default), or one of your own melds. The action's
  `if` sees the top card as `card` and the meld as `meld` (with `isNew`), and its effects
  see the meld too. `player.groups` leaves out the hand cards the take uses. Moves look
  like `{ type: "pickUpPile", from, cards }` or `{ …, meld: { zone, index } }`.
- **`bonusCards`** (top level): cards laid aside as soon as they reach a hand (`to`, a player
  or team zone) and replaced from `replaceFrom` after the deal or a draw; taken with a
  pile, they're laid aside but not replaced.
- **`showHand.discard: "optional"`**: going out may also be done with no discard (a move
  with `card: null`).
- **`ask` effect**: `{ "ask": "(player.id + 2) % 4", "values": ["yes", "no"], "labels": …,
  "set": "state.answer" }` pauses the turn while that player answers (their legal moves are
  `choose` moves), then the rest of the effects run and the turn goes on. The view's
  `pending` has kind `"ask"`.
- **`whenEmpty: { "stock": { "policy": "endRound", "if": … } }`**: the round ends only when
  the condition holds for the player whose turn it is.
- **Expressions:** `player.groups` (the player's valid groups, as a meld pile),
  `player.hasMove('pickUpPile')`, and on meld piles `countMelds(n)` and
  `countNaturalMelds(n)` (melds of at least n cards, without wild cards).
- **Speed:** within one scope (one rule checked card by card), a player's object and its
  costly answers (`groups`, `hasMove`, `deadwood`) are worked out once; the ways to go out
  are found in one pass over the hand. Canasta's simulation went from 814 to 356 ms a game.
- **Server:** moves may carry up to 400 cards (big multi-deck hands).
- Test helper: `onTop(state, "stock", ["9H"])` puts cards on top of a pile.

## 2026-10-10: Bridge

- **Standard rules:** contract bridge with rubber scoring, 4 players in partnerships, 13
  cards each. The dealer calls first; calls go left. A call is a pass (you can still bid
  later), a bid from 1♣ to 7NT higher than the last (♣ < ♦ < ♥ < ♠ < NT), a double of the
  opponents' last bid, or a redouble of your side's doubled bid. Three passes after a bid
  end the auction; four passes at the start throw the hand in. The declarer is the player
  on the contract's side who first named its suit (or NT). The player left of the declarer
  leads; then the dummy's hand is shown to everyone and the declarer plays it. Follow suit.
- **Scoring:** trick points below the line (♣♦ 20, ♥♠ 30, NT 40 then 30; ×2 doubled, ×4
  redoubled); 100 below the line is a game, both sides then start the next game from zero;
  a side with a game is vulnerable. Overtricks at trick value, or 100/200 (vulnerable) each
  when doubled, twice that redoubled. Making a doubled contract 50 (redoubled 100). Slams
  500/750 and 1,000/1,500. Down tricks to the defenders: 50/100 each undoubled; doubled
  100, 300, 500 then +300 (not vulnerable) or 200, 500, 800 then +300 (vulnerable); twice
  that redoubled. Honors (either side, on by default): 4 of the top 5 trumps in one hand
  100, all 5 150, all 4 aces in one hand at NT 150. Rubber (first to 2 games) 700, or 500
  when the other side has a game. Highest total wins.
- **Decided (2026-10-10):** rubber scoring by default with Chicago as a house rule; honors
  counted by default.
- **Chicago:** sets of 4 deals. Vulnerability by deal: none, dealer's side, dealer's side,
  both. Partscores carry over within the set; a game scores 300 (500 vulnerable) and clears
  both partscores; a partscore on the 4th deal that doesn't make game scores 100. A passed-
  out hand is dealt again by the same dealer and doesn't count as one of the 4. (In rubber
  bridge the deal passes on.)
- **House rules (options):** scoring (rubber, Chicago); rubbers (or sets of 4 deals) to play:
  1, 2 or 3; honors (on).
- **Left out:** duplicate and pairs movements (need several tables), conventions and alerts
  (table talk), claims, and penalties for revokes and insufficient bids (the engine never
  allows those moves).
- **Seats:** teams are seats 0 and 2 against 1 and 3, so a seat's team is its number mod 2
  (the file relies on this).

## 2026-10-10: Building blocks added for bridge

General parts of the game format, added because bridge needed them; none mention it.

- **`control`** (on a phase): `{ "seat": "state.dummy", "by": "state.declarer" }`. While
  the expressions give two different seats, the seat's moves are offered to `by` instead,
  marked with `by` (`{ player: 2, by: 0, type: "playToTrick", … }`), and the seat itself has
  no moves. `player` is still the seat whose turn it is and whose cards are used. The engine
  checks `by` itself: a move with `by` is only legal from the controlling seat, so the
  dummy's own client can't play its cards and no one else can either. Null from either
  expression means nobody is controlled. The view has `control`, and the log shows who chose.
- **`reveal`** (on a player or team zone): everyone sees the owner's cards while it holds,
  whatever the zone's visibility, e.g. `"player.id == state.dummy && state.dummyDown"`. Read
  as the owner (`player`, or `team`). The hidden-card checks (simulation and tests) use it.
- **Labels:** a `bid` action's `labels` (`{ "11": "1♣" }`, sent as `view.bidLabels`); a
  `display` entry's `labels` (words for values) and `format: "player" | "team"` (show a seat
  or team as names); `scoring.trackLabels` renames counters on the scoreboard, and `null`
  hides bookkeeping counters (`view.trackLabels`).
- **`setup.dealerRotation`** may be an expression, worked out as the round ends (before the
  round's values are cleared): `"state.contract == null ? 'none' : 'left'"`.
- Bids that must go up are plain numbers: bridge uses level × 10 + suit (11 = 1♣ … 75 =
  7NT), so "higher" is `bid > state.contract` and level and suit come from `%`.

## 2026-10-10: Bots

- **Agreed plan:** bots see only what a person in their seat would (`viewFor` and their legal
  moves) and pick a legal move; their moves go through the same checks and the move log as
  anyone's. Bots are only for built-in games.
- **Decided (2026-10-10):** one bot level (rule-of-thumb play; random play is only for tests);
  bots move after about 2 seconds; a player who leaves is replaced only when the host presses
  "Replace with bot" on their (disconnected) seat; games with bots count in results, marked
  as played with bots.
- **Where the code lives:** the bot interface and the shared play styles are in
  `packages/engine/src/bots/`; which style each built-in game uses (and how it bids) is in
  `packages/games/src/bots.ts`. Game files don't change.
- **Trick-taking style:** goals are "most" tricks, "fewest" (with point cards to avoid and
  dump first), or "bid" (exactly what its side bid). Following: lets a partner's winning
  card stand, wins cheaply when last, otherwise wins high but never with a higher trump than
  needed; when it can't or won't win it throws its lowest plain card. Leading: a card nobody
  can beat in its suit (worked out from the cards played this hand), else low from its
  longest plain suit; when avoiding tricks, its lowest non-point card.
- **`view.roundStart`:** where the current hand's moves begin in the log, so a bot (or the
  table) can see which cards have gone this hand.
- **Other play styles:** shedding (crazy eights: play rather than draw, costliest card first,
  wild cards kept back, name the longest suit); melding (rummy, gin, canasta: keep the hand
  sorted into melds, go out, knock, meld and lay off whenever possible, take the discard only
  when it completes a set or run, canasta always takes the pile and never throws a wild
  card, discard the costliest loose card); counting (cribbage: keep the four best-scoring
  cards, peg the most points without leaving a count of 5 or 21).
- **`sortedGroups()`** comes with every bot's input: the groups "Sort into melds" would make
  of the bot's own hand. It uses only the bot's cards and public rules, so bots get it even
  when a house rule hides the button.
- **Server:** each bot is a user with `isBot` (the bot in seat s is "Bot s+1"). The host adds
  bots to empty seats (lobby or mid-game), removes them in the lobby, and replaces a player
  who isn't connected during the game. When a bot is due to move, the room waits
  `botMoveDelayMs` (2 seconds), asks the bot (its view and legal moves only) and plays the
  move through the same path as anyone's; choices are seeded by the table seed and move
  number. Bots play only while someone has the table open. Bots aren't nudged.
- **Results with bots** are saved as usual; whether a seat was a bot is on its user
  (`isBot`), so game history and stats can mark or separate them later.
- **Known gap, now more likely:** a rummy hand with unlimited reshuffles can reach a
  stalemate (see "Running out of stock"). A table of bots would then play on until the
  engine's 10,000-move stop; the bot logs the error and stops moving. The planned "call it
  a draw" button (Phase 7) is the fix; meanwhile hosts can limit reshuffles.

## 2026-10-10: Launch list

- **Decided:** every built-in game so far ships at launch: spades, hearts, crazy eights,
  rummy, gin rummy, euchre, Oh Hell, cribbage, pinochle, canasta and bridge.
- Each game's file, house rules, scenario and simulation tests are done; the real
  playtests are tracked as a separate list in the Phase 5 checklist.

## 2026-10-10: Saved variants

- **A variant** is a game's house rules and player count saved under a name ("Grandma's
  Spades"). It belongs to the game, not to one version of its file. Whenever a variant is
  read, its options are fitted to the game's current file: options the game no longer has are
  dropped, and a value that's no longer allowed (or a player count) goes back to the default.
  Saving checks the settings exactly as creating a table does (`games/settings.ts`).
- **Anyone can save**, guests included; a guest's variants move to their account when they
  sign in, like their seats and tables. Up to 50 each.
- **Sharing** works like invite links: each variant has a 10-character code, and having the
  link (`/games/<slug>/new?variant=<code>`) is what lets you see it. A shared link fills in
  the create-table page; the person can change anything, and can save their own copy, but
  can't change yours.
- **No editing.** A variant can be deleted (by the person who saved it) and saved again. Links
  to a deleted variant say so and start from the standard rules.
- **Where:** the create-table page has "Start from" (standard rules or your variants for that
  game) and "Save as variant"; the lobby has "Save as variant" under its house rules; the
  Games page lists "Your variants" with New table, Copy link and Delete.

## 2026-10-10: Game history

- **Past games** on the home page lists the games you sat at that are over, newest first, 20
  at a time ("Show more" for older ones): game, date, outcome (you won, lost, shared the win,
  or ended early), and the final scores, winners first. Each links to the table's page,
  which already shows a finished game's final scores and every round, so there's no
  separate past-game page.
- **Ended early** (the host pressed End game) is listed as "Ended early", with no scores, and
  isn't counted in stats. A table ended from the lobby, before anyone played, isn't listed.
- **Stats**: games played and won for each game, finished games only, shown above the list.
  A shared win (a tie for first) counts as a win.
- **Known gap, accepted:** history follows who holds each seat now. A player a bot replaced
  mid-game no longer holds the seat, so that game isn't in their history or stats. Fixing it
  would mean recording each seat's players over time (a database change).
- No database change: it's all built from the saved results.

## 2026-10-10: Rulebook viewer (Phase 5)

- **Rules files** are `packages/games/<game>.rules.md`, next to each game file, exported as
  `builtInRules`. The server sends one at `GET /api/games/:slug/rules`; the web app loads
  it only when the rules are opened (it isn't part of the games list).
- **The formatting subset:** `#` (the title) and `##` headings, paragraphs (lines joined
  until a blank line), `- ` bullet lists, and `**bold**`. Our renderer (`rulesText.ts`,
  `components/Rules.tsx`) turns it into React elements; anything else, HTML included, is
  shown as plain text. A test checks every built-in rulebook stays inside the subset.
- **Every house rule must be explained:** a test checks each option's lobby label (up to
  its first bracket, colon or comma) appears in bold in the rulebook's "House rules"
  section, so a new option can't ship undocumented.
- **Where:** a Rules button on the table (in the header on wide screens, in the ⋯ menu on
  phones) and in the lobby opens the rulebook over the game, starting with "At this table"
  (players, partners by name, every house rule with "(changed)" next to ones that differ
  from the standard game). The Games page links to a page per game (`/games/<slug>/rules`)
  with the written rules only.
- The written rules for all eleven games are first drafts, to be reviewed on the site.

## 2026-10-14: Euchre playtest fixes

- **A finished trick stays on the table** (winner highlighted) until the next card is led,
  so the last card played can be seen without reading the log. "Last trick" only appears
  once the next trick has started.
- **Euchre shows trump and who called it** in the middle of the table (game file `display`):
  "Trump: ♥ Hearts", "Called by", and "Going alone" / "Defending alone" when they apply.
  Bridge already shows its contract; spades' trump is always spades. Oh Hell and pinochle
  don't show trump yet (not changed; to look at during the playtest).
- **`giveCards` effect**: `{ "giveCards": "upcard", "to": "hand" }` gives every card in a
  shared zone to the player (`to` defaults to `hand`).
- **A phase's `start` effects** run as it begins, for the player who starts it, before anyone
  moves. Only effects that finish straight away are allowed (no choose, ask, score,
  layOutMelds, nextPlayer, skip or reverse). Euchre's exchange phase uses
  `"start": [{ "if": "player.isDealer", "giveCards": "upcard" }]`, so the dealer is handed
  the upcard and only has to discard (before, they had to click it after picking it up).
  If the dealer sits out (partner alone), they get nothing, as before.
- **The log names cards turned up and given out.** The engine notes each card turned up in
  the deal (`setup.flip`) and each `giveCards` (`state.cardEvents`, in the view as
  `cardEvents`), and the log shows "Turned up: Jack of hearts" and "Raj picked up Jack of
  hearts". A card is named only if everyone could see it where it was (a face-up zone, or
  the one top card of a top-card-only zone); otherwise the line just says where the cards
  came from. The simulation's hidden-card check leaves `cardEvents` out, since those cards
  were public when they moved even if they're in a hand now.
- **Bots wait while round scores are open.** When a round ends (and the game goes on), every
  connected person at the table is shown the round's scores, and the server holds the bots
  until each of them has closed it (client message `roundSeen`) or left the table. There is
  no time limit, as with a person's turn (decided by Arjun). People can still move while
  others read. Who's still reading is in the table info (`readingScores`), so others see
  "Waiting for Ana to close the round scores…" rather than "Waiting for Bot 2…". Not
  saved: after a server restart nobody has the scores open, so the bots carry on.
- **The next hand waits for the round scores too** (2026-10-15, decided by Arjun after a
  playtest where the new hand and euchre's upcard showed behind the scores). The server plays
  moves with `applyMove(state, move, { holdNextRound: true })`: a move that ends a round
  stops once it's scored, with status `betweenRounds`, the last trick still on the table and
  nobody able to move (no nudges either). When everyone has closed the scores (or left),
  the server calls `dealNextRound`. People can no longer move while others read. The deal
  isn't a move, so nothing extra is saved: replaying a game deals straight away and comes
  out exactly the same (a simulation of every built-in game checks this), and the saved
  "whose turn" is already the new round's. The table says "Waiting for Ana to close the
  round scores…" meanwhile.
- **`showOnTable` for shared zones**: `"showOnTable": "state.maker == null"` draws the pile on
  the table only while the expression holds (the view lists the others in `offTable`). The
  cards don't change, and a pile you can use right now is always drawn. Euchre's upcard and
  kitty leave the table once trump is made, leaving the trick and the game's values.
- **`dealer` in expressions** is the dealer's seat; a `display` may use it (it's public).
  Euchre used it for "Picks up the upcard: <dealer>", but both upcard lines were removed
  on 2026-10-15 (decided by Arjun after a playtest): it's always the dealer, the dealer's
  turn badge shows who you're waiting on, and the log records the pickup. The table shows
  only Trump, Called by and who's going or defending alone.

## 2026-10-15: Deleting tables

- **The host can delete any table they created**, from "Your tables" on the home page (after
  a confirm). Decided by Arjun.
- **Deleted means gone**: the table, its seats, moves and result are removed, so a started
  game disappears from everyone's "Past games" too (decided by Arjun). A game in progress
  ends for everyone: people with the table open get a `deleted` message and see "This
  table was deleted"; their connection closes and doesn't reconnect.
- `DELETE /api/tables/:code` (host only). If the table is open, the deletion runs in its
  room's queue, after any move already being saved.

## 2026-10-15: Euchre's turned-down upcard and the bowers in your hand

- **Once everyone passes the upcard, it's turned down and leaves the table**, along with the
  kitty, as they already do once trump is made. Asked for by Arjun. The `nameTrump` phase
  sets `state.turnedDown` when it starts; both zones' `showOnTable` checks it. The log still
  says what the upcard was, and that suit still can't be named.
- **Once trump is chosen, your hand sorts the bowers in with trump**: the left bower, then the
  right, at the top of trump. The view now carries `trump` (suit, and whether bowers apply)
  so the client can sort without knowing the game's rules.

## 2026-10-18: UI polish (planned before Phase 6)

Agreed with Arjun from a list of proposals; the work is the "UI polish" section of the
build checklist, done before Phase 6.

- **Still generic.** Animations, banners and floating points are triggered by move types
  (`playToTrick`, `draw`, `discard`, `pass`, `meld`…) and by the score and card events in
  the view, never by a game's name, so custom games get them too. Big-moment banners use
  the labels the game file already gives its events.
- **No sound.** Sound effects were proposed and left out (decided by Arjun). Turn alerts are
  visual: a glow, the tab title, and a phone vibration where supported.
- **Display font: a font file we serve ourselves** (decided by Arjun), openly licensed, for
  headlines and scores. No third-party font service, so no outside requests while playing.
- **Server changes included** (decided by Arjun):
  - **Show all hands after a round.** A round's hands become public only once the round is
    over, so this never reveals a card during play.
  - **Rematch.** A new table from a finished one, with the same players invited back to the
    same seats.
  - **Quick reactions.** A fixed set (👍 😮 😂 GG) and no free text, so there's nothing to
    moderate; rate limited like nudges.
- **Motion rules.** No animation library: CSS and the browser's own animation support.
  Under about 400ms per card, and never blocking your next move. Other players' moves play
  in order at a minimum pace, so a fast bot's turns don't blur together. With "reduce
  motion" switched on, everything becomes a simple fade and there's no confetti. An
  animation-speed setting (normal, fast, off) is saved in the browser.
- **Team colours.** Each team gets a colour used the same way at the seats, in the
  scoreboard, the round summary and the results. Colour is never the only signal: names
  and labels stay.
- **Suits always come with their symbol in its colour** wherever a suit is named (trump,
  the log, bids, suit choices), still red and black only (see "First playtest feedback").
- **Playtests and the rulebook review have their own sections** in the build checklist,
  before Phase 6, instead of being inside Phase 5. They don't block other work.
- **No "best moment" when you lose** (decided by Arjun, 2026-10-20): the losing screen just
  says "Good game", without picking out a highlight of yours.

## 2026-10-20: Table look (UI polish)

- **A seat's colour is its team's colour** (decided by Arjun). Partners share a colour; in
  games where everyone plays alone, each player is their own team, so every seat gets its own
  colour. The colour comes from the team number in the view (`--team-0` … `--team-7`,
  reused past eight teams), never from the game. Avatars are the player's initials from
  their real name ("Raj Patel" → RP, "Bot 3" → B3; yours too, not "You").
- **Where the colours show:** avatars at the seats and beside your status line, a stripe on
  each team in the scoreboard, round summary and results, and a dot in "Every round"'s
  column headings. On phone chips (five or more players) there's no room for an avatar, so
  the team colour runs down the chip's left edge; the avatar is in the chip's details.
- **Accessibility:** avatars are decorative (hidden from screen readers) because the name is
  always written beside them, and team membership is still said in words ("Partner", team
  names). Every colour is readable behind white initials (at least 4.8:1), and the first two
  (blue, orange) stay apart for colour-blind players. A white ring keeps avatars apart from
  the felt.
- **Display font: Playfair Display** (decided by Arjun), bold, Latin characters only, served
  from `apps/web/public/fonts` under the name "Table Display" (the licence reserves the
  original name for unmodified copies). Used for headings, the game title and scores; score
  digits are all one width so totals don't shift.
- **Felt, rail and card back are CSS only:** the rail is the felt's border painted with wood
  gradients (10px, 6px on phones); the card back is a diamond lattice in a white border with
  an inner frame line, which tiny cards leave out.

## 2026-10-20: Suits shown everywhere (UI polish)

- **Trump badge: bottom-left of the felt** (decided by Arjun), at the start of the row that
  already holds the game's values and the "Last trick" button, so nothing else moves. It
  comes from `view.trump`, so every game with trump gets it (spades, euchre, Oh Hell,
  pinochle, bridge's suit contracts, custom games); there's none in no-trump or games
  without trump. This replaces euchre's "Trump" game value (removed from `euchre.json`) and
  answers the earlier note that Oh Hell and pinochle didn't show trump.
- **Trump cards in your hand get a mark in every game** (decided by Arjun), even in spades
  where trump never changes, so it works the same everywhere. The mark sits in the card's
  bottom-left corner, the part that stays in view when cards overlap. Euchre's left bower
  counts as trump. Screen readers hear ", trump" after the card.
- **Suit symbols in text sit on a small white chip** in true red or black, so they read on
  the felt, on blue buttons and in dark mode. Any ♠♥♦♣ in text is drawn this way (bids such
  as "1♣", "Play Q♠", the game file's own labels), so custom games get it too.
- **Cards named in the log are small white cards** ("Raj played [9♥]"); screen readers and
  announcements still say "9 of hearts". A suit named in the log shows its symbol and name
  ("made ♥ hearts trump").
- **Choosing a suit or trump uses four large white tiles** (symbol and name), white in dark
  mode too, like the cards.
- **"Led ♠" comes from the server:** the trick in the view now has `led`, the suit the
  first card counts as, so a left bower leads trump. It's null when the trick's cards are
  hidden from you.
- **Crazy eights shows the suit named for an 8** ("Suit to play: ♥ Hearts") while an 8 is on
  top, once its suit is named. Game files can now give a `display` value `format: "suit"`.
  A display may only use state, never piles, so the game keeps a `state.eight` flag, and the
  suit is blank (so not shown) while the player of the 8 is still choosing.

## 2026-10-22: Card motion (UI polish)

- **A finished trick is swept when the next card is led** (decided by Arjun). It stays on the
  table, winning card outlined, until then (as decided after the first playtest), and the
  sweep to the winner's seat plays as the new lead slides in. The winner's trick count
  changes, with a short glow, when the trick is won, as before.
- **The view says who passed to whom** (decided by Arjun). `view.passes` lists this round's
  passes you made or received. The receiver sees the cards only once they're delivered, so
  nothing is shown early. Cards passed to you are raised for 4 seconds, and your status line
  says "From Ana: [2♥] [6♥] [9♥]". Screen readers hear "Ana passed you …", and each card says
  ", from Ana". The note is in the status line, not a tag on a card: the hand scrolls
  sideways, which clips anything drawn above it. Nothing is raised when you open the table
  after the cards came.
- **How it works:** just before a new view is drawn, the table notes where every card is.
  Once it's drawn, a copy of each card that moved flies from its old spot to its new one, on
  a layer above the page, while the real card stays invisible until the copy lands. Cards
  that came into view fly from where the log says they came from (a seat or a pile). Cards
  that left fly to where they went. Face-down cards nobody here can see fly as card backs.
  All of this is worked out from card ids, zone keys and the log, never from the game's
  name (`table/motion/plan.ts`).
- **Pacing:** your own moves show at once. Other players' moves are shown at least 600ms
  apart, and if more than 3 are waiting it jumps to the newest. The server already waits 2
  seconds between bot moves, so this mostly matters after a reconnect.
- **The deal** goes one card to each seat in turn, starting on the dealer's left, in about a
  second whatever the number of cards. A tap anywhere skips it. It plays at the start of
  every round, and when the table opens on a deal with no moves made yet.
- **Counts** (cards in a pile or a hand, tricks won) glow briefly when they change, rather
  than scaling up, so text around them doesn't move.
- **Reduce motion:** cards fade in or out where they are, with no flights, no card backs
  and no glow. The animation-speed setting (still to come) only has to change
  `motionSpeed()` in `table/motion/animate.ts`.

## 2026-10-22: Trump mark and the game's values (bugs)

- **No trump mark on the cards in your hand** (decided by Arjun: overkill). This reverses
  "Trump cards in your hand get a mark in every game" (2026-10-20). The trump badge on the
  table is enough. Screen readers still hear ", trump" after a trump card, since it costs
  nothing on screen.
- **The game's values sit in one line beside the trump badge, centred on it**, wrapping if a
  game has many (bridge shows up to five). They used to fill three fixed rows from the top,
  so a lone "Called by Bot 2" floated above the badge on wide screens. The promise from
  2026-10-15 still holds: values that come and go (euchre's "Going alone") are last in the
  game file, so they don't move the others. Phones already laid them out this way.

## 2026-10-22: Turns and events (UI polish)

- **Whose turn it is** glows softly in and out: the seat's border (the chip on phones) and a
  line along the top of your hand area. With "reduce motion" the glow stays still. The
  yellow "Turn" badge and your highlighted status line stay, so it's never only a glow.
- **Tab title:** "● Your turn – Card Table" while it's your turn and the tab is in the
  background; it goes back as soon as you look or your turn ends.
- **Phone buzz:** 150ms when your turn starts, not when you open the table on your turn,
  and not again for the next step of the same turn (draw, then discard). Android only:
  iPhones don't let web pages vibrate.
- **Speech bubbles for every decision said out loud,** not just `bid`: `passBid`,
  `declareTrump` and `choose` too, because euchre's bidding ("Order it up", "Pass") is made
  of choices. A bare number reads "Bid 3"; anything with its own words says just those
  ("Nil", "1♣"). The bubble opens above the seat (below it for seats along the top), stays
  2.5 seconds and shrinks back into the seat, where the bid is written. Yours comes from
  your avatar in the status line. Only the newest bubble at a seat is shown.
- **Floating points** come from the view's score events (points scored during play): "+2
  Pair", "+50 Meld" (a held score with no label says where it's held). Points scored
  together at one seat float up 300ms apart, so a cribbage hand's Fifteens, Pairs and Runs
  can each be read.
- **What counts as new:** the table compares each view it draws with the one before, so
  bubbles and points follow the pace of other players' moves, and opening a table never
  replays what happened before you came (`table/events.ts`). Both are hidden from screen
  readers, which hear the same news from the log announcement. With "reduce motion" they
  fade in and out where they are.
- **Scoreboard totals count** to their new value in 0.6 seconds, quickly at first and
  settling on the number (`CountUp.tsx`, to be reused in the round summary and results).
  Screen readers only get the final number. With "reduce motion" the number just changes.
- **Banners:** a dark band with gold edges sweeps across the middle of the felt, holds and
  sweeps on (1.8 seconds), with the moment's words large and whose it is small above them
  ("TEAM 2 (ANA & RAJ)" / "Euchred!"). It ignores the pointer, so play goes on underneath.
  Two at once are stacked. With "reduce motion" it fades in and out.
- **Moments go in the game log** too ("Raj: Shot the moon!", after the move and its
  points), so they're kept and screen readers hear them as the latest news; the banner
  itself is hidden from screen readers.
- **Big moments come from a new `moments` list in the game file** (decided by Arjun), not
  from labels on existing rules, so a meld reaching seven cards (a canasta) can be one.
  Each has a `label` and either `when` (happens each time the condition turns true) or
  `each` (happens each time the number goes up), and optionally `per: player|team` (checked
  for each, and the banner says whose). See docs/game-format.md, "Big moments".
- **How the engine finds them:** every moment is read just before a move and again once the
  move has settled (after any round scoring, before the next deal), and the ones that
  happened go in `view.moments`, like score events. Nothing else is stored, so a value that
  resets with the round can happen again next round.
- **Moments may only use public values,** checked by the validator, because everyone sees
  the banner: state, options, round, dealer, players' and teams' public values (score, bid,
  tricks, active, dealer, counters), face-up piles, and the count of a pile whose count is
  shown. Hands, hidden piles, `trick`, `holderOf`, deadwood, legal moves and player values
  are refused. This is the same idea as `display`, a little wider.
- **A moment that can't be worked out counts as not happened** (a null value: "state.total
  >= 10" before anything is counted), instead of stopping the game. It's only a banner.
- **The built-in games' moments:** spades "Nil broken", "Blind nil broken" and "Set!" (at
  the end of the hand); hearts "♥ Hearts broken" and "Shot the moon!"; euchre "Euchred!" (as
  the defenders take their third trick) and "March!"; gin rummy "Gin!" and "Big gin!";
  canasta "Canasta!" for every meld reaching seven cards. Hearts' won piles are face down,
  so an `afterTrick` effect notes the shooter in `state.moonShooter` the moment one player
  holds all 26 points (necessarily the winner of that trick); the cards were all seen as
  they were played, so this gives nothing away. Gin's undercut was left out: it needs
  deadwood, which a moment can't read.

## 2026-10-22: End of a round (UI polish)

- **Three optional game-file settings for the round summary** (decided by Arjun): `label`
  on scoring rules (where the points came from), `scoring.contract` (Made or Set) and
  `endCondition.target` (the score the game is played to). Working Made/Set out from bids
  and tricks alone was turned down: it's wrong for Oh Hell (exact bids), euchre (only the
  makers have a contract) and bridge (a "4♠" bid means ten tricks). See
  docs/game-format.md, "Round summary".
- **How the breakdown is kept:** every scoring rule and score event that changes a team's
  score this round is noted with its label, and the round history saves each team's
  `parts` (by label, in the order first scored, without parts of 0). The parts always add
  up to the round's points; points with no label are listed as null and shown as "Other".
  End-of-game bonuses count as part of the last round, as before.
- **The contract is checked just before the round is scored**, so it sees bags and other
  counters as they were during the round. It isn't limited to public values: the round is
  over and its hands are about to be shown anyway.
- **`target` is public, like a moment**, because every player sees the progress bars.
  The view gives it as `goal`, with whether the highest or lowest score wins.
- **The leader gets a crown in "lowest wins" games too** (decided by Arjun): in hearts, the
  lowest score.
- **Show all hands can be opened from the results screen too** (decided by Arjun), as well
  as from the round summary and "Every round".

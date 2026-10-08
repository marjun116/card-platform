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

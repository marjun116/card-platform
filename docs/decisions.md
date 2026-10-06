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

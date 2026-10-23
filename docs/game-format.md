# Card Game Description Format

Oct 5, 2026 · @Arjun Mahajan

## Overview

Every game on the platform, built-in or custom, is a single JSON file that a shared rules engine runs. Built-in games like spades are hand-written files; custom games are files the AI drafts from a family's typed rules, then refines through clarifying questions and playtesting.

Scope for the first release:

- **Turn-based only.** At any moment the engine knows exactly who may act. Speed games are out.
- **Standard decks only.** One or more 52-card French decks, optionally with jokers or with ranks removed. No special decks, no non-card components besides a score sheet.
- **Points only.** Scoring tracks points; nothing has cash value.

The format is declarative: it describes *what* the game is, not code for *how* to run it. That keeps every game safe to run, easy for the AI to write, and readable by a person checking it.

## Building blocks

A game file has eight top-level sections. The engine supplies the behavior for each; the file only fills in the specifics.

| Section | What it defines | Example values |
| --- | --- | --- |
| `meta` | Name, player count, description; optionally, how the game's tile looks | 4 players, partnerships; 45–90 minutes |
| `deck` | Which cards are in play | 1 deck, no jokers |
| `cardOrder` | Rank order, trump, wild cards | Aces high; spades always trump |
| `zones` | Places cards can be | Each hand, stock, discard, current trick, won tricks, melds |
| `setup` | Shuffle and deal | 13 cards each, dealer rotates left |
| `phases` | The ordered stages of a round | Bid, then play 13 tricks |
| `scoring` | Points at the end of a round | 10 per trick bid, 1 per overtrick |
| `endCondition` | When the whole game ends | First team to 500 |

Three optional `meta` fields only change how the game's tile looks on Home and in the games list:

- `minutes`: how long a game usually takes, as a number (`20`, "about 20 min") or a range (`[30, 60]`). Without it, the tile shows no length.
- `cards`: three card codes fanned on the tile, e.g. `["AS", "KS", "QS"]`. Without it, the tile fans the deck's three highest cards.
- `accent`: the tile's colour, `0` to `7`. Without it, a colour is picked from the game's name (the same one every time).

`cardOrder.sortSuits` sets the order suits are sorted in a hand on screen, e.g. hearts last in hearts: `["spades", "diamonds", "clubs", "hearts"]`. Suits it leaves out follow in the usual order (♠ ♥ ♣ ♦). It only changes how hands look, never a rule.

Inside `phases`, each phase lists the **actions** players may take on their turn, drawn from a fixed library:

- **Card movement:** `draw`, `discard`, `play`, `pass`, `meld`, `layOff`, `pickUpPile`, `showHand` (go out by showing a fully arranged hand)
- **Trick-taking:** `playToTrick` with `followSuit` rules, `resolveTrick`, `breakSuit` (e.g. spades broken)
- **Bidding:** `bid` with allowed values, `passBid`, `declareTrump`
- **Choices:** `choose` (pick one of several named options, e.g. how to score shooting the moon)
- **Turn control:** `nextPlayer`, `winnerLeads`, `skip`, `reverse`

Actions can carry **conditions** (when the move is legal) and **effects** (what happens after). Conditions use a small expression language with fixed operators, such as `hand.count == 0` or `card.rank in ["J", "Q", "K"]`. There are no loops or arbitrary code, so a custom game can't hang or break the server.

In rummy-style games (with `meldRules`), players **arrange their own hands** into groups at any time, and a "Sort into melds" move can do it for them. Melds, lay-offs, going out and deadwood all follow those groups.

**Hidden information** is declared per zone: `visibility` is `owner`, `all`, `none`, or `topCardOnly`. The server only sends each player what that setting allows.

## Deck rules

The `deck` section only describes subsets of standard decks, so every game is playable with real cards on a kitchen table. It has four settings:

- `copies`: how many 52-card decks are combined (1 to 6)
- `ranks`: which ranks to keep (default: all 13)
- `suits`: which suits to keep (default: all 4)
- `jokers`: jokers per deck (0, 1 or 2)

| Game | copies | ranks | jokers | Cards |
| --- | --- | --- | --- | --- |
| Spades, hearts, bridge, rummy | 1 | all | 0 | 52 |
| Euchre | 1 | 9–A | 0 or 1 | 24–25 |
| Pinochle | 2 | 9–A | 0 | 48 |
| Canasta | 2 | all | 2 | 108 |
| Hand and Foot | 4–6 | all | 2 | 216+ |

Games that need cards not found in a standard deck (Rook, Uno, Phase 10) can't be described and are out of scope.

## House rule toggles

A built-in game declares `options`: named switches the table host sets before dealing. Each option has a default (the standard rule) and patches specific parts of the file when switched on. Most families can play their version this way without building a custom game.

```json
"options": {
  "blindNil": {
    "label": "Allow blind nil",
    "type": "boolean",
    "default": false
  },
  "targetScore": {
    "label": "Play to",
    "type": "choice",
    "values": [300, 500, 1000],
    "default": 500
  }
}
```

Rules reference options by name, e.g. `"if": "options.blindNil"`. A table's chosen options are shown in the lobby, so nobody sits down expecting different rules.

When a family saves its own set of toggles, it becomes a **variant**: a named, shareable preset like "Grandma's Spades" that sits between the standard game and a fully custom one.

## Big moments

A game can name its big moments, which the table shows as a banner across the felt
("♥ Hearts broken", "Euchred!", "Canasta!"). Each moment has a `label` and either:

- `when`: a condition. The moment happens each time it turns from false to true.
- `each`: a number. The moment happens each time it goes up (every new canasta).

With `"per": "player"` or `"per": "team"`, the moment is checked for every player (or
team) on their own, and the banner says whose moment it is.

```json
"moments": [
  { "when": "state.heartsBroken", "label": "♥ Hearts broken" },
  { "per": "team", "each": "team.melds.countMelds(7)", "label": "Canasta!" },
  { "per": "player", "when": "player.bid == 'nil' && player.tricks > 0", "label": "Nil broken" }
]
```

Everyone sees the banner, so a moment may only use what everyone can see: `state`,
`options`, the round and dealer, players' and teams' scores, bids and tricks, face-up
piles, and the number of cards in a pile whose count is shown. The validator rejects a
moment that looks at a hand or any other hidden card. When a moment depends on cards
everyone saw played that are now face down, such as the tricks a player has won, an
effect can note the answer in `state` first (hearts notes who shot the moon in
`state.moonShooter`). A moment is only a banner: if it can't be worked out yet (a value
that isn't set), it simply hasn't happened.

## Round summary

Three optional settings make the summary at the end of each round say more. A game
works without them; the summary then shows only each team's points and total.

- **`label` on a scoring rule** says where its points came from. The summary lists them
  by label, such as "Tricks 60 · Bags +2 · Nil +100", along with points scored during
  play under the `score` effect's own label. Rules with the same label are added
  together, and a part that comes to 0 isn't shown.
- **`scoring.contract`** says whether a team made its contract, shown as a "Made" or "Set"
  badge. It's checked for each team just before the round is scored. `made` is the
  condition; with `if`, only teams where `if` holds have a contract (euchre's makers).
- **`endCondition.target`** is the score the game is played to, as a number or an
  expression such as `options.targetScore`. The table draws each team's progress toward
  it. Everyone sees it, so, like a moment, it may only use what everyone can see.

```json
"scoring": {
  "perTeam": [
    { "label": "Tricks", "if": "team.tricks >= team.bid", "add": "team.bid * 10" },
    { "label": "Bags", "if": "team.tricks >= team.bid", "add": "team.tricks - team.bid" }
  ],
  "contract": { "if": "team.bid > 0", "made": "team.tricks >= team.bid" }
},
"endCondition": {
  "when": "anyTeam.score >= options.targetScore",
  "winner": "highestScore",
  "target": "options.targetScore"
}
```

## Example 1: Spades

This is a complete built-in game in about 90 lines, with four house rule toggles. Standard rules: four players in two partnerships, each player bids, spades are always trump, and the first team to 500 wins. A team that falls to -200 loses (the "mercy rule", on by default).

```json
{
  "meta": {
    "name": "Spades",
    "players": 4,
    "teams": [[0, 2], [1, 3]]
  },
  "deck": { "copies": 1, "jokers": 0 },
  "cardOrder": {
    "ranks": ["2","3","4","5","6","7","8","9","10","J","Q","K","A"],
    "trump": "spades"
  },
  "options": {
    "nil":        { "label": "Allow nil bids",   "type": "boolean", "default": true },
    "blindNil":   { "label": "Allow blind nil",  "type": "boolean", "default": false },
    "targetScore":{ "label": "Play to", "type": "choice", "values": [300, 500, 1000], "default": 500 },
    "mercyRule":  { "label": "End the game when a team falls to -200", "type": "boolean", "default": true }
  },
  "zones": {
    "hand":  { "per": "player", "visibility": "owner" },
    "trick": { "shared": true,  "visibility": "all" },
    "won":   { "per": "team",   "visibility": "none", "countVisible": true }
  },
  "setup": {
    "shuffle": true,
    "deal": { "to": "hand", "count": 13 },
    "dealerRotation": "left"
  },
  "phases": [
    {
      "name": "bidding",
      "order": "leftOfDealer",
      "rounds": 1,
      "actions": [
        { "type": "bid", "values": { "range": [1, 13] } },
        { "type": "bid", "values": ["nil"], "if": "options.nil" },
        { "type": "bid", "values": ["blindNil"],
          "if": "options.blindNil && !player.hasLookedAtHand" }
      ]
    },
    {
      "name": "play",
      "repeat": 13,
      "leader": { "first": "leftOfDealer", "then": "lastTrickWinner" },
      "actions": [
        {
          "type": "playToTrick",
          "followSuit": true,
          "leadRestriction": {
            "cannotLead": "spades",
            "unless": "state.spadesBroken || hand.onlySuit('spades')"
          }
        }
      ],
      "afterTrick": [
        { "resolveTrick": "highestTrumpElseHighestLed" },
        { "moveTrick": "won", "of": "winnerTeam" },
        { "set": "state.spadesBroken", "if": "trick.containsSuit('spades')" }
      ]
    }
  ],
  "scoring": {
    "perTeam": [
      { "label": "Tricks", "if": "team.tricks >= team.bid", "add": "team.bid * 10" },
      { "label": "Bags", "if": "team.tricks >= team.bid",
        "add": "team.tricks - team.bid",
        "track": { "bags": "team.tricks - team.bid" } },
      { "label": "Set", "if": "team.tricks < team.bid", "add": "-team.bid * 10" },
      { "label": "Bag penalty", "if": "team.bags >= 10", "add": -100, "track": { "bags": -10 } }
    ],
    "perPlayer": [
      { "label": "Nil", "if": "player.bid == 'nil'",
        "add": "player.tricks == 0 ? 100 : -100", "to": "team" },
      { "label": "Blind nil", "if": "player.bid == 'blindNil'",
        "add": "player.tricks == 0 ? 200 : -200", "to": "team" }
    ],
    "contract": { "if": "team.bid > 0", "made": "team.tricks >= team.bid" }
  },
  "endCondition": {
    "when": "anyTeam.score >= options.targetScore || (options.mercyRule && anyTeam.score <= -200)",
    "winner": "highestScore",
    "target": "options.targetScore"
  }
}
```

Three things this example shows:

- **The engine does the heavy lifting.** `followSuit`, `highestTrumpElseHighestLed` and dealer rotation are built-in behaviors shared by every trick-taking game. Hearts, euchre and bridge reuse them.
- **Toggles are just conditions.** Blind nil is one `if` on an action and one scoring line.
- **It's readable.** A family member could check a custom game's file and spot a wrong rule.

## Example 2: A custom family game

This invented game, "Sevens Up," shows the full creation flow: rules typed the way a family would write them, the questions the AI asks back, and the file it produces.

**1. What the family types:**

> Everyone gets 7 cards. Flip one card to start the pile. On your turn play a card that matches the suit or number of the top card. 7s are wild and you pick the suit. If you play a queen the next person draws 2. If you can't play you draw. First person out wins the hand and everybody else adds up their cards. Face cards are 10, aces 15, 7s are 20. Get to 100 and you're out, last one left wins.

**2. What the AI asks before building:**

- How many players? (Assumed 2 to 6.)
- If you can't play and draw a card, can you play it right away, or does your turn end?
- If the starting card is a 7 or a queen, does it count?
- If someone plays a queen on a queen, does the next person draw 4?
- What are number cards worth: their face value?
- When the draw pile runs out, do you reshuffle the discards?

Suppose the family answers: 2–6 players; you may play the drawn card; the starting card has no effect; queens don't stack; number cards count face value; reshuffle the discards.

**3. The file the AI produces:**

```json
{
  "meta": { "name": "Sevens Up", "players": [2, 6], "custom": true },
  "deck": { "copies": 1, "jokers": 0 },
  "zones": {
    "hand":    { "per": "player", "visibility": "owner" },
    "stock":   { "shared": true, "visibility": "none", "countVisible": true },
    "discard": { "shared": true, "visibility": "topCardOnly" }
  },
  "setup": {
    "shuffle": true,
    "deal": { "to": "hand", "count": 7 },
    "rest": "stock",
    "flip": { "from": "stock", "to": "discard", "triggerEffects": false,
              "set": { "state.activeSuit": "card.suit" } }
  },
  "phases": [
    {
      "name": "play",
      "order": "clockwise",
      "until": "anyPlayer.hand.count == 0",
      "actions": [
        { "type": "play", "to": "discard",
          "if": "card.suit == state.activeSuit || card.rank == discard.top.rank || card.rank == '7'",
          "effects": [
            { "if": "card.rank == '7'", "choose": "suit", "set": "state.activeSuit" },
            { "if": "card.rank != '7'", "set": { "state.activeSuit": "card.suit" } },
            { "if": "card.rank == 'Q'", "nextPlayer": { "draw": 2, "from": "stock" } }
          ] },
        { "type": "draw", "from": "stock", "count": 1,
          "if": "!player.hasLegalPlay", "then": "mayPlayDrawnCard" }
      ],
      "whenEmpty": { "stock": "reshuffleDiscardExceptTop" }
    }
  ],
  "scoring": {
    "perPlayer": [
      { "add": "sum(player.hand, cardValue)" }
    ],
    "cardValue": { "7": 20, "A": 15, "J": 10, "Q": 10, "K": 10, "default": "rankNumber" }
  },
  "elimination": { "when": "player.score >= 100" },
  "endCondition": { "when": "activePlayers.count == 1", "winner": "lastActivePlayer" }
}
```

Every one of the six questions matched a real gap in the typed rules. Without them, the engine would have had to guess, and families would notice the guesses during play. The questions are what make a custom game feel like *their* game.

## Limits and decisions

Some house rules won't fit the action library, such as "the dealer can call a re-deal if everyone agrees" or anything that depends on table talk. For those, the AI should say plainly which rule it can't enforce and offer two paths:

- **Partial enforcement:** the engine enforces everything it can, and the unsupported rule becomes a manual button (e.g. "Call re-deal") that the table votes on.
- **Table mode:** no enforcement at all. Cards move freely, players police the rules, and a shared scorepad tracks points.

### Decisions

- **Sharing:** custom games are private to their creator by default. The creator can share a game by link or invite, and anyone who receives it can host and play it on their own, without the creator present.
- **Broken games mid-play:** any player can flag a problem during a game (e.g. "that move should have been allowed"). The engine then abandons the game, and the AI asks the players clarifying questions about the disputed rule and revises the game file. The fixed version is saved for future games.
- **Bots:** no bots for custom games at launch. Custom games need a full table of human players. Bots stay available for built-in games.

### Still open

- [x] Which games ship at launch: every built-in game so far: spades, hearts, crazy eights,
  rummy, gin rummy, euchre, Oh Hell, cribbage, pinochle, canasta and bridge (decided
  2026-10-10).

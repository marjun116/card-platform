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
| `meta` | Name, player count, description | 4 players, partnerships |
| `deck` | Which cards are in play | 1 deck, no jokers |
| `cardOrder` | Rank order, trump, wild cards | Aces high; spades always trump |
| `zones` | Places cards can be | Each hand, stock, discard, current trick, won tricks, melds |
| `setup` | Shuffle and deal | 13 cards each, dealer rotates left |
| `phases` | The ordered stages of a round | Bid, then play 13 tricks |
| `scoring` | Points at the end of a round | 10 per trick bid, 1 per overtrick |
| `endCondition` | When the whole game ends | First team to 500 |

Inside `phases`, each phase lists the **actions** players may take on their turn, drawn from a fixed library:

- **Card movement:** `draw`, `discard`, `play`, `pass`, `meld`, `layOff`, `pickUpPile`
- **Trick-taking:** `playToTrick` with `followSuit` rules, `resolveTrick`, `breakSuit` (e.g. spades broken)
- **Bidding:** `bid` with allowed values, `passBid`, `declareTrump`
- **Turn control:** `nextPlayer`, `winnerLeads`, `skip`, `reverse`

Actions can carry **conditions** (when the move is legal) and **effects** (what happens after). Conditions use a small expression language with fixed operators, such as `hand.count == 0` or `card.rank in ["J", "Q", "K"]`. There are no loops or arbitrary code, so a custom game can't hang or break the server.

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

## Example 1: Spades

This is a complete built-in game in about 90 lines, with three house rule toggles. Standard rules: four players in two partnerships, each player bids, spades are always trump, and the first team to 500 wins.

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
    "targetScore":{ "label": "Play to", "type": "choice", "values": [300, 500, 1000], "default": 500 }
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
            "unless": "state.spadesBroken || hand.allSpades"
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
      { "if": "team.tricks >= team.bid",
        "add": "team.bid * 10 + (team.tricks - team.bid)",
        "track": { "bags": "team.tricks - team.bid" } },
      { "if": "team.tricks < team.bid", "add": "-team.bid * 10" },
      { "if": "team.bags >= 10", "add": -100, "track": { "bags": -10 } }
    ],
    "perPlayer": [
      { "if": "player.bid == 'nil'",
        "add": "player.tricks == 0 ? 100 : -100", "to": "team" },
      { "if": "player.bid == 'blindNil'",
        "add": "player.tricks == 0 ? 200 : -200", "to": "team" }
    ]
  },
  "endCondition": {
    "when": "anyTeam.score >= options.targetScore",
    "winner": "highestScore"
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
    "flip": { "from": "stock", "to": "discard", "triggerEffects": false }
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

- [ ] Which games ship at launch: more than five, list to be decided.

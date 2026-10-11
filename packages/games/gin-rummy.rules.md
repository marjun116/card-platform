# Gin Rummy

A two-player rummy game. Build sets and runs in your hand, and knock when the cards left over add up to 10 or less.

## Players and cards

- 2 players.
- One standard deck, no jokers. Aces are low.
- Each player gets 10 cards. The rest form the stock, and one card is turned up to start the discard pile (the **upcard**).

## Melds and deadwood

- A **set** is 3 or 4 cards of the same rank.
- A **run** is 3 or more cards of the same suit in order, such as 8♠ 9♠ 10♠. Aces are low (A-2-3).
- **Deadwood** is every card that isn't part of a meld. It counts: kings, queens and jacks 10, aces 1, other cards their number.

Melds stay in your hand until the end of the hand. Group your cards yourself at any time, or press **Sort into melds** to find the arrangement with the least deadwood.

## Play

**The first turn:** the non-dealer may take the upcard. If they pass, the dealer may take it. If both pass, the non-dealer draws from the stock and play goes on as normal.

After that, on your turn:

- **Draw** the top card of the stock or the discard pile.
- **Discard** one card. Or, if your deadwood after discarding is 10 or less, you may **knock** instead to end the hand.

**Knocking:** the knocker shows their melds. The other player shows theirs and may **lay off** deadwood onto the knocker's melds, which then doesn't count against them. If the knocker has no deadwood at all, that's **gin**, and nobody may lay off.

**A drawn hand:** if only 2 cards are left in the stock and nobody has knocked, the hand is thrown in and nobody scores.

## Scoring

- **Knock:** the knocker scores the difference between the two players' deadwood.
- **Undercut:** if the other player's deadwood is equal to or less than the knocker's, they score the difference plus 25 instead.
- **Gin:** the knocker scores the other player's deadwood plus 25.

## Winning

The first player to reach the target score (100 unless the table chose otherwise) wins the game. Then the bonuses are added:

- **Game bonus:** 100 to the winner.
- **Box bonus:** 25 for every hand each player won.
- **Shutout:** if the loser didn't win a single hand, the winner's total is doubled.

## House rules

- **Play to:** 100 (the default), 150 or 250.
- **Gin bonus:** 25 (the default), 20 or 50.
- **Undercut bonus:** 25 (the default), 10 or 20.
- **Big gin** ("Not allowed" by default): a player whose 10 cards plus the card just drawn all form melds may go out at once without discarding, for a bonus of 31 or 50.
- **Oklahoma** (off by default): the first upcard sets the most deadwood you may knock with (a face card means 10). An ace upcard means you may only go out with gin. If the upcard is a spade, the hand's score is doubled.
- **Game bonus, box bonus and shutouts** (on by default): turn off to play with no end-of-game bonuses.
- **Aces in runs:** "Low (A-2-3)" (the default), or "High or low".
- **Allow "Sort into melds"** (on by default).

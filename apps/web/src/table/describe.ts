/** Words for moves: button labels, the game log and screen reader announcements. */
import type { BidValue, Move, PlayerView, PublicMove, ScoreEvent } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { cardFromId, shortLabel, spokenLabel, SUIT_SYMBOL, suitName } from './cards';
import { humanize, parseZoneKey } from './zones';

/** Display names by seat. */
export type SeatNames = (seat: number) => string;

export function seatNames(table: TableInfo | null, you: number | null): SeatNames {
  return (seat) => {
    if (seat === you) return 'You';
    return table?.seats.find((s) => s.seat === seat)?.user?.displayName ?? `Seat ${seat + 1}`;
  };
}

/** "3" or "Nil" or "Blind nil". */
export function bidLabel(value: BidValue): string {
  return typeof value === 'number' ? String(value) : humanize(value);
}

/** "Q♠" or "Queen of spades"; card ids always name their card. */
function cardText(id: string, spoken: boolean): string {
  const card = cardFromId(id);
  if (!card) return id;
  return spoken ? spokenLabel(card) : shortLabel(card);
}

function pileText(name: string): string {
  return `the ${humanize(name).toLowerCase()}`;
}

/** Words for a `choose` value: the game file's label if it has one. */
export type ChoiceLabels = Record<string, string>;

function choiceText(value: string, choices: ChoiceLabels): string {
  return Object.hasOwn(choices, value) ? (choices[value] as string) : humanize(value);
}

/** Label for a button that makes this move, e.g. "Play Q♠" or "Draw from the stock". */
export function moveLabel(move: Move, names: SeatNames, choices: ChoiceLabels = {}): string {
  switch (move.type) {
    case 'playToTrick':
      return `Play ${cardText(move.card, false)}`;
    case 'play':
      return `Play ${cardText(move.card, false)} to ${pileText(move.to)}`;
    case 'discard':
      return `Discard ${cardText(move.card, false)}`;
    case 'layOff': {
      const { name, seat } = parseZoneKey(move.meld.zone);
      const owner =
        seat === null ? pileText(name) : `${names(seat)}'s ${humanize(name).toLowerCase()}`;
      return `Lay ${cardText(move.card, false)} off on ${owner} (group ${move.meld.index + 1})`;
    }
    case 'draw':
      return `Draw from ${pileText(move.from)}`;
    case 'pickUpPile':
      if (move.cards) {
        return `Take ${pileText(move.from)}, melding its top card with ${move.cards
          .map((c) => cardText(c, false))
          .join(' ')}`;
      }
      if (move.meld) {
        return `Take ${pileText(move.from)}, adding its top card to meld ${move.meld.index + 1}`;
      }
      return `Pick up ${pileText(move.from)}`;
    case 'pass':
      return `Pass ${move.cards.length} card${move.cards.length === 1 ? '' : 's'}`;
    case 'meld':
      return `Meld ${move.cards.length} cards`;
    case 'bid':
      return `Bid ${bidLabel(move.value)}`;
    case 'passBid':
      return 'Pass';
    case 'declareTrump':
      return `${SUIT_SYMBOL[move.suit]} ${suitName(move.suit)} are trump`;
    case 'chooseSuit':
      return `${SUIT_SYMBOL[move.suit]} ${suitName(move.suit)}`;
    case 'choose':
      return choiceText(move.value, choices);
    case 'showHand':
      return move.card === null ? 'Go out' : `Go out, discarding ${cardText(move.card, false)}`;
    case 'arrange':
      return 'Arrange your cards';
    case 'sortHand':
      return 'Sort into melds';
    case 'lookAtHand':
      return 'Look at your cards';
    case 'endTurn':
      return 'End turn';
  }
}

/** A log line, e.g. "Raj played 9 of hearts". Uses spoken card names so it reads well aloud. */
export function describeMove(
  move: PublicMove,
  names: SeatNames,
  choices: ChoiceLabels = {},
): string {
  const who = names(move.player);
  const their = who === 'You' ? 'your' : 'their';
  if ('hidden' in move) {
    if (move.type === 'pass') return `${who} passed cards`;
    if (move.type === 'arrange') return `${who} arranged ${their} cards`;
    return `${who} ${move.type === 'play' ? 'played' : 'discarded'} a card face down`;
  }
  const card = (id: string) => cardText(id, true);
  switch (move.type) {
    case 'playToTrick':
      return `${who} played ${card(move.card)}`;
    case 'play':
      return `${who} played ${card(move.card)} to ${pileText(move.to)}`;
    case 'discard':
      return `${who} discarded ${card(move.card)}`;
    case 'layOff':
      return `${who} laid off ${card(move.card)}`;
    case 'draw':
      return `${who} drew from ${pileText(move.from)}`;
    case 'pickUpPile':
      if (move.cards) {
        return `${who} took ${pileText(move.from)}, melding its top card with ${move.cards
          .map(card)
          .join(', ')}`;
      }
      if (move.meld) {
        return `${who} took ${pileText(move.from)}, adding its top card to a meld`;
      }
      return `${who} picked up ${pileText(move.from)}`;
    case 'pass':
      return `${who} passed ${move.cards.map(card).join(', ')}`;
    case 'meld':
      return `${who} melded ${move.cards.map(card).join(', ')}`;
    case 'bid':
      return `${who} bid ${bidLabel(move.value).toLowerCase()}`;
    case 'passBid':
      return `${who} passed`;
    case 'declareTrump':
      return `${who} made ${move.suit} trump`;
    case 'chooseSuit':
      return `${who} chose ${move.suit}`;
    case 'choose':
      return `${who} chose: ${choiceText(move.value, choices)}`;
    case 'showHand':
      return move.card === null
        ? `${who} went out`
        : `${who} went out, discarding ${card(move.card)}`;
    case 'arrange':
      return `${who} arranged ${their} cards`;
    case 'sortHand':
      return `${who} sorted ${their} cards into melds`;
    case 'lookAtHand':
      return `${who} looked at ${their} cards`;
    case 'endTurn':
      return `${who} ended ${their} turn`;
  }
}

/** Points scored during a round, e.g. "Raj: Fifteen for 2". */
export function describeScore(event: ScoreEvent, names: SeatNames): string {
  const who = names(event.player);
  // Held points (such as meld) say so: they aren't in the score yet.
  const held = event.into ? ` (${humanize(event.into).toLowerCase()})` : '';
  return event.label
    ? `${who}: ${event.label} for ${event.points}${held}`
    : `${who} scored ${event.points}${held}`;
}

/**
 * The game log as lines of text, oldest first: every move worth telling
 * others about, with the points scored along the way placed after the move
 * that scored them.
 */
export function logLines(view: PlayerView, names: SeatNames): string[] {
  const scoredAfter = new Map<number, ScoreEvent[]>();
  for (const event of view.scoreEvents) {
    scoredAfter.set(event.at, [...(scoredAfter.get(event.at) ?? []), event]);
  }
  const scores = (at: number) => (scoredAfter.get(at) ?? []).map((e) => describeScore(e, names));
  const lines = scores(0);
  view.log.forEach((move, i) => {
    // Arranging cards isn't news for anyone else, so it stays out of the log.
    if (move.type !== 'arrange' && move.type !== 'sortHand') {
      lines.push(describeMove(move, names, view.choiceLabels));
    }
    lines.push(...scores(i + 1));
  });
  return lines;
}

/** "Ana" for a one-player team, otherwise "Team 1 (You & Sam)". */
export function teamName(team: { id: number; players: number[] }, names: SeatNames): string {
  const players = team.players.map(names);
  if (players.length === 1) return players[0] ?? `Team ${team.id + 1}`;
  return `Team ${team.id + 1} (${players.join(' & ')})`;
}

/**
 * A seat's stats for a phone "chip": a short line like "B3 · W1" (bid, tricks
 * won), showing only what the game has, and the same in full for screen readers.
 */
export function seatStats(
  player:
    { bid: BidValue | null; tricks: number; active: boolean; sittingOut?: boolean } | undefined,
  handCount: number | null,
  showTricks: boolean,
): { short: string | null; spoken: string } {
  const short: string[] = [];
  const spoken: string[] = [];
  if (player?.bid != null) {
    short.push(typeof player.bid === 'number' ? `B${player.bid}` : bidLabel(player.bid));
    spoken.push(`bid ${bidLabel(player.bid).toLowerCase()}`);
  }
  if (showTricks && player) {
    short.push(`W${player.tricks}`);
    spoken.push(`won ${player.tricks}`);
  }
  if (handCount !== null) spoken.push(`${handCount} card${handCount === 1 ? '' : 's'}`);
  if (player && !player.active) {
    short.push('Out');
    spoken.push('out');
  }
  if (player?.sittingOut) {
    short.push('Sits out');
    spoken.push('sitting out this hand');
  }
  return { short: short.length > 0 ? short.join(' · ') : null, spoken: spoken.join(', ') };
}

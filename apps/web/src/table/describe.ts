/** Words for moves: button labels, the game log and screen reader announcements. */
import type {
  BidValue,
  CardEvent,
  MomentEvent,
  Move,
  PlayerView,
  PublicMove,
  ScoreEvent,
  Suit,
} from '@card-table/engine';
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

/** Words the game file gives its bids, e.g. { "11": "1♣" } (`view.bidLabels`). */
export type BidLabels = Record<string, string>;

/** "3" or "Nil" or "Blind nil", or the game's own words for the bid ("1NT"). */
export function bidLabel(value: BidValue, labels: BidLabels = {}): string {
  const own = Object.hasOwn(labels, String(value)) ? labels[String(value)] : undefined;
  return own ?? (typeof value === 'number' ? String(value) : humanize(value));
}

/** A bid inside a sentence ("bid nil"); the game's own words keep their case ("bid 1NT"). */
export function bidWords(value: BidValue, labels: BidLabels = {}): string {
  return Object.hasOwn(labels, String(value))
    ? bidLabel(value, labels)
    : bidLabel(value).toLowerCase();
}

/**
 * A line of text in pieces, so the screen can draw cards and suits as pictures
 * while screen readers (and tests) get plain words: see `lineText`.
 */
export type Part = string | { card: string } | { suit: Suit };
export type Line = Part[];

/** A line from a template: line`${who} played ${card(id)}`. Values may be parts or lines. */
function line(strings: TemplateStringsArray, ...values: (Part | Line)[]): Line {
  const parts: Line = [];
  // Words next to each other join up into one piece.
  const add = (part: Part) => {
    const last = parts[parts.length - 1];
    if (typeof part === 'string' && typeof last === 'string') parts[parts.length - 1] = last + part;
    else if (part !== '') parts.push(part);
  };
  strings.forEach((text, i) => {
    add(text);
    const value = values[i];
    if (value === undefined) return;
    if (Array.isArray(value)) value.forEach(add);
    else add(value);
  });
  return parts;
}

/** Parts with a separator between them: "Q♠, 9♥". */
function joined(parts: Part[], separator = ', '): Line {
  return parts.flatMap((part, i) => (i === 0 ? [part] : [separator, part]));
}

/** A line as plain words: cards by their spoken names ("Queen of spades"), suits by name. */
export function lineText(parts: Line): string {
  return parts
    .map((part) =>
      typeof part === 'string' ? part : 'card' in part ? cardText(part.card, true) : part.suit,
    )
    .join('');
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
export function moveLabel(
  move: Move,
  names: SeatNames,
  choices: ChoiceLabels = {},
  bids: BidLabels = {},
): string {
  const label = ownMoveLabel(move, names, choices, bids);
  // Made for another seat (the dummy in bridge): say whose cards.
  return move.by === undefined ? label : `${label} for ${names(move.player)}`;
}

function ownMoveLabel(
  move: Move,
  names: SeatNames,
  choices: ChoiceLabels,
  bids: BidLabels,
): string {
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
      return `Bid ${bidLabel(move.value, bids)}`;
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
  bids: BidLabels = {},
): string {
  return lineText(moveLine(move, names, choices, bids));
}

/** A log line in pieces, so its cards and suits can be drawn. */
export function moveLine(
  move: PublicMove,
  names: SeatNames,
  choices: ChoiceLabels = {},
  bids: BidLabels = {},
): Line {
  // Made for another seat: "Ana (for Raj) played 9 of hearts".
  const who =
    'by' in move && move.by !== undefined
      ? `${names(move.by)} (for ${names(move.player)})`
      : names(move.player);
  const their = who === 'You' ? 'your' : 'their';
  if ('hidden' in move) {
    if (move.type === 'pass') return line`${who} passed cards`;
    if (move.type === 'arrange') return line`${who} arranged ${their} cards`;
    return line`${who} ${move.type === 'play' ? 'played' : 'discarded'} a card face down`;
  }
  const card = (id: string): Part => ({ card: id });
  switch (move.type) {
    case 'playToTrick':
      return line`${who} played ${card(move.card)}`;
    case 'play':
      return line`${who} played ${card(move.card)} to ${pileText(move.to)}`;
    case 'discard':
      return line`${who} discarded ${card(move.card)}`;
    case 'layOff':
      return line`${who} laid off ${card(move.card)}`;
    case 'draw':
      return line`${who} drew from ${pileText(move.from)}`;
    case 'pickUpPile':
      if (move.cards) {
        return line`${who} took ${pileText(move.from)}, melding its top card with ${joined(
          move.cards.map(card),
        )}`;
      }
      if (move.meld) {
        return line`${who} took ${pileText(move.from)}, adding its top card to a meld`;
      }
      return line`${who} picked up ${pileText(move.from)}`;
    case 'pass':
      return line`${who} passed ${joined(move.cards.map(card))}`;
    case 'meld':
      return line`${who} melded ${joined(move.cards.map(card))}`;
    case 'bid':
      return line`${who} bid ${bidWords(move.value, bids)}`;
    case 'passBid':
      return line`${who} passed`;
    case 'declareTrump':
      return line`${who} made ${{ suit: move.suit }} trump`;
    case 'chooseSuit':
      return line`${who} chose ${{ suit: move.suit }}`;
    case 'choose':
      return line`${who} chose: ${choiceText(move.value, choices)}`;
    case 'showHand':
      return move.card === null
        ? line`${who} went out`
        : line`${who} went out, discarding ${card(move.card)}`;
    case 'arrange':
      return line`${who} arranged ${their} cards`;
    case 'sortHand':
      return line`${who} sorted ${their} cards into melds`;
    case 'lookAtHand':
      return line`${who} looked at ${their} cards`;
    case 'endTurn':
      return line`${who} ended ${their} turn`;
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

/** Whose big moment it is: a player's or team's name, or null for the whole table. */
export function momentWho(
  moment: MomentEvent,
  view: { teams: readonly { id: number; players: number[] }[] },
  names: SeatNames,
): string | null {
  if (moment.player !== null) return names(moment.player);
  const team = moment.team === null ? undefined : view.teams[moment.team];
  return team ? teamName(team, names) : null;
}

/** A big moment's words: "Shot the moon!", with whose it is ("Raj: Shot the moon!"). */
export function momentText(
  moment: MomentEvent,
  view: { teams: readonly { id: number; players: number[] }[] },
  names: SeatNames,
): string {
  const who = momentWho(moment, view, names);
  return who ? `${who}: ${moment.label}` : moment.label;
}

/** The game log as plain text, oldest first (see `logEntries`). */
export function logLines(view: PlayerView, names: SeatNames): string[] {
  return logEntries(view, names).map(lineText);
}

/**
 * The game log in pieces, oldest first: every move worth telling others
 * about, with the points scored along the way (and any big moment) placed
 * after the move that made them.
 */
export function logEntries(view: PlayerView, names: SeatNames): Line[] {
  const scoredAfter = new Map<number, ScoreEvent[]>();
  for (const event of view.scoreEvents) {
    scoredAfter.set(event.at, [...(scoredAfter.get(event.at) ?? []), event]);
  }
  const cardsAfter = new Map<number, CardEvent[]>();
  for (const event of view.cardEvents) {
    cardsAfter.set(event.at, [...(cardsAfter.get(event.at) ?? []), event]);
  }
  const momentsAfter = new Map<number, MomentEvent[]>();
  for (const moment of view.moments) {
    momentsAfter.set(moment.at, [...(momentsAfter.get(moment.at) ?? []), moment]);
  }
  // What happened after the first `at` moves: points scored, cards turned up or given, then
  // big moments (last, so a screen reader hears them as the news).
  const scores = (at: number): Line[] => [
    ...(scoredAfter.get(at) ?? []).map((e) => [describeScore(e, names)]),
    ...(cardsAfter.get(at) ?? []).flatMap((e) => {
      const parts = cardsLine(e, names);
      return parts ? [parts] : [];
    }),
    ...(momentsAfter.get(at) ?? []).map((m) => [momentText(m, view, names)]),
  ];
  const lines = scores(0);
  view.log.forEach((move, i) => {
    // Arranging cards isn't news for anyone else, so it stays out of the log.
    if (move.type !== 'arrange' && move.type !== 'sortHand') {
      lines.push(moveLine(move, names, view.choiceLabels, view.bidLabels));
    }
    lines.push(...scores(i + 1));
  });
  return lines;
}

/**
 * "Turned up: Jack of hearts" or "Raj picked up Jack of hearts". A card turned up
 * where nobody could see it isn't news, so it has no line.
 */
export function describeCards(event: CardEvent, names: SeatNames): string | null {
  const parts = cardsLine(event, names);
  return parts && lineText(parts);
}

function cardsLine(event: CardEvent, names: SeatNames): Line | null {
  const cards = joined(event.cards.map((id) => ({ card: id })));
  if (event.kind === 'turnedUp') return cards.length > 0 ? line`Turned up: ${cards}` : null;
  const who = event.player === null ? 'Someone' : names(event.player);
  return cards.length > 0
    ? line`${who} picked up ${cards}`
    : line`${who} took ${pileText(event.zone)}`;
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
  bids: BidLabels = {},
): { short: string | null; spoken: string } {
  const short: string[] = [];
  const spoken: string[] = [];
  if (player?.bid != null) {
    const own = Object.hasOwn(bids, String(player.bid));
    short.push(
      typeof player.bid === 'number' && !own ? `B${player.bid}` : bidLabel(player.bid, bids),
    );
    spoken.push(`bid ${bidWords(player.bid, bids)}`);
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

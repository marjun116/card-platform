/**
 * What moved between two views of the table, worked out from the views alone
 * (card ids, zone keys and the new log entries), never from the game's name.
 *
 * A card that is drawn before and after simply glides from its old spot to its
 * new one; the screen finds both by its id. This works out the rest: where a
 * card that has just come into view came from, where one that has just left
 * went, and face-down cards that move without anyone here seeing them.
 */
import type { CardId, PlayerView, PublicMove, ZoneView } from '@card-table/engine';
import { parseZoneKey } from '../zones';

/** A place on the table a card can fly from or to. */
export type Anchor = { seat: number } | { zone: string };

export interface Arrival {
  from: Anchor;
  /** It was face down until now (flips over as it lands). */
  flip: boolean;
  /** In a deal, its turn: 0 for the first card dealt, 1 for the next, and so on. */
  slot?: number;
}

export interface Departure {
  to: Anchor;
  /** It turns face down where it is (euchre's upcard), instead of flying. */
  turnDown?: boolean;
}

/** Face-down cards going from one place to another. */
export interface Backs {
  from: Anchor;
  to: Anchor;
  count: number;
  /** In a deal, the first card's turn and how many turns apart the rest come (see Arrival). */
  slots?: { first: number; every: number };
}

export interface MotionPlan {
  /** A new round was dealt: cards fly out from the dealer, one seat at a time. */
  deal: boolean;
  /** Cards that have just come into view, by id: where they came from. */
  arrivals: Map<CardId, Arrival>;
  /** Cards that may just have gone from the table, by id: where they went. */
  departures: Map<CardId, Departure>;
  backs: Backs[];
}

export function emptyPlan(): MotionPlan {
  return { deal: false, arrivals: new Map(), departures: new Map(), backs: [] };
}

/** Where every card in the view is, by id: the key of its zone. */
export function cardPlaces(view: PlayerView): Map<CardId, string> {
  const places = new Map<CardId, string>();
  for (const [key, zone] of Object.entries(view.zones)) {
    for (const card of zoneCards(zone)) places.set(card, key);
  }
  return places;
}

function zoneCards(zone: ZoneView): CardId[] {
  switch (zone.kind) {
    case 'cards':
      return zone.cards.map((c) => c.id);
    case 'melds':
      return zone.melds.flat().map((c) => c.id);
    case 'count':
      return zone.top ? [zone.top.id] : [];
    case 'hidden':
      return [];
  }
}

/** The seat a zone belongs to, or null for a shared or team zone. */
function zoneSeat(key: string): number | null {
  return parseZoneKey(key).seat;
}

/** Made by you, or by you for another seat (bridge's dummy). */
export function isYours(move: PublicMove, you: number): boolean {
  return move.player === you || ('by' in move && move.by === you);
}

/** The card ids a move names. */
function movedCards(move: PublicMove): CardId[] {
  if ('hidden' in move) return [];
  switch (move.type) {
    case 'play':
    case 'playToTrick':
    case 'discard':
    case 'layOff':
      return [move.card];
    case 'pass':
    case 'meld':
      return move.cards;
    case 'pickUpPile':
      return move.cards ?? [];
    case 'showHand':
      return move.card === null ? [] : [move.card];
    default:
      return [];
  }
}

/** Where a move takes cards from, if it takes them from a pile. */
function takesFrom(move: PublicMove): string | null {
  if ('hidden' in move) return null;
  return move.type === 'draw' || move.type === 'pickUpPile' ? move.from : null;
}

/** The key of zone `name` as seen in this view: shared ("stock") or the seat's own ("stock@2"). */
function zoneKeyIn(view: PlayerView, name: string, seat: number): string | null {
  if (name in view.zones) return name;
  const own = `${name}@${seat}`;
  return own in view.zones ? own : null;
}

function cardCount(zone: ZoneView | undefined): number {
  if (!zone) return 0;
  if (zone.kind === 'cards') return zone.cards.length;
  if (zone.kind === 'melds') return zone.melds.flat().length;
  if (zone.kind === 'count') return zone.count;
  return 0;
}

/** Was a new round dealt between these two views? */
export function newRound(prev: PlayerView, next: PlayerView): boolean {
  return next.roundStart !== prev.roundStart || next.round !== prev.round;
}

/** A round dealt with nothing played yet, e.g. the first view of a new game. */
export function freshDeal(view: PlayerView): boolean {
  return view.status === 'inProgress' && view.log.length === view.roundStart;
}

/**
 * Everything flying out from the dealer, one card to each seat in turn starting
 * on the dealer's left: your cards turning over, other hands as backs, then any
 * cards turned up on the table.
 */
export function dealPlan(view: PlayerView): MotionPlan {
  const plan = emptyPlan();
  plan.deal = true;
  const dealer = { seat: view.dealer };
  const seats = view.players.length;
  const turn = (seat: number) => (seat - view.dealer - 1 + seats * 2) % seats;
  let mine = 0;
  let longest = 0;
  const turnedUp: CardId[] = [];
  for (const [card, key] of cardPlaces(view)) {
    const seat = zoneSeat(key);
    if (seat === view.you) {
      plan.arrivals.set(card, { from: dealer, flip: true, slot: mine * seats + turn(seat) });
      mine++;
    } else if (seat === null) {
      turnedUp.push(card);
    }
  }
  longest = mine;
  for (const player of view.players) {
    if (player.id === view.you) continue;
    const hand = view.zones[`hand@${player.id}`];
    const count = hand?.kind === 'count' ? hand.count : 0;
    longest = Math.max(longest, count);
    if (count > 0) {
      const slots = { first: turn(player.id), every: seats };
      plan.backs.push({ from: dealer, to: { seat: player.id }, count, slots });
    }
  }
  turnedUp.forEach((card, i) => {
    plan.arrivals.set(card, { from: dealer, flip: true, slot: longest * seats + i });
  });
  return plan;
}

/** What moved from `prev` to `next`. */
export function planMotion(prev: PlayerView, next: PlayerView): MotionPlan {
  if (newRound(prev, next)) return dealPlan(next);
  const plan = emptyPlan();
  if (next.log.length < prev.log.length) return plan;
  const added = next.log.slice(prev.log.length);
  const you = next.you;
  const before = cardPlaces(prev);
  const after = cardPlaces(next);

  // Passes: yours go to whoever gets them, and the cards you get come from whoever sent them.
  for (const pass of next.passes) {
    const was = prev.passes.find((p) => p.from === pass.from && p.to === pass.to);
    if (pass.from === you && !was) {
      for (const card of pass.cards) plan.departures.set(card, { to: { seat: pass.to } });
    }
    if (pass.to === you && pass.delivered && !was?.delivered) {
      for (const card of pass.cards)
        plan.arrivals.set(card, { from: { seat: pass.from }, flip: true });
    }
  }

  // Cards that have just come into view.
  for (const [card, key] of after) {
    if (before.has(card) || plan.arrivals.has(card)) continue;
    const arrival = arrivalOf(card, key, added, prev, next);
    if (arrival) plan.arrivals.set(card, arrival);
  }

  // A finished trick is swept to whoever won it once it leaves the table.
  for (const trick of [prev.trick, prev.lastTrick]) {
    if (!trick || trick.winner === null) continue;
    for (const play of trick.plays) {
      if (play.card) plan.departures.set(play.card.id, { to: { seat: trick.winner } });
    }
  }

  // Cards that have gone out of view.
  for (const [card, key] of before) {
    if (after.has(card) || plan.departures.has(card)) continue;
    const departure = departureOf(card, key, added, next);
    if (departure) plan.departures.set(card, departure);
  }

  // Face-down cards moving where nobody here can see them.
  for (const move of added) {
    if (isYours(move, you)) continue;
    const from = takesFrom(move);
    if (from !== null) {
      const key = zoneKeyIn(prev, from, move.player);
      const pile = key ? prev.zones[key] : undefined;
      // Face-up cards taken from it are already flying, as departures.
      const shownGone = pile && zoneCards(pile).some((card) => !after.has(card));
      if (key && !shownGone && zoneSeat(key) !== move.player) {
        const taken = Math.max(1, cardCount(pile) - cardCount(next.zones[key]));
        plan.backs.push({ from: { zone: key }, to: { seat: move.player }, count: taken });
      }
    }
    if ('hidden' in move && move.type !== 'pass' && move.type !== 'arrange') {
      const key = zoneKeyIn(next, move.to, move.player);
      if (key) plan.backs.push({ from: { seat: move.player }, to: { zone: key }, count: 1 });
    }
  }
  return plan;
}

/** Where a card that has just come into view came from, if anywhere worth showing. */
function arrivalOf(
  card: CardId,
  key: string,
  added: PublicMove[],
  prev: PlayerView,
  next: PlayerView,
): Arrival | null {
  const you = next.you;
  const owner = zoneSeat(key);
  // Someone put it down from their hand (a play, a discard, a meld).
  const put = added.find((move) => movedCards(move).includes(card));
  if (put && !isYours(put, you)) return { from: { seat: put.player }, flip: true };
  // You (or the seat you play for) took it from a face-down pile.
  if (owner !== null) {
    for (const move of added) {
      const from = takesFrom(move);
      if (from === null || move.player !== owner) continue;
      const pile = zoneKeyIn(prev, from, owner);
      if (pile) return { from: { zone: pile }, flip: true };
    }
  }
  // Turned over where it lies (the top of a face-down pile, an upcard).
  const was = prev.zones[key];
  if (was?.kind === 'count' && was.count > 0 && !was.top) {
    return { from: { zone: key }, flip: true };
  }
  return null;
}

/** Where a card that has just gone out of view went, if anywhere worth showing. */
function departureOf(
  card: CardId,
  key: string,
  added: PublicMove[],
  next: PlayerView,
): Departure | null {
  // Someone took it into their hand.
  for (const move of added) {
    const from = takesFrom(move);
    if (from !== null && zoneKeyIn(next, from, move.player) === key && move.player !== next.you) {
      return { to: { seat: move.player } };
    }
  }
  // It's still there, but face down now.
  const zone = next.zones[key];
  if (zone?.kind === 'count' && zone.count > 0 && !zone.top)
    return { to: { zone: key }, turnDown: true };
  return null;
}

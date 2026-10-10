/**
 * Bots for the built-in games: which play style each game uses (see the
 * engine's bots/) and how it bids. Rules of thumb, not expert play. Bots see
 * only their own view, like a person in their seat.
 */
import {
  type Bot,
  type BotInput,
  type BotPart,
  bidNearest,
  type Card,
  choose,
  combineBots,
  discardLowest,
  estimateTricks,
  handOf,
  lookFirst,
  lowestBid,
  type Move,
  passHigh,
  passLow,
  strongestTrump,
  type Suit,
  SUITS,
  trickPlay,
  type TrickRules,
  trickRules,
} from '@card-table/engine';
import type { BuiltInGameName } from './index';

const suited = (card: Card): card is Extract<Card, { suit: Suit }> => 'suit' in card;

/** The trick rules with a trump the bot is considering (before trump is named). */
function rulesWithTrump(input: BotInput, trump: Suit | null): TrickRules {
  return { ...trickRules(input.file, input.view), trump };
}

/** A bot part for one phase of the game only. */
function inPhase(phase: string, part: BotPart): BotPart {
  return (input) => (input.view.phase === phase ? part(input) : null);
}

const pass: BotPart = ({ legal }) => legal.find((m) => m.type === 'passBid') ?? null;

// ---- spades ----

/** Bid the tricks the hand should take; nil with almost nothing. */
const spadesBid: BotPart = (input) => {
  if (!input.legal.some((m) => m.type === 'bid')) return null;
  const tricks = estimateTricks(
    trickRules(input.file, input.view),
    handOf(input.view, input.view.you),
  );
  if (tricks < 0.8) {
    const nil = input.legal.find((m) => m.type === 'bid' && m.value === 'nil');
    if (nil) return nil;
  }
  // The estimate counts only sure tricks; a partnership takes about one more each.
  return bidNearest(input, Math.max(1, Math.round(tricks + 0.8)));
};

// ---- hearts ----

const heartsPoints = (card: Card) =>
  suited(card)
    ? card.suit === 'hearts'
      ? 1
      : card.rank === 'Q' && card.suit === 'spades'
        ? 13
        : 0
    : 0;

// ---- euchre ----

/** Tricks a euchre hand should take with this trump. */
function euchreTricks(input: BotInput, trump: Suit | null): number {
  return estimateTricks(rulesWithTrump(input, trump), handOf(input.view, input.view.you));
}

/** Order up (or pick up) the turned card with a hand worth 3 tricks; otherwise pass. */
const euchreOrderUp: BotPart = inPhase('orderUp', (input) => {
  const upcard = input.view.zones.upcard;
  const top = upcard?.kind === 'cards' ? upcard.cards[upcard.cards.length - 1] : undefined;
  const trump = top && suited(top) ? top.suit : null;
  // The dealer gets the turned card too.
  const bonus = input.view.dealer === input.view.you ? 0.5 : 0;
  if (euchreTricks(input, trump) + bonus >= 2.5) return choose('orderUp', 'pickUp')(input);
  return choose('pass')(input);
});

/** Second round: name the best suit if it's worth 3 tricks (or the dealer is stuck). */
const euchreNameTrump: BotPart = inPhase('nameTrump', (input) => {
  const best = strongestTrump(input);
  const suit = best?.type === 'declareTrump' ? best.suit : null;
  if (best && euchreTricks(input, suit) >= 2.5) return best;
  return choose('pass')(input) ?? best;
});

const euchreGoAlone: BotPart = inPhase('goAlone', (input) => {
  const trump = typeof input.view.vars.trump === 'string' ? (input.view.vars.trump as Suit) : null;
  return euchreTricks(input, trump) >= 4.2 ? choose('alone')(input) : choose('withPartner')(input);
});

// ---- Oh Hell ----

const ohHellBid: BotPart = (input) => {
  if (!input.legal.some((m) => m.type === 'bid')) return null;
  const tricks = estimateTricks(
    trickRules(input.file, input.view),
    handOf(input.view, input.view.you),
  );
  return bidNearest(input, Math.round(tricks));
};

// ---- pinochle ----

/**
 * Bid the lowest bid on offer while the hand is worth it: aces, tens and a
 * long suit (the likely trump), with kings and queens for marriages.
 */
const pinochleBid: BotPart = (input) => {
  const bid = lowestBid(input);
  if (!bid || bid.type !== 'bid') return null;
  const hand = handOf(input.view, input.view.you).filter(suited);
  const count = (rank: string) => hand.filter((c) => c.rank === rank).length;
  const longest = Math.max(...SUITS.map((s) => hand.filter((c) => c.suit === s).length));
  const strength = count('A') * 2 + count('10') + count('K') + count('Q') + longest * 1.5;
  const limit = 20 + Math.max(0, strength - 14) * 2;
  // Classic scoring bids in tens of points.
  const scale = Number(bid.value) >= 100 ? 10 : 1;
  if (Number(bid.value) <= limit * scale) return bid;
  return pass(input) ?? bid;
};

// ---- bridge ----

const HCP: Record<string, number> = { A: 4, K: 3, Q: 2, J: 1 };
/** Suits as bridge numbers them in bids: 1 ♣, 2 ♦, 3 ♥, 4 ♠ (5 is no trump). */
const STRAIN: Record<Suit, number> = { clubs: 1, diamonds: 2, hearts: 3, spades: 4 };

/**
 * A simple bidding system: open with 13+ high-card points (1NT with a
 * balanced 15–17), raise partner's suit with 3 cards, bidding game with about
 * 26 points between you, overcall a 5-card suit with 12+, otherwise pass.
 */
const bridgeBid: BotPart = (input) => {
  const { view, legal } = input;
  if (!legal.some((m) => m.type === 'bid' || m.type === 'passBid')) return null;
  const me = view.you;
  const partner = (me + 2) % 4;
  const hand = handOf(view, me).filter(suited);
  const hcp = hand.reduce((sum, c) => sum + (HCP[c.rank] ?? 0), 0);
  const length = (strain: number) => hand.filter((c) => STRAIN[c.suit] === strain).length;
  const lengths = [1, 2, 3, 4].map(length);
  const balanced = lengths.every((n) => n >= 2) && lengths.filter((n) => n === 2).length <= 1;
  // The longest suit, majors first on a tie.
  const longest = [4, 3, 1, 2].reduce((a, b) => (length(b) > length(a) ? b : a));

  const bidOf = (value: number) => legal.find((m) => m.type === 'bid' && m.value === value) ?? null;
  const cheapest = (strain: number) =>
    legal
      .filter(
        (m): m is Extract<Move, { type: 'bid' }> => m.type === 'bid' && typeof m.value === 'number',
      )
      .find((m) => Number(m.value) % 10 === strain) ?? null;
  const passing = pass(input);

  const calls = view.log
    .slice(view.roundStart)
    .flatMap((m) =>
      m.type === 'bid' && typeof m.value === 'number' ? [{ player: m.player, value: m.value }] : [],
    );
  const mine = calls.filter((c) => c.player === me);
  const theirs = calls.filter((c) => c.player === partner);
  const contract = typeof view.vars.contract === 'number' ? view.vars.contract : null;

  if (contract === null) {
    if (hcp >= 15 && hcp <= 17 && balanced) return bidOf(15) ?? passing;
    if (hcp >= 13) return cheapest(longest) ?? passing;
    return passing;
  }

  const ourSide = view.vars.declTeam === view.players[me]?.team;
  const level = (value: number) => Math.floor(value / 10);
  if (ourSide) {
    const last = theirs[theirs.length - 1];
    // Our side's bid is our own: let partner speak.
    if (!last || mine.length >= 2) return passing;
    const strain = last.value % 10;
    // Points between us: an opening bid shows about 13, a later bid about 8.
    const partnerOpened = calls.find((c) => c.player % 2 === me % 2)?.player === partner;
    const total = hcp + (partnerOpened ? 13 : 8);
    if (strain !== 5 && length(strain) >= 3 && hcp >= 6) {
      const game = strain >= 3 ? 4 : 5;
      const target = total >= 26 ? game : total >= 22 ? 3 : 2;
      const value = target * 10 + strain;
      return value > contract ? (bidOf(value) ?? passing) : passing;
    }
    if (strain === 5) return hcp >= 10 && 35 > contract ? (bidOf(35) ?? passing) : passing;
    if (hcp >= 10 && mine.length === 0) {
      const own = length(longest) >= 5 ? cheapest(longest) : null;
      if (own && own.type === 'bid' && level(Number(own.value)) <= 2) return own;
      if (total >= 25 && 35 > contract) return bidOf(35) ?? passing;
    }
    return passing;
  }

  // The other side has the contract.
  if (mine.length === 0 && hcp >= 12 && length(longest) >= 5) {
    const overcall = cheapest(longest);
    if (overcall && overcall.type === 'bid' && level(Number(overcall.value)) <= 2) return overcall;
  }
  const double = legal.find((m) => m.type === 'bid' && m.value === 'double');
  if (double && level(contract) >= 4 && hcp >= 14) return double;
  return passing;
};

// ---- the bots ----

/** The bot for each built-in game. */
export const builtInBots: Partial<Record<BuiltInGameName, Bot>> = {
  spades: combineBots(lookFirst, spadesBid, trickPlay({ aim: 'bid' })),
  hearts: combineBots(
    passHigh({ aim: 'fewest', points: heartsPoints }),
    trickPlay({ aim: 'fewest', points: heartsPoints }),
    choose('othersGet26'),
  ),
  euchre: combineBots(
    euchreOrderUp,
    euchreNameTrump,
    euchreGoAlone,
    choose('pass'),
    discardLowest,
    trickPlay({ aim: 'most' }),
  ),
  'oh-hell': combineBots(lookFirst, ohHellBid, trickPlay({ aim: 'bid' })),
  pinochle: combineBots(
    pinochleBid,
    strongestTrump,
    inPhase('passToBidder', passHigh({ aim: 'most' })),
    inPhase('passBack', passLow),
    choose('showMeld', 'play'),
    trickPlay({ aim: 'most' }),
  ),
  bridge: combineBots(bridgeBid, trickPlay({ aim: 'most' })),
};

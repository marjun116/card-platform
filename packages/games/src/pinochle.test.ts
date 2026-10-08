/**
 * Scenario tests for pinochle.json: the rules a real table would check.
 * Seats: the dealer D, then L (left of the dealer, first to bid), L1, L2.
 * Partners sit opposite, so team = seat % 2.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
} from '@card-table/engine';
import { draft, id, play, restartPhase, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const pinochle = builtInGames.pinochle;
type Options = Record<string, OptionValue>;

const PHASES = pinochle.phases.map((p) => p.name);
const phase = (state: GameState) => PHASES[state.cursor.phase];

const bid = (player: number, value: number): Move => ({ player, type: 'bid', value });
const pass = (player: number): Move => ({ player, type: 'passBid' });
const trump = (player: number, suit: 'clubs' | 'diamonds' | 'hearts' | 'spades'): Move => ({
  player,
  type: 'declareTrump',
  suit,
});
const showMeld = (player: number): Move => ({ player, type: 'choose', value: 'showMeld' });
const card = (player: number, spec: string): Move => ({
  player,
  type: 'playToTrick',
  card: id(spec),
});
const bidsOffered = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).flatMap((m) => (m.type === 'bid' ? [m.value] : []));
const playable = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).flatMap((m) => (m.type === 'playToTrick' ? [m.card] : []));

/** Every card in the pinochle deck, both copies. */
const DECK = ['clubs', 'diamonds', 'hearts', 'spades'].flatMap((suit) =>
  ['9', '10', 'J', 'Q', 'K', 'A'].flatMap((rank) => {
    const code = `${rank}${suit[0]?.toUpperCase()}`;
    return [code, `${code}.1`];
  }),
);

function start(options: Options = {}) {
  const state = createGame(pinochle, options, 4, 'pinochle');
  const D = state.dealer;
  return { state, D, L: (D + 1) % 4, L1: (D + 2) % 4, L2: (D + 3) % 4 };
}

/** Gives these seats exactly these 12 cards, and deals the rest to the others. */
function withHands(state: GameState, hands: Record<number, string[]>): GameState {
  const taken = new Set(Object.values(hands).flat().map(id));
  const rest = DECK.filter((c) => !taken.has(id(c)));
  const zones: Record<string, string[]> = {};
  for (let seat = 0; seat < 4; seat++) {
    zones[`hand@${seat}`] = hands[seat] ?? rest.splice(0, 12);
  }
  return withZones(state, zones);
}

/**
 * Jumps to the play phase with these hands (the rest of the cards go to team
 * 0's won pile unless listed for team 1), bidder, bid and trump.
 */
function atPlay(
  state: GameState,
  setting: { bidder: number; bid: number; trump: string; hands: Record<number, string[]> },
  won1: string[] = [],
): GameState {
  const zones: Record<string, string[]> = { 'won@t1': won1 };
  for (const [seat, cards] of Object.entries(setting.hands)) zones[`hand@${seat}`] = cards;
  const next = draft(withZones(state, zones, 'won@t0'));
  next.vars.bidder = setting.bidder;
  next.vars.bidTeam = setting.bidder % 2;
  next.vars.highBid = setting.bid;
  next.vars.trump = setting.trump;
  next.cursor.phase = PHASES.indexOf('play');
  next.roundMoves = 1;
  return restartPhase(next);
}

/** atPlay at the last trick, with each team's meld held and tricks won so far. */
function lastTrick(
  state: GameState,
  setting: Parameters<typeof atPlay>[1] & { meld: [number, number]; tricks: [number, number] },
  won1: string[] = [],
): GameState {
  const next = draft(atPlay(state, setting, won1));
  next.cursor.tricks = 11;
  if (next.trick) next.trick.number = 12;
  next.teams.forEach((t, i) => {
    t.held = { meld: setting.meld[i] ?? 0 };
    t.tricks = setting.tricks[i] ?? 0;
  });
  return next;
}

describe('Pinochle: the auction', () => {
  it('bids go up, and a player who passes is out', () => {
    const { state, L, L1, L2, D } = start();
    expect(bidsOffered(state, L)).toEqual(Array.from({ length: 41 }, (_, i) => 20 + i));
    const a = play(state, bid(L, 20), pass(L1));
    expect(bidsOffered(a, L2)[0]).toBe(21);
    const b = play(a, bid(L2, 23), pass(D));
    // L1 passed, so the turn goes from L straight to L2.
    expect(b.cursor.current).toBe(L);
    const c = play(b, bid(L, 25));
    expect(c.cursor.current).toBe(L2);
    const d = play(c, pass(L2));
    expect(phase(d)).toBe('trump');
    expect(d.vars).toMatchObject({ bidder: L, highBid: 25, bidTeam: L % 2 });
    expect(getLegalMoves(d, L).map((m) => m.type)).toEqual(Array(4).fill('declareTrump'));
  });

  it('makes the dealer bid when everyone else passes', () => {
    const { state, L, L1, L2, D } = start();
    const stuck = play(state, pass(L), pass(L1), pass(L2));
    expect(getLegalMoves(stuck, D).some((m) => m.type === 'passBid')).toBe(false);
    const bidding = applyMove(stuck, bid(D, 20));
    expect(phase(bidding)).toBe('trump');
    expect(bidding.vars.bidder).toBe(D);
  });

  it('deals again when everyone passes, with that house rule', () => {
    const { state, L, L1, L2, D } = start({ dealerMustBid: false });
    const redeal = play(state, pass(L), pass(L1), pass(L2), pass(D));
    expect(redeal.round).toBe(2);
    expect(redeal.teams.map((t) => t.score)).toEqual([0, 0]);
  });

  it('bids in tens with classic scoring', () => {
    const { state, L } = start({ classic: true, minBid: 25 });
    const offered = bidsOffered(state, L);
    expect(offered[0]).toBe(250);
    expect(offered[1]).toBe(260);
    expect(offered.at(-1)).toBe(600);
  });
});

describe('Pinochle: trump and passing', () => {
  it('passes 4 cards to the bidder, who passes 4 back after seeing them', () => {
    const { state, L, L1, L2, D } = start();
    const named = play(state, pass(L), bid(L1, 20), pass(L2), pass(D), trump(L1, 'hearts'));
    expect(named.vars.trump).toBe('hearts');
    expect(phase(named)).toBe('passToBidder');
    // Only the bidder's partner (D, across from L1) passes now.
    expect(getLegalMoves(named, L)).toEqual([]);
    const toBidder = getLegalMoves(named, D)[0] as Extract<Move, { type: 'pass' }>;
    expect(toBidder.cards).toHaveLength(4);
    const passed = applyMove(named, toBidder);
    expect(phase(passed)).toBe('passBack');
    expect(passed.zones[`hand@${L1}`]).toHaveLength(16);
    expect(passed.zones[`hand@${D}`]).toHaveLength(8);
    // The bidder may pass back any 4, including cards just received.
    const back = getLegalMoves(passed, L1);
    expect(back).toContainEqual({ player: L1, type: 'pass', cards: [...toBidder.cards].sort() });
    const done = applyMove(passed, back[0] as Move);
    expect(phase(done)).toBe('meld');
    expect(done.zones[`hand@${L1}`]).toHaveLength(12);
  });

  it('skips passing with that house rule off', () => {
    const { state, L, L1, L2, D } = start({ passing: false });
    const named = play(state, bid(L, 20), pass(L1), pass(L2), pass(D), trump(L, 'spades'));
    expect(phase(named)).toBe('meld');
  });
});

describe('Pinochle: meld', () => {
  /** Bids, names trump and shows the bidder's meld with this hand. */
  function meldOf(hand: string[], suit: 'clubs' | 'diamonds' | 'hearts' | 'spades', options = {}) {
    const { state, L, L1, L2, D } = start({ passing: false, ...options });
    const dealt = withHands(state, { [L]: hand });
    const before = play(dealt, bid(L, 20), pass(L1), pass(L2), pass(D), trump(L, suit));
    const after = applyMove(before, showMeld(L));
    const shown = after.scoreEvents.slice(before.scoreEvents.length);
    return {
      melds: Object.fromEntries(
        shown.map((e): [string, number] => [e.label ?? '', e.points]),
      ) as Record<string, number>,
      held: after.teams[L % 2]?.held.meld,
      score: after.teams[L % 2]?.score,
      into: shown.map((e) => e.into),
    };
  }

  it('counts a run, an extra royal marriage, a marriage, the dix and a pinochle', () => {
    const hand = ['AH', '10H', 'KH', 'QH', 'JH', 'KH.1', 'QH.1', '9H', 'KS', 'QS', 'JD', 'AS'];
    const { melds, held, score, into } = meldOf(hand, 'hearts');
    expect(melds).toEqual({ Run: 15, 'Royal marriage': 4, Marriage: 2, Dix: 1, Pinochle: 4 });
    // Meld is held until the hand is scored.
    expect(held).toBe(26);
    expect(score).toBe(0);
    expect(new Set(into)).toEqual(new Set(['meld']));
  });

  it("doesn't count a run's king and queen as a royal marriage", () => {
    const hand = ['AH', '10H', 'KH', 'QH', 'JH', '9C', '9C.1', '9D', '9D.1', '9S', '9S.1', 'JC'];
    expect(meldOf(hand, 'hearts').melds).toEqual({ Run: 15 });
  });

  it('counts doubled melds', () => {
    const hand = ['AS', 'AS.1', 'AH', 'AH.1', 'AD', 'AD.1', 'AC', 'AC.1', 'KS', 'KH', 'KD', 'KC'];
    expect(meldOf(hand, 'clubs').melds).toEqual({ 'Double aces around': 100, 'Kings around': 8 });
    const pinochles = [
      'QS',
      'QS.1',
      'JD',
      'JD.1',
      'QH',
      'QD',
      'QC',
      'JS',
      'JH',
      'JC',
      '9C',
      '9C.1',
    ];
    expect(meldOf(pinochles, 'clubs').melds).toEqual({
      'Double pinochle': 30,
      'Queens around': 6,
      'Jacks around': 4,
      Dix: 2,
    });
    const runs = [
      'AD',
      'AD.1',
      '10D',
      '10D.1',
      'KD',
      'KD.1',
      'QD',
      'QD.1',
      'JD',
      'JD.1',
      '9S',
      '9C',
    ];
    expect(meldOf(runs, 'diamonds').melds).toEqual({ 'Double run': 150 });
  });

  it('multiplies meld by 10 with classic scoring', () => {
    const hand = ['AH', '10H', 'KH', 'QH', 'JH', 'KH.1', 'QH.1', '9H', 'KS', 'QS', 'JD', 'AS'];
    const { state, L, L1, L2, D } = start({ passing: false, classic: true });
    const dealt = withHands(state, { [L]: hand });
    const after = play(dealt, bid(L, 250), pass(L1), pass(L2), pass(D), trump(L, 'hearts'));
    expect(applyMove(after, showMeld(L)).teams[L % 2]?.held.meld).toBe(260);
  });
});

describe('Pinochle: playing the tricks', () => {
  const { L, L1, L2, D } = start();
  // The same seed deals the same dealer, so the seats stay the same.
  const at = (hands: Record<number, string[]>, options: Options = {}) =>
    atPlay(start(options).state, {
      bidder: L,
      bid: 20,
      trump: 'hearts',
      hands,
    });

  it('lets the bidder lead', () => {
    const s = at({ [L]: ['KS'], [L1]: ['9S'], [L2]: ['9C'], [D]: ['9D'] });
    expect(s.cursor.current).toBe(L);
  });

  it('makes you beat the trick when you can', () => {
    const s = applyMove(
      at({ [L]: ['KS'], [L1]: ['9S', 'AS', '9H'], [L2]: ['9C'], [D]: ['9D'] }),
      card(L, 'KS'),
    );
    expect(playable(s, L1)).toEqual([id('AS')]);
  });

  it("lets you play any card of the suit when you can't beat it", () => {
    const s = applyMove(
      at({ [L]: ['AS'], [L1]: ['9S', 'KS', 'AH'], [L2]: ['9C'], [D]: ['9D'] }),
      card(L, 'AS'),
    );
    expect(playable(s, L1).sort()).toEqual([id('9S'), id('KS')].sort());
  });

  it("makes you trump when you can't follow suit, and overtrump when you can", () => {
    const s = applyMove(
      at({
        [L]: ['AS', '9C.1', '9C'],
        [L1]: ['KH', '9D', 'QC'],
        [L2]: ['9H', 'AH', 'JC'],
        [D]: ['9H.1', 'QH', 'JD'],
      }),
      card(L, 'AS'),
    );
    expect(playable(s, L1)).toEqual([id('KH')]);
    const trumped = applyMove(s, card(L1, 'KH'));
    // L2 must beat the king of trump with the ace.
    expect(playable(trumped, L2)).toEqual([id('AH')]);
    const over = applyMove(trumped, card(L2, 'AH'));
    // D can't beat the ace, but must still play trump.
    expect(playable(over, D).sort()).toEqual([id('9H.1'), id('QH')].sort());
  });

  it('gives the trick to the first of two identical cards', () => {
    const s = applyMove(
      at({ [L]: ['AS', '9C'], [L1]: ['AS.1', '9S'], [L2]: ['9S.1', 'JC'], [D]: ['KS', 'JD'] }),
      card(L, 'AS'),
    );
    // The second ace doesn't beat the first, so any spade will do.
    expect(playable(s, L1).sort()).toEqual([id('AS.1'), id('9S')].sort());
    const done = play(s, card(L1, 'AS.1'), card(L2, '9S.1'), card(D, 'KS'));
    expect(done.lastTrick?.winner).toBe(L);
  });

  it("doesn't make you beat the trick with that house rule off", () => {
    const s = applyMove(
      at({ [L]: ['KS'], [L1]: ['9S', 'AS', '9H'], [L2]: ['9C'], [D]: ['9D'] }, { mustBeat: false }),
      card(L, 'KS'),
    );
    expect(playable(s, L1).sort()).toEqual([id('9S'), id('AS')].sort());
  });
});

describe('Pinochle: scoring the hand', () => {
  /**
   * The last trick: the bidder L leads the A♥ (trump) and wins it. Team 1 has
   * already won A♠ 10♠ K♠; team 0 everything else. Counters: 21 + the last
   * trick for team 0, 3 for team 1.
   */
  function finish(
    bidderTeam: 0 | 1,
    setting: { bid: number; meld: [number, number]; tricks: [number, number] },
    options: Options = {},
    won1 = ['AS', '10S', 'KS'],
    scores: [number, number] = [0, 0],
  ) {
    const game = start(options);
    const seats = [game.L, game.L1, game.L2, game.D];
    // The bidder is a player of the given team; team 0 is whichever team holds seat 0.
    const bidder = seats.find((s) => s % 2 === bidderTeam) as number;
    const others = seats.filter((s) => s !== bidder);
    const s = draft(
      lastTrick(
        game.state,
        {
          bidder,
          trump: 'hearts',
          hands: {
            [bidder]: ['AH'],
            [others[0] as number]: ['9C'],
            [others[1] as number]: ['9D'],
            [others[2] as number]: ['9S.1'],
          },
          ...setting,
        },
        won1,
      ),
    );
    s.teams.forEach((t, i) => (t.score = scores[i] ?? 0));
    const order = [bidder, ...others].sort(
      (a, b) => ((a - bidder + 4) % 4) - ((b - bidder + 4) % 4),
    );
    const cards: Record<number, string> = {
      [bidder]: 'AH',
      [others[0] as number]: '9C',
      [others[1] as number]: '9D',
      [others[2] as number]: '9S.1',
    };
    return play(s, ...order.map((seat) => card(seat, cards[seat] as string)));
  }
  const points = (s: GameState) => s.history.at(-1)?.teams.map((t) => t.points);

  it('gives the bidding team meld and counters when they make the bid', () => {
    const done = finish(0, { bid: 40, meld: [20, 10], tricks: [8, 3] });
    expect(points(done)).toEqual([20 + 22, 10 + 3]);
    expect(done.history.at(-1)?.teams.map((t) => t.held.meld)).toEqual([20, 10]);
  });

  it('takes the bid off a bidding team that falls short', () => {
    expect(points(finish(0, { bid: 50, meld: [20, 10], tricks: [8, 3] }))).toEqual([-50, 13]);
  });

  it("doesn't count meld for a team that took no tricks", () => {
    expect(points(finish(0, { bid: 40, meld: [20, 10], tricks: [11, 0] }, {}, []))).toEqual([
      45, 0,
    ]);
  });

  it('works for the bidding team being team 1', () => {
    // Team 1 has won every other card, and takes the last trick: all 25 points.
    const lastCards = new Set(['AH', '9C', '9D', '9S.1']);
    const won1 = DECK.filter((c) => !lastCards.has(c));
    expect(points(finish(1, { bid: 30, meld: [10, 5], tricks: [3, 8] }, {}, won1))).toEqual([
      10,
      5 + 25,
    ]);
  });

  it('counts cards the classic way', () => {
    // Team 1 has A♠ 10♠ K♠ = 25; team 0 the other 215 and 10 for the last trick.
    const done = finish(0, { bid: 400, meld: [200, 100], tricks: [8, 3] }, { classic: true });
    expect(points(done)).toEqual([200 + 225, 100 + 25]);
  });

  it('lets the bidding team win when both teams pass the target', () => {
    const done = finish(0, { bid: 20, meld: [0, 20], tricks: [8, 3] }, {}, undefined, [140, 145]);
    expect(done.teams.map((t) => t.score)).toEqual([162, 168]);
    expect(done.status).toBe('over');
    expect(done.winners.every((seat) => seat % 2 === 0)).toBe(true);
  });

  it('lets the other team win when the bidding team is set', () => {
    const done = finish(0, { bid: 60, meld: [0, 20], tricks: [8, 3] }, {}, undefined, [140, 145]);
    expect(done.status).toBe('over');
    expect(done.winners.every((seat) => seat % 2 === 1)).toBe(true);
  });

  it('lets the bidder throw in the hand, losing the bid, with that house rule', () => {
    const { state, L, L1, L2, D } = start({ passing: false, throwIn: true });
    const melded = play(
      state,
      bid(L, 25),
      pass(L1),
      pass(L2),
      pass(D),
      trump(L, 'spades'),
      showMeld(L),
      showMeld(L1),
      showMeld(L2),
      showMeld(D),
    );
    expect(phase(melded)).toBe('throwIn');
    const held = melded.teams.map((t) => t.held.meld ?? 0);
    const thrown = applyMove(melded, { player: L, type: 'choose', value: 'throwIn' });
    expect(thrown.round).toBe(2);
    const result = thrown.history.at(-1)?.teams.map((t) => t.points) ?? [];
    expect(result[L % 2]).toBe(-25);
    expect(result[L1 % 2]).toBe(held[L1 % 2]);
  });
});

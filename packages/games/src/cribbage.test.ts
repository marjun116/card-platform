/**
 * Scenario tests for cribbage.json: the rules a real table would check.
 * Two-player tests call the dealer's opponent P (the pone, who plays first)
 * and the dealer D.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
  viewFor,
} from '@card-table/engine';
import { draft, id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const cribbage = builtInGames.cribbage;
type Options = Record<string, OptionValue>;

const toCrib = (player: number, spec: string): Move => ({
  player,
  type: 'discard',
  card: id(spec),
  to: 'crib',
});
const peg = (player: number, spec: string): Move => ({
  player,
  type: 'play',
  card: id(spec),
  to: 'pegging',
});
const cut = (player: number): Move => ({ player, type: 'draw', from: 'stock' });
const countHand = (player: number): Move => ({ player, type: 'choose', value: 'countHand' });
const countCrib = (player: number): Move => ({ player, type: 'pickUpPile', from: 'crib' });

const phase = (state: GameState) => state.file.phases[state.cursor.phase]?.name;
const score = (state: GameState, seat: number) =>
  state.teams[state.players[seat]?.team ?? -1]?.score;

/** The points scored in this round, as [seat, label, points]. */
const events = (state: GameState, round = state.round) =>
  state.scoreEvents.filter((e) => e.round === round).map((e) => [e.player, e.label, e.points]);

/**
 * A two-player hand with these cards: each hand's first cards are the ones it
 * keeps, the rest go to the crib. `starter` is the card the dealer turns up.
 */
function deal(
  hands: { P: string[]; D: string[] },
  starter: string,
  options: Options = {},
): { state: GameState; P: number; D: number } {
  const start = createGame(cribbage, options, 2, 'scenario');
  const D = start.dealer;
  const P = 1 - D;
  const state = withStarter(
    withZones(start, { [`hand@${P}`]: hands.P, [`hand@${D}`]: hands.D }, 'stock'),
    starter,
  );
  return { state, P, D };
}

/** Puts the starter on top of the stock, where the dealer will turn it up. */
function withStarter(state: GameState, spec: string): GameState {
  const next = draft(state);
  const stock = next.zones.stock ?? [];
  const index = stock.findIndex((c) => c.id === id(spec));
  if (index < 0) throw new Error(`${spec} isn't in the stock`);
  stock.push(...stock.splice(index, 1));
  return next;
}

/** Discards the last cards of each hand (as listed in `deal`) and turns up the starter. */
function discardAndCut(
  state: GameState,
  P: number,
  D: number,
  discards: { P: string[]; D: string[] },
) {
  const moves = [
    ...discards.P.map((c) => toCrib(P, c)),
    ...discards.D.map((c) => toCrib(D, c)),
    cut(D),
  ];
  return play(state, ...moves);
}

/** Makes each player's first legal move until the game reaches this phase (or ends). */
function playUntil(state: GameState, name: string): GameState {
  let s = state;
  for (let guard = 0; s.status === 'inProgress' && phase(s) !== name; guard++) {
    if (guard > 200) throw new Error(`Never reached ${name}`);
    const seat = s.cursor.current;
    const move = getLegalMoves(s, seat)[0];
    if (!move) throw new Error(`Seat ${seat} has no move in ${phase(s)}`);
    s = applyMove(s, move);
  }
  return s;
}

describe('Cribbage: the deal and the crib', () => {
  it('deals 6 each to two players, who put 2 each in the crib', () => {
    const state = createGame(cribbage, {}, 2, 'deal');
    const P = state.cursor.current;
    const D = state.dealer;
    expect(P).not.toBe(D);
    expect(state.zones[`hand@${P}`]).toHaveLength(6);
    // The pone puts two cards in the crib, then the dealer does.
    const moves = getLegalMoves(state, P);
    expect(moves).toHaveLength(6);
    expect(moves.every((m) => m.type === 'discard' && m.to === 'crib')).toBe(true);
    const s = play(state, moves[0] as Move);
    expect(s.cursor.current).toBe(P);
    const both = playUntil(s, 'cut');
    expect(both.zones.crib).toHaveLength(4);
    expect(both.zones[`hand@${P}`]).toHaveLength(4);
    expect(both.zones[`hand@${D}`]).toHaveLength(4);
    // Nobody can see the crib.
    expect(viewFor(both, D).zones.crib).toEqual({ kind: 'count', count: 4, top: null });
  });

  it('deals 5 each to three players, with a card from the deck in the crib', () => {
    const state = createGame(cribbage, {}, 3, 'deal3');
    expect(state.zones['hand@0']).toHaveLength(5);
    expect(state.zones.crib).toHaveLength(1);
    const cutting = playUntil(state, 'cut');
    expect(cutting.zones.crib).toHaveLength(4);
    for (const seat of [0, 1, 2]) expect(cutting.zones[`hand@${seat}`]).toHaveLength(4);
  });

  it('plays four players as two partnerships', () => {
    const state = createGame(cribbage, {}, 4, 'deal4');
    expect(state.teams.map((t) => t.players)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(state.zones['hand@0']).toHaveLength(5);
    expect(playUntil(state, 'cut').zones.crib).toHaveLength(4);
  });

  it('turns up the starter after the crib is made, scoring his heels for a jack', () => {
    const { state, P, D } = deal(
      { P: ['2H', '3H', '4H', '5H', '6H', '7H'], D: ['2S', '3S', '4S', '5S', '6S', '7S'] },
      'JC',
    );
    expect(state.zones.starter).toEqual([]);
    const cutDone = discardAndCut(state, P, D, { P: ['6H', '7H'], D: ['6S', '7S'] });
    expect(cutDone.zones.starter?.map((c) => c.id)).toEqual([id('JC')]);
    expect(events(cutDone)).toEqual([[D, 'His heels', 2]]);
    expect(phase(cutDone)).toBe('play');
    expect(cutDone.cursor.current).toBe(P);

    const off = deal(
      { P: ['2H', '3H', '4H', '5H', '6H', '7H'], D: ['2S', '3S', '4S', '5S', '6S', '7S'] },
      'JC',
      { hisHeels: false },
    );
    expect(
      events(discardAndCut(off.state, off.P, off.D, { P: ['6H', '7H'], D: ['6S', '7S'] })),
    ).toEqual([]);
  });
});

describe('Cribbage: the play', () => {
  it('scores fifteens, runs in any order and 31, then starts the count again', () => {
    const { state, P, D } = deal(
      { P: ['4S', '5C', '7C', '9D', '2H', '2D'], D: ['6H', '3D', '6S', 'KD', '8H', '8D'] },
      'QC',
    );
    const s = discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8H', '8D'] });
    expect(viewFor(s, P).display).toEqual([{ label: 'Count', value: 0 }]);

    // 4, then 6 (10), then 5 (15, and 4-6-5 is a run).
    const a = play(s, peg(P, '4S'), peg(D, '6H'), peg(P, '5C'));
    expect(events(a)).toEqual([
      [P, 'Fifteen', 2],
      [P, 'Run', 3],
    ]);
    expect(viewFor(a, D).display).toEqual([{ label: 'Count', value: 15 }]);
    // The 3 (18) makes a run of 3-4-5-6, the 7 (25) one of 3-4-5-6-7.
    const b = play(a, peg(D, '3D'), peg(P, '7C'));
    expect(events(b).slice(2)).toEqual([
      [D, 'Run', 4],
      [P, 'Run', 5],
    ]);
    // 25 + 6 = 31: two points, no go, and the count starts again with the pone.
    const c = play(b, peg(D, '6S'));
    expect(events(c).slice(4)).toEqual([[D, 'Thirty-one', 2]]);
    expect(c.vars.total).toBe(0);
    expect(c.zones.pegging).toEqual([]);
    expect(c.cursor.current).toBe(P);
    // The cards played so far are back in front of their players.
    expect(c.zones[`played@${P}`]).toHaveLength(3);
    expect(c.zones[`played@${D}`]).toHaveLength(3);

    // 9 then K (19): the last card scores 1.
    const d = play(c, peg(P, '9D'), peg(D, 'KD'));
    expect(events(d).slice(5)).toEqual([[D, 'Last card', 1]]);
    expect(phase(d)).toBe('show');
    expect(viewFor(d, P).display).toEqual([]);
  });

  it('only allows cards that keep the count at 31 or less', () => {
    const { state, P, D } = deal(
      { P: ['KH', 'KS', '9C', 'AC', '2H', '2D'], D: ['KD', '8H', '2C', '3S', '8C', '8D'] },
      'QC',
    );
    const s = play(
      discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8C', '8D'] }),
      peg(P, 'KH'),
      peg(D, 'KD'),
      peg(P, 'KS'),
    );
    // 30: the dealer has nothing small enough, so play passes to the pone, who has the ace.
    expect(s.cursor.current).toBe(P);
    expect(getLegalMoves(s, P)).toEqual([peg(P, 'AC')]);
  });

  it('scores pairs, three of a kind, a go, and the last card', () => {
    const { state, P, D } = deal(
      { P: ['KH', 'KS', '9C', '4C', '2H', '2D'], D: ['KD', '8H', '2C', '3S', '8C', '8D'] },
      'QC',
    );
    const s = discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8C', '8D'] });
    // K, K (pair), K (three of a kind) makes 30. Nobody can play: a go for the pone.
    const a = play(s, peg(P, 'KH'), peg(D, 'KD'), peg(P, 'KS'));
    expect(events(a)).toEqual([
      [D, 'Pair', 2],
      [P, 'Three of a kind', 6],
      [P, 'Go', 1],
    ]);
    // The dealer, who didn't play last, starts the new count.
    expect(a.cursor.current).toBe(D);
    expect(a.vars.total).toBe(0);
    // 8, 9, 2, 4, 3: the last three (2-4-3) make a run.
    const b = play(a, peg(D, '8H'), peg(P, '9C'), peg(D, '2C'), peg(P, '4C'), peg(D, '3S'));
    expect(events(b).slice(3)).toEqual([
      [D, 'Run', 3],
      [D, 'Last card', 1],
    ]);
  });

  it('keeps playing alone after a go', () => {
    const { state, P, D } = deal(
      { P: ['KH', 'QS', 'AC', '2C', '2H', '2D'], D: ['KD', '9H', '9S', '9C', '8C', '8D'] },
      '5D',
    );
    const s = discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8C', '8D'] });
    // K, K (pair) is 20, Q makes 30. The dealer's 9s can't go, so the pone
    // plays the ace (31) without waiting for a turn.
    const a = play(s, peg(P, 'KH'), peg(D, 'KD'), peg(P, 'QS'));
    expect(a.cursor.current).toBe(P);
    const b = play(a, peg(P, 'AC'));
    expect(events(b)).toEqual([
      [D, 'Pair', 2],
      [P, 'Thirty-one', 2],
    ]);
    expect(b.cursor.current).toBe(D);
  });

  it('with three players, the player after the last one to play starts the next count', () => {
    const start = createGame(cribbage, {}, 3, 'three');
    const C = start.dealer;
    const A = (C + 1) % 3;
    const B = (C + 2) % 3;
    const dealt = withStarter(
      withZones(
        start,
        {
          [`hand@${A}`]: ['KH', '5H', '6H', '7H', 'AD'],
          [`hand@${B}`]: ['QS', '2S', '9S', '9D', 'AS'],
          [`hand@${C}`]: ['8C', '3C', '4C', '10C', 'AH'],
          crib: ['AC'],
        },
        'stock',
      ),
      'KD',
    );
    const s = play(dealt, toCrib(A, 'AD'), toCrib(B, 'AS'), toCrib(C, 'AH'), cut(C));
    expect(s.cursor.current).toBe(A);
    // K, Q, 8 is 28. A can't play; B's 2 makes 30; then nobody can play: B's go.
    const a = play(s, peg(A, 'KH'), peg(B, 'QS'), peg(C, '8C'));
    expect(a.cursor.current).toBe(B);
    const b = play(a, peg(B, '2S'));
    expect(events(b)).toEqual([[B, 'Go', 1]]);
    // C, on B's left, starts the next count.
    expect(b.cursor.current).toBe(C);
  });
});

describe('Cribbage: the show', () => {
  /** Plays a hand through to the show with these kept cards and starter. */
  function toShow(P: string[], D: string[], starter: string, options: Options = {}) {
    const dealt = deal({ P: [...P, '2C', '3C'], D: [...D, 'AD', 'AH'] }, starter, options);
    const s = discardAndCut(dealt.state, dealt.P, dealt.D, { P: ['2C', '3C'], D: ['AD', 'AH'] });
    return { ...dealt, state: playUntil(s, 'show') };
  }
  /** The show's points for a seat, by label. */
  const shown = (before: GameState, after: GameState, seat: number): Record<string, number> =>
    Object.fromEntries(
      after.scoreEvents
        .slice(before.scoreEvents.length)
        .filter((e) => e.player === seat)
        .map((e): [string, number] => [e.label ?? '', e.points]),
    );

  it('counts the 29 hand', () => {
    const { state, P } = toShow(['5H', '5C', '5S', 'JD'], ['KH', 'QH', '9S', '8S'], '5D');
    const after = applyMove(state, countHand(P));
    expect(shown(state, after, P)).toEqual({ Fifteens: 16, Pairs: 12, Nobs: 1 });
  });

  it('counts a double run', () => {
    // 3-3-4-5 and a K: fifteens 3+3+4+5 and 5+K, a pair, and two runs of three.
    const { state, P } = toShow(['3H', '3S', '4C', '5D'], ['KH', 'QH', '9S', '8S'], 'KS');
    const after = applyMove(state, countHand(P));
    expect(shown(state, after, P)).toEqual({ Fifteens: 4, Pairs: 2, Runs: 6 });
  });

  it('counts a flush in hand, with or without the starter', () => {
    const hand = ['2H', '4H', '6H', '8H'];
    const dealer = ['KS', 'QS', '9S', '7C'];
    const five = toShow(hand, dealer, 'QH');
    expect(shown(five.state, applyMove(five.state, countHand(five.P)), five.P).Flush).toBe(5);
    const four = toShow(hand, dealer, 'QC');
    expect(shown(four.state, applyMove(four.state, countHand(four.P)), four.P).Flush).toBe(4);
    const strict = toShow(hand, dealer, 'QC', { handFlushFive: true });
    expect(
      shown(strict.state, applyMove(strict.state, countHand(strict.P)), strict.P).Flush,
    ).toBeUndefined();
  });

  it('only counts a crib flush with the starter, unless the house rule allows four', () => {
    const crib = (starter: string, options: Options = {}) => {
      const dealt = deal(
        { P: ['KS', 'QS', '9S', '8C', '2H', '4H'], D: ['KD', 'QD', '9D', '7C', '6H', '8H'] },
        starter,
        options,
      );
      const s = playUntil(
        discardAndCut(dealt.state, dealt.P, dealt.D, { P: ['2H', '4H'], D: ['6H', '8H'] }),
        'crib',
      );
      return shown(s, applyMove(s, countCrib(dealt.D)), dealt.D)['Crib flush'];
    };
    expect(crib('KH')).toBe(5);
    expect(crib('3C')).toBeUndefined();
    expect(crib('3C', { cribFourFlush: true })).toBe(4);
  });

  it('scores nobs for the jack of the starter suit', () => {
    const { state, P } = toShow(['JS', '2H', '4C', '6D'], ['KH', 'QH', '9S', '8S'], '10S');
    expect(shown(state, applyMove(state, countHand(P)), P).Nobs).toBe(1);
  });

  it('counts the pone, then the dealer, then the crib', () => {
    const { state, P, D } = toShow(['5H', '5C', '5S', 'JD'], ['KH', 'QH', '9S', '8S'], '5D');
    expect(state.cursor.current).toBe(P);
    expect(getLegalMoves(state, D)).toEqual([]);
    const a = applyMove(state, countHand(P));
    expect(a.cursor.current).toBe(D);
    const b = applyMove(a, countHand(D));
    expect(phase(b)).toBe('crib');
    expect(getLegalMoves(b, D)).toEqual([countCrib(D)]);
    const c = applyMove(b, countCrib(D));
    // The crib is turned over for everyone to see, and a new hand is dealt.
    expect(c.history).toHaveLength(1);
    expect(c.round).toBe(2);
  });
});

describe('Cribbage: winning', () => {
  it('lets the pone win in the show before the dealer counts', () => {
    const { state, P, D } = (() => {
      const dealt = deal(
        { P: ['5H', '5C', '5S', 'JD', '2C', '3C'], D: ['KH', 'QH', '9S', '8S', 'AD', 'AH'] },
        '5D',
      );
      const s = discardAndCut(dealt.state, dealt.P, dealt.D, { P: ['2C', '3C'], D: ['AD', 'AH'] });
      return { ...dealt, state: playUntil(s, 'show') };
    })();
    const close = draft(state);
    (close.teams[P] as { score: number }).score = 110;
    (close.teams[D] as { score: number }).score = 120;
    const over = applyMove(close, countHand(P));
    expect(over.status).toBe('over');
    expect(over.winners).toEqual([P]);
    // Fifteens took the pone past 121; the pairs and nobs were never counted.
    expect(events(over).at(-1)).toEqual([P, 'Fifteens', 16]);
    expect(over.notes).toEqual([]);
  });

  it('ends the moment someone pegs out, noting a skunk', () => {
    const { state, P, D } = deal(
      { P: ['KH', 'KS', '9C', '4C', '2H', '2D'], D: ['KD', '8H', '2C', '3S', '8C', '8D'] },
      'QC',
    );
    const s = draft(discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8C', '8D'] }));
    (s.teams[D] as { score: number }).score = 119;
    (s.teams[P] as { score: number }).score = 70;
    const over = play(s, peg(P, 'KH'), peg(D, 'KD'));
    expect(over.status).toBe('over');
    expect(over.winners).toEqual([D]);
    expect(score(over, D)).toBe(121);
    expect(over.notes).toEqual(['Skunk!']);
    expect(over.history.at(-1)?.round).toBe(1);
  });

  it('notes a double skunk', () => {
    const { state, P, D } = deal(
      { P: ['KH', 'KS', '9C', '4C', '2H', '2D'], D: ['KD', '8H', '2C', '3S', '8C', '8D'] },
      'QC',
    );
    const s = draft(discardAndCut(state, P, D, { P: ['2H', '2D'], D: ['8C', '8D'] }));
    (s.teams[D] as { score: number }).score = 119;
    (s.teams[P] as { score: number }).score = 60;
    expect(play(s, peg(P, 'KH'), peg(D, 'KD')).notes).toEqual(['Double skunk!']);
  });
});

describe('Cribbage: five-card cribbage', () => {
  it('deals 5, keeps 3, and gives the pone three for last', () => {
    const state = createGame(cribbage, { fiveCard: true, targetScore: 61 }, 2, 'five');
    const P = state.cursor.current;
    const D = state.dealer;
    expect(state.zones[`hand@${P}`]).toHaveLength(5);
    const cutting = playUntil(state, 'cut');
    expect(cutting.zones[`hand@${P}`]).toHaveLength(3);
    expect(cutting.zones.crib).toHaveLength(4);
    expect(events(cutting)).toEqual([[P, 'Three for last', 3]]);
    expect(score(cutting, D)).toBe(0);
  });

  it('is ignored with more than two players', () => {
    const state = createGame(cribbage, { fiveCard: true }, 3, 'five3');
    const cutting = playUntil(state, 'cut');
    expect(cutting.zones['hand@0']).toHaveLength(4);
    expect(events(cutting)).toEqual([]);
  });
});

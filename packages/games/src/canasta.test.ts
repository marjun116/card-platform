/**
 * Scenario tests for canasta.json: the rules a real table would check.
 * Four-player tests call the player left of the dealer L (who plays first),
 * then L1, L2 and the dealer D. Partners sit opposite: team = seat % 2.
 */
import {
  applyMove,
  createGame,
  type GameState,
  getLegalMoves,
  type Move,
  type OptionValue,
} from '@card-table/engine';
import { card, draft, id, onTop, play, restartPhase, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const canasta = builtInGames.canasta;
type Options = Record<string, OptionValue>;

const draw = (player: number): Move => ({ player, type: 'draw', from: 'stock' });
const discard = (player: number, spec: string): Move => ({
  player,
  type: 'discard',
  card: id(spec),
  to: 'discard',
});
const arrange = (player: number, ...groups: string[][]): Move => ({
  player,
  type: 'arrange',
  groups: groups.map((g) => g.map(id)),
});
const choose = (player: number, value: string): Move => ({ player, type: 'choose', value });
const movesOf = (state: GameState, seat: number, type: Move['type']) =>
  getLegalMoves(state, seat).filter((m) => m.type === type);

function start(players = 4, options: Options = {}) {
  const state = createGame(canasta, options, players, 'canasta');
  const D = state.dealer;
  const seat = (n: number) => (D + n) % players;
  return { state, D, L: seat(1), L1: seat(2), L2: seat(3) };
}

/**
 * Sets hands, the discard pile (bottom first), team melds and values; every
 * card used comes out of wherever it was, and the rest stay in the stock.
 * `stockTop` lists the next cards drawn, first one first.
 */
function table(
  state: GameState,
  setting: {
    hands?: Record<number, string[]>;
    discard?: string[];
    melds?: Record<number, string[][]>;
    stockTop?: string[];
    vars?: Record<string, boolean | number | null>;
    scores?: Record<number, number>;
  },
): GameState {
  const zones: Record<string, string[]> = { discard: setting.discard ?? [] };
  for (const [seat, cards] of Object.entries(setting.hands ?? {})) zones[`hand@${seat}`] = cards;
  const next = draft(withZones(state, zones, 'stock'));
  const meldCards = new Set(
    Object.values(setting.melds ?? {})
      .flat(2)
      .map(id),
  );
  for (const key of Object.keys(next.zones)) {
    next.zones[key] = (next.zones[key] ?? []).filter((c) => !meldCards.has(c.id));
  }
  for (const [team, melds] of Object.entries(setting.melds ?? {})) {
    next.melds[`melds@t${team}`] = melds.map((m) => m.map(card));
  }
  Object.assign(next.vars, { frozen: false, ...setting.vars });
  for (const [team, score] of Object.entries(setting.scores ?? {})) {
    (next.teams[Number(team)] as { score: number }).score = score;
  }
  return onTop(next, 'stock', setting.stockTop ?? []);
}

const isRedThree = (c: { id: string }) => /^3[HD]\./.test(c.id);

describe('Canasta: the deal', () => {
  it('deals 11 to four players in partnerships, 13 to three and 15 to two', () => {
    const four = start(4).state;
    expect(four.teams.map((t) => t.players)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(four.zones['hand@0']).toHaveLength(11);
    expect(start(3).state.zones['hand@0']).toHaveLength(13);
    expect(start(2).state.zones['hand@0']).toHaveLength(15);
    expect(four.zones.stock?.length).toBeGreaterThan(50);
  });

  it('lays down red 3s from the deal and replaces them', () => {
    // Over many deals some players are dealt red 3s; nobody ever holds one.
    let laid = 0;
    for (let i = 0; i < 30; i++) {
      const s = createGame(canasta, {}, 4, `deal-${i}`);
      for (const seat of [0, 1, 2, 3]) {
        expect(s.zones[`hand@${seat}`]).toHaveLength(11);
        expect(s.zones[`hand@${seat}`]?.some(isRedThree)).toBe(false);
      }
      laid += (s.zones['redThrees@t0']?.length ?? 0) + (s.zones['redThrees@t1']?.length ?? 0);
    }
    expect(laid).toBeGreaterThan(0);
  });

  it('starts the pile frozen when the turned card is wild, covering it', () => {
    for (let i = 0; i < 60; i++) {
      const s = createGame(canasta, {}, 4, `flip-${i}`);
      const pile = s.zones.discard ?? [];
      const top = pile[pile.length - 1];
      const coverable = (c: { id: string }) => /^(JOKER|2[CDHS]|3[HD])/.test(c.id);
      expect(top && coverable(top)).toBe(false);
      expect(s.vars.frozen).toBe(pile.length > 1);
    }
  });
});

describe('Canasta: drawing', () => {
  it('lays down a red 3 drawn from the stock and draws another card', () => {
    const { state, L } = start();
    const s = table(state, { stockTop: ['3H', '5C'] });
    const after = applyMove(s, draw(L));
    expect(after.zones[`redThrees@t${L % 2}`]?.map((c) => c.id)).toContain(id('3H'));
    expect(after.zones[`hand@${L}`]?.map((c) => c.id)).toContain(id('5C'));
    expect(after.zones[`hand@${L}`]).toHaveLength(12);
  });

  it('draws 2 with two players, or with the house rule', () => {
    const two = start(2);
    expect(applyMove(two.state, draw(two.L)).zones[`hand@${two.L}`]).toHaveLength(17);
    const four = start(4, { drawTwo: true });
    expect(applyMove(four.state, draw(four.L)).zones[`hand@${four.L}`]).toHaveLength(13);
  });

  it('freezes the pile when a wild card is discarded', () => {
    const { state, L } = start();
    const s = table(state, {
      hands: { [L]: ['2C', '5H', '6H'] },
      discard: ['9S'],
      stockTop: ['8D'],
    });
    const after = play(s, draw(L), discard(L, '2C'));
    expect(after.vars.frozen).toBe(true);
  });
});

describe('Canasta: taking the discard pile', () => {
  const takes = (s: GameState, seat: number) => movesOf(s, seat, 'pickUpPile');

  it('needs two natural cards matching the top card while the pile is frozen', () => {
    const { state, L } = start();
    const hand = ['7H', '7D', 'JOKER.0', 'AS', 'AH', 'AD', 'KC', '4S', '5S', '6S', '9S'];
    // Frozen for L's team, which hasn't melded. 7+7+7 = 15, plus the aces (60) grouped.
    const s = applyMove(
      table(state, { hands: { [L]: hand }, discard: ['4H', '7S'] }),
      arrange(L, ['AS', 'AH', 'AD']),
    );
    const options = takes(s, L);
    expect(options).toEqual([
      { player: L, type: 'pickUpPile', from: 'discard', cards: [id('7H'), id('7D')] },
    ]);
  });

  it('allows a wild card with one natural, or adding to a meld, once unfrozen', () => {
    const { state, L } = start();
    const s = table(state, {
      hands: { [L]: ['7H', 'JOKER.0', 'KC', 'QC'] },
      discard: ['4H', '7S'],
      melds: { [L % 2]: [['7C', '7C.1', '7D']] },
    });
    const options = takes(s, L).map((m) => (m.type === 'pickUpPile' ? (m.cards ?? m.meld) : null));
    expect(options).toContainEqual([id('7H'), id('JOKER.0')]);
    expect(options).toContainEqual({ zone: `melds@t${L % 2}`, index: 0 });
    expect(options).toHaveLength(2);
  });

  it("can't be taken with a wild card or black 3 on top", () => {
    const { state, L } = start();
    const hand = ['3C', '3S', '2H', '2D', 'AS', 'AH', 'AD', '5S', '6S', '8S', '9S'];
    for (const top of ['2C', 'JOKER.1', '3S.1']) {
      const s = table(state, {
        hands: { [L]: hand },
        discard: ['4H', top],
        melds: { [L % 2]: [['KC', 'KD', 'KH']] },
      });
      expect(takes(s, L)).toEqual([]);
    }
  });

  it('melds the top card, gives the rest of the pile to the player, and thaws the pile', () => {
    const { state, L } = start();
    const s = table(state, {
      hands: { [L]: ['7H', '7D', '5C', '6C'] },
      discard: ['4H', '9D', '7S'],
      melds: { [L % 2]: [['KC', 'KD', 'KH']] },
      vars: { frozen: true },
    });
    const after = applyMove(s, {
      player: L,
      type: 'pickUpPile',
      from: 'discard',
      cards: [id('7H'), id('7D')],
    });
    expect(
      after.melds[`melds@t${L % 2}`]
        ?.at(-1)
        ?.map((c) => c.id)
        .sort(),
    ).toEqual([id('7H'), id('7D'), id('7S')].sort());
    expect(after.zones[`hand@${L}`]?.map((c) => c.id).sort()).toEqual(
      [id('5C'), id('6C'), id('4H'), id('9D')].sort(),
    );
    expect(after.zones.discard).toEqual([]);
    expect(after.vars.frozen).toBe(false);
  });
});

describe("Canasta: a team's first meld", () => {
  const hand = ['KH', 'KD', 'KS', '5S', '5H', '5D', 'AS', 'AH', 'AD', '9C', '8C'];

  it('must reach 50 points with a score of 0', () => {
    const { state, L } = start();
    const s = play(table(state, { hands: { [L]: hand }, stockTop: ['4C'] }), draw(L));
    // Kings (30) and fives (15): 45 isn't enough.
    const short = applyMove(s, arrange(L, ['KH', 'KD', 'KS'], ['5S', '5H', '5D']));
    expect(movesOf(short, L, 'choose')).toEqual([]);
    expect(movesOf(short, L, 'meld')).toEqual([]);
    // With the aces (60) too: 105.
    const enough = applyMove(
      s,
      arrange(L, ['KH', 'KD', 'KS'], ['5S', '5H', '5D'], ['AS', 'AH', 'AD']),
    );
    expect(movesOf(enough, L, 'choose')).toEqual([choose(L, 'layDown')]);
    const down = applyMove(enough, choose(L, 'layDown'));
    expect(down.melds[`melds@t${L % 2}`]).toHaveLength(3);
    // After that, melds go down one at a time.
    expect(down.zones[`hand@${L}`]).toHaveLength(3);
  });

  it('needs 15 with a negative score, 90 from 1,500 and 120 from 3,000', () => {
    const { state, L } = start();
    const fives = arrange(L, ['5S', '5H', '5D']);
    const kingsAces = arrange(L, ['KH', 'KD', 'KS'], ['AS', 'AH', 'AD']);
    const can = (score: number, groups: Move) => {
      const s = play(
        table(state, { hands: { [L]: hand }, stockTop: ['4C'], scores: { [L % 2]: score } }),
        draw(L),
        groups,
      );
      return movesOf(s, L, 'choose').length > 0;
    };
    expect(can(-20, fives)).toBe(true);
    expect(can(0, fives)).toBe(false);
    expect(can(1500, kingsAces)).toBe(true); // 90
    expect(can(3000, kingsAces)).toBe(false); // 90 < 120
  });

  it('counts the top card of the pile, and lays down the other melds with it', () => {
    const { state, L } = start();
    const s = table(state, { hands: { [L]: hand }, discard: ['4H', 'KC'] });
    // K+K+K = 30 with the pile's king; with the aces grouped too, 90.
    expect(movesOf(s, L, 'pickUpPile')).toEqual([]);
    const grouped = applyMove(s, arrange(L, ['AS', 'AH', 'AD']));
    // Any two of the three kings will do.
    expect(movesOf(grouped, L, 'pickUpPile')).toHaveLength(3);
    const after = applyMove(grouped, {
      player: L,
      type: 'pickUpPile',
      from: 'discard',
      cards: [id('KH'), id('KD')],
    });
    const melds = after.melds[`melds@t${L % 2}`]?.map((m) =>
      m.map((c) => c.id.slice(0, 1)).join(''),
    );
    expect(melds).toEqual(['KKK', 'AAA']);
  });
});

describe('Canasta: melds', () => {
  const meldsOffered = (cards: string[], options: Options = {}) => {
    const { state, L } = start(4, options);
    const s = play(
      table(state, {
        hands: { [L]: [...cards, '9C', '8C'] },
        melds: { [L % 2]: [['KC', 'KD', 'KH']] },
        stockTop: ['4C'],
      }),
      draw(L),
      arrange(L, cards),
    );
    return movesOf(s, L, 'meld').length;
  };

  it('needs 2 natural cards and at most 3 wild cards', () => {
    expect(meldsOffered(['7H', '7D', '2C'])).toBe(1);
    expect(meldsOffered(['7H', '7D', '2C', '2D', 'JOKER.0'])).toBe(1);
    expect(meldsOffered(['7H', '7D', '2C', '2D', 'JOKER.0', 'JOKER.1'])).toBe(0);
    expect(meldsOffered(['7H', '2D', 'JOKER.0'])).toBe(0);
    // Two decks: a set can repeat a suit.
    expect(meldsOffered(['7H', '7H.1', '7D', '7D.1'])).toBe(1);
  });

  it('allows any number of wild cards with that house rule', () => {
    expect(
      meldsOffered(['7H', '7D', '2C', '2D', 'JOKER.0', 'JOKER.1'], { wildLimit: 'none' }),
    ).toBe(1);
  });

  it("doesn't let you meld black 3s, except when going out", () => {
    expect(meldsOffered(['3C', '3S', '3C.1'])).toBe(0);
  });

  it("lets you add only to your own team's melds", () => {
    const { state, L } = start();
    const s = play(
      table(state, {
        hands: { [L]: ['KS', 'QS', '9C', '8C'] },
        melds: { [L % 2]: [['KC', 'KD', 'KH']], [(L + 1) % 2]: [['QC', 'QD', 'QH']] },
        stockTop: ['4C'],
      }),
      draw(L),
    );
    const layOffs = movesOf(s, L, 'layOff');
    expect(layOffs).toEqual([
      { player: L, type: 'layOff', card: id('KS'), meld: { zone: `melds@t${L % 2}`, index: 0 } },
    ]);
  });
});

describe('Canasta: going out', () => {
  const canastaOfKings = ['KC', 'KC.1', 'KD', 'KD.1', 'KH', 'KH.1', 'KS'];

  it('needs a canasta', () => {
    const { state, L } = start();
    // After drawing the 9♥, L can meld three 9s and discard the 5♦.
    const ready = (melds: string[][]) =>
      play(
        table(state, {
          hands: { [L]: ['9C', '9D', '5D'] },
          melds: { [L % 2]: melds },
          stockTop: ['9H'],
        }),
        draw(L),
        arrange(L, ['9C', '9D', '9H']),
      );
    expect(movesOf(ready([['KC', 'KD', 'KH']]), L, 'showHand')).toEqual([]);
    expect(movesOf(ready([canastaOfKings]), L, 'showHand')).toEqual([
      { player: L, type: 'showHand', card: id('5D'), to: 'discard' },
    ]);
  });

  it('scores the hand: melds, canastas, red 3s, going out and cards left in hand', () => {
    const { state, L, L1, L2, D } = start();
    const mine = L % 2;
    const theirs = (L + 1) % 2;
    const s = draft(
      play(
        table(state, {
          hands: { [L]: ['9C', '9D'], [L1]: ['JOKER.0', '5S'], [L2]: ['AS'], [D]: ['8D'] },
          melds: {
            [mine]: [canastaOfKings, ['7H', '7D', '2C']],
            [theirs]: [['QC', 'QD', 'QH', 'QS', 'QC.1', 'QD.1', 'JOKER.1']],
          },
          stockTop: ['9H'],
        }),
        draw(L),
        arrange(L, ['9C', '9D', '9H']),
      ),
    );
    s.zones[`redThrees@t${mine}`] = ['3H', '3D', '3H.1', '3D.1'].map(card);
    s.zones[`redThrees@t${theirs}`] = [];
    // Going out by melding three 9s, with no discard (L never melded before: concealed).
    const out = applyMove(s, { player: L, type: 'showHand', card: null, to: 'discard' });
    const points = out.history.at(-1)?.teams.map((t) => t.points) ?? [];
    // Mine: kings 70 + natural canasta 500, 7-7-2 = 30, the 9s 30, four red 3s 800,
    // concealed going out 200, and the partner's A♠ (-20) left in hand.
    expect(points[mine]).toBe(70 + 500 + 30 + 30 + 800 + 200 - 20);
    // Theirs: queens 60 + joker 50 + mixed canasta 300, minus the joker and 5♠ (55) and 8♦ (10).
    expect(points[theirs]).toBe(60 + 50 + 300 - 55 - 10);
  });

  it('lets you meld your last cards and go out without a discard', () => {
    const { state, L } = start();
    const s = play(
      table(state, {
        hands: { [L]: ['9C', '9D', '9H'] },
        melds: { [L % 2]: [canastaOfKings] },
        stockTop: ['9S'],
        vars: {},
      }),
      draw(L),
      arrange(L, ['9C', '9D', '9H', '9S']),
    );
    const outs = movesOf(s, L, 'showHand');
    expect(outs).toContainEqual({ player: L, type: 'showHand', card: null, to: 'discard' });
    const done = applyMove(s, { player: L, type: 'showHand', card: null, to: 'discard' });
    expect(done.round).toBe(2);
  });

  it('allows a meld of black 3s only when going out', () => {
    const { state, L } = start();
    const s = play(
      table(state, {
        hands: { [L]: ['3C', '3S', '3C.1'] },
        melds: { [L % 2]: [canastaOfKings] },
        stockTop: ['8H'],
      }),
      draw(L),
      arrange(L, ['3C', '3S', '3C.1']),
    );
    // Not as an ordinary meld...
    expect(movesOf(s, L, 'meld')).toEqual([]);
    // ...but going out, discarding the 8.
    expect(movesOf(s, L, 'showHand')).toEqual([
      { player: L, type: 'showHand', card: id('8H'), to: 'discard' },
    ]);
  });

  it('asks partner "May I go out?" with that house rule, and obeys', () => {
    const { state, L, L2 } = start(4, { askPartner: true });
    const ready = play(
      table(state, {
        hands: { [L]: ['9C', '9D', '5D'] },
        melds: { [L % 2]: [canastaOfKings] },
        stockTop: ['9H'],
      }),
      draw(L),
      arrange(L, ['9C', '9D', '9H']),
    );
    expect(movesOf(ready, L, 'choose')).toEqual([choose(L, 'askToGoOut')]);
    const asked = applyMove(ready, choose(L, 'askToGoOut'));
    // The partner answers; L waits (sorting cards is always open, but takes no turn).
    expect(getLegalMoves(asked, L).filter((m) => m.type !== 'sortHand')).toEqual([]);
    expect(getLegalMoves(asked, L2).filter((m) => m.type !== 'sortHand')).toEqual([
      choose(L2, 'yes'),
      choose(L2, 'no'),
    ]);
    // "No": L can't go out this turn.
    const no = applyMove(asked, choose(L2, 'no'));
    expect(no.cursor.current).toBe(L);
    expect(movesOf(no, L, 'showHand')).toEqual([]);
    expect(movesOf(no, L, 'discard').length).toBeGreaterThan(0);
    // "Yes": L must go out.
    const yes = applyMove(asked, choose(L2, 'yes'));
    expect(movesOf(yes, L, 'discard')).toEqual([]);
    expect(movesOf(yes, L, 'showHand')).toEqual([
      { player: L, type: 'showHand', card: id('5D'), to: 'discard' },
    ]);
  });

  it("doesn't offer to ask when you can't go out", () => {
    const { state, L } = start(4, { askPartner: true });
    const s = play(
      table(state, {
        hands: { [L]: ['9C', '5D'] },
        melds: { [L % 2]: [canastaOfKings] },
        stockTop: ['4C'],
      }),
      draw(L),
    );
    expect(movesOf(s, L, 'choose')).toEqual([]);
  });
});

describe('Canasta: the stock running out', () => {
  /** The stock is empty and it's L's turn to draw, with this pile. */
  function emptyStock(pile: string[], hand: string[]) {
    const { state, L } = start();
    const s = draft(
      table(state, {
        hands: { [L]: hand },
        discard: pile,
        melds: { [L % 2]: [['7C', '7D', '7H']] },
      }),
    );
    s.zones.discard?.unshift(...(s.zones.stock ?? []));
    s.zones.stock = [];
    s.roundMoves = 1;
    return { state: restartPhase(s), L };
  }

  it("ends the hand when the player to draw can't take the pile", () => {
    const { state } = emptyStock(['4H', '9S'], ['5D', '6D']);
    expect(state.round).toBe(2);
  });

  it('keeps going while the player can take it, and then they must', () => {
    const { state, L } = emptyStock(['4H', '7S'], ['5D', '6D']);
    expect(state.round).toBe(1);
    expect(getLegalMoves(state, L).map((m) => m.type)).toEqual(['pickUpPile', 'sortHand']);
  });
});

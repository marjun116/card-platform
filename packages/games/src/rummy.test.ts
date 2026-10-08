/**
 * Scenario tests for rummy.json: the rules a real table would check. Each
 * test deals exact hands; seats are named from the first player as a, b, c.
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
import { hand, id, play, withZones } from '@card-table/engine/testing';
import { describe, expect, it } from 'vitest';
import { builtInGames } from './index';

const rummy = builtInGames.rummy;
type Options = Record<string, OptionValue>;

const ids = (...specs: string[]) => specs.map(id);
const types = (state: GameState, seat: number) =>
  [...new Set(getLegalMoves(state, seat).map((m) => m.type))].sort();
const score = (state: GameState, seat: number) => state.teams[seat]?.score;
const melds = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).filter((m) => m.type === 'meld');

/**
 * Players holding exactly these hands (from the first player round), with
 * `top` on the discard pile and `cutRank` wild (null: no cut joker).
 */
function table(
  hands: string[][],
  {
    options = {},
    top = '2C',
    cutRank = null,
  }: { options?: Options; top?: string; cutRank?: string | null } = {},
) {
  const base = createGame(rummy, options, hands.length, 'rummy');
  const first = base.cursor.current;
  const seat = (i: number) => (first + i) % hands.length;
  const zones: Record<string, string[]> = { discard: [top] };
  hands.forEach((h, i) => (zones[`hand@${seat(i)}`] = h));
  const state = withZones(base, zones, 'stock');
  state.vars.cutRank = cutRank;
  return { state, a: seat(0), b: seat(1), c: seat(2) };
}
const arrange = (player: number, ...groups: string[][]): Move => ({
  player,
  type: 'arrange',
  groups: groups.map((g) => ids(...g)),
});
const draw = (player: number, from = 'stock'): Move => ({ player, type: 'draw', from });
const meld = (player: number, ...cards: string[]): Move => ({
  player,
  type: 'meld',
  cards: ids(...cards).sort(),
});
const discard = (player: number, card: string): Move => ({
  player,
  type: 'discard',
  card: id(card),
  to: 'discard',
});
const show = (player: number): Move => ({ player, type: 'choose', value: 'show' });

describe('rummy: the deal', () => {
  const cards = (state: GameState) => Object.values(state.zones).flat().length;

  it('deals 13 each, with one deck and two jokers for two players', () => {
    const state = createGame(rummy, {}, 2, 'deal');
    expect(hand(state, 0)).toHaveLength(13);
    expect(cards(state)).toBe(54);
    // The cut joker is turned face up and sets the wild rank.
    expect(state.zones.cut).toHaveLength(1);
    expect(state.vars.cutRank).not.toBeNull();
  });

  it('adds a second deck when one would leave too small a stock', () => {
    expect(cards(createGame(rummy, {}, 3, 'deal'))).toBe(108);
    expect(cards(createGame(rummy, {}, 6, 'deal'))).toBe(108);
    const hoyle = createGame(rummy, { cards: 'hoyle' }, 4, 'deal');
    expect(hand(hoyle, 0)).toHaveLength(7);
    expect(cards(hoyle)).toBe(54);
  });

  it('leaves out wild cards with that house rule', () => {
    const state = createGame(rummy, { jokers: 'none' }, 2, 'deal');
    expect(cards(state)).toBe(52);
    expect(state.zones.cut).toHaveLength(0);
  });
});

describe('rummy: melding', () => {
  it('needs a pure run before a meld that uses a wild card, but not before a natural set', () => {
    const { state, a } = table(
      [['3H', '4H', '5H', '9C', '9D', '9S', 'JOKER.0', 'KD', 'KS', 'QD'], ['2D']],
      {},
    );
    let s = applyMove(
      state,
      arrange(a, ['9C', '9D', '9S'], ['KD', 'KS', 'JOKER.0'], ['3H', '4H', '5H']),
    );
    s = applyMove(s, draw(a));
    // Natural set and the pure run: yes. The kings with a joker: not yet.
    expect(melds(s, a).map((m) => (m.type === 'meld' ? m.cards.length : 0))).toEqual([3, 3]);
    s = applyMove(s, meld(a, '3H', '4H', '5H'));
    expect(melds(s, a)).toHaveLength(2);
  });

  it('treats the cut rank as wild', () => {
    const { state, a } = table([['3H', '4H', '7S', 'KD', 'KS', 'QD'], ['2D']], { cutRank: '7' });
    const s = applyMove(applyMove(state, arrange(a, ['3H', '4H', '7S'])), draw(a));
    // 3-4-7 is a run with the 7♠ standing in for the 5♥ — not pure, so not yet.
    expect(viewFor(s, a).arrangement?.groups[0]).toMatchObject({ kind: 'run', pure: false });
    expect(melds(s, a)).toEqual([]);
  });

  it('plays aces low by default, or high, or both, as the house rule says', () => {
    const highRun = ['QH', 'KH', 'AH'];
    const kinds = (aces: string) => {
      const { state, a } = table([[...highRun, '5C'], ['2D']], { options: { aces } });
      return viewFor(applyMove(state, arrange(a, highRun)), a).arrangement?.groups[0]?.kind;
    };
    expect(kinds('low')).toBeNull();
    expect(kinds('high')).toBe('run');
    expect(kinds('both')).toBe('run');
  });
});

describe('rummy: the discard pile', () => {
  it("won't take back the card just taken from it, unless the house rule allows", () => {
    const { state, a } = table([['3H', '9C'], ['2D']], { top: 'KS' });
    const took = applyMove(state, draw(a, 'discard'));
    const discards = (s: GameState) =>
      getLegalMoves(s, a).flatMap((m) => (m.type === 'discard' ? [m.card] : []));
    expect(discards(took)).not.toContain(id('KS'));
    const allowed = table([['3H', '9C'], ['2D']], { top: 'KS', options: { throwBack: true } });
    expect(discards(applyMove(allowed.state, draw(allowed.a, 'discard')))).toContain(id('KS'));
  });
});

describe('rummy: going out and scoring', () => {
  const winnerHand = ['3H', '4H', '5H', '9C', '9D', '9S'];

  it('lets the winner meld everything; others show, and their deadwood is scored', () => {
    const { state, a, b } = table([winnerHand, ['2D', '3D', '4D', 'KS', 'QS']], { top: '9H' });
    let s = applyMove(state, draw(a, 'discard'));
    s = applyMove(s, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S', '9H']));
    s = play(s, meld(a, '3H', '4H', '5H'), meld(a, '9C', '9D', '9S', '9H'));
    expect(hand(s, a)).toHaveLength(0);
    expect(s.file.phases[s.cursor.phase]?.name).toBe('show');
    // b groups the diamond run (pure) before showing: only K♠ and Q♠ count.
    s = play(s, arrange(b, ['2D', '3D', '4D']), show(b));
    // Going out all at once doubles it: (10 + 10) × 2.
    expect(score(s, a)).toBe(40);
  });

  it("doesn't double the score when the winner had melded on an earlier turn", () => {
    const { state, a, b } = table([
      [...winnerHand, 'KC'],
      ['2D', '3D', '4D', '9H', 'QS'],
    ]);
    // a lays down the run and discards whatever they drew.
    let s = applyMove(state, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S']));
    s = play(s, draw(a), meld(a, '3H', '4H', '5H'));
    const drawn = hand(s, a).find((c) => !ids('9C', '9D', '9S', 'KC').includes(c)) as string;
    s = applyMove(s, { player: a, type: 'discard', card: drawn, to: 'discard' });
    // b throws the 9♥, which a takes to finish the nines, then goes out on the K♣.
    s = play(s, draw(b), discard(b, '9H'), draw(a, 'discard'));
    s = applyMove(s, arrange(a, ['9C', '9D', '9S', '9H']));
    s = play(s, meld(a, '9C', '9D', '9S', '9H'), discard(a, 'KC'));
    expect(hand(s, a)).toEqual([]);
    s = applyMove(s, arrange(b, ['2D', '3D', '4D']));
    const owed = viewFor(s, b).arrangement?.deadwood;
    s = applyMove(s, show(b));
    expect(score(s, a)).toBe(owed); // not doubled
  });

  it('counts every card of a loser with no pure run', () => {
    const { state, a, b } = table([winnerHand, ['9H', 'JOKER.0', 'KS', '2D']], { top: '5C' });
    let s = applyMove(state, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S']));
    s = play(s, draw(a), meld(a, '3H', '4H', '5H'), meld(a, '9C', '9D', '9S'));
    const extra = hand(s, a)[0] as string;
    s = applyMove(s, { player: a, type: 'discard', card: extra, to: 'discard' });
    // b's "set" of K♠ with a joker would count for nothing without a pure run: 9 + 0 + 10 + 2.
    s = play(s, arrange(b, ['KS', 'JOKER.0', '9H']), show(b));
    expect(score(s, a)).toBe(42); // doubled: all at once
  });

  it('makes you keep a card to discard with "must discard to go out"', () => {
    const { state, a } = table([winnerHand, ['2D']], { options: { mustDiscard: true } });
    let s = applyMove(state, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S']));
    s = play(s, draw(a), meld(a, '3H', '4H', '5H'));
    // Three cards left plus the draw: the set of 9s can go down, keeping one to discard.
    expect(melds(s, a)).toHaveLength(1);
    const tight = table([['3H', '4H', '5H'], ['2D']], { options: { mustDiscard: true } });
    const t = applyMove(
      applyMove(tight.state, arrange(tight.a, ['3H', '4H', '5H'])),
      draw(tight.a),
    );
    expect(melds(t, tight.a)).toHaveLength(1); // 4 cards: meld 3, discard 1
  });

  it('scores everyone their own deadwood with penalty scoring', () => {
    const options = { scoring: 'penalty', targetScore: 150 };
    const { state, a, b } = table([winnerHand, ['2D', '3D', '4D', 'KS']], { options, top: '5C' });
    let s = applyMove(state, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S']));
    s = play(s, draw(a), meld(a, '3H', '4H', '5H'), meld(a, '9C', '9D', '9S'));
    s = applyMove(s, { player: a, type: 'discard', card: hand(s, a)[0] as string, to: 'discard' });
    s = play(s, arrange(b, ['2D', '3D', '4D']), show(b));
    expect(score(s, a)).toBe(0);
    expect(score(s, b)).toBe(10);
  });
});

describe('rummy: keeping melds in hand', () => {
  const options = { melding: 'inHand' };

  it('offers no melding during play, and going out by showing a fully arranged hand', () => {
    const { state, a, b } = table(
      [
        ['3H', '4H', '5H', '9C', '9D', '9S'],
        ['2D', 'KS'],
      ],
      { options },
    );
    let s = applyMove(state, arrange(a, ['3H', '4H', '5H'], ['9C', '9D', '9S']));
    s = applyMove(s, draw(a));
    expect(types(s, a)).not.toContain('meld');
    const drawn = hand(s, a).find((c) => !ids(...['3H', '4H', '5H', '9C', '9D', '9S']).includes(c));
    expect(getLegalMoves(s, a)).toContainEqual({
      player: a,
      type: 'showHand',
      card: drawn,
      to: 'discard',
    });
    s = applyMove(s, { player: a, type: 'showHand', card: drawn as string, to: 'discard' });
    expect(s.melds[`melds@${a}`]).toHaveLength(2);
    s = applyMove(s, show(b));
    // Showing a hand isn't "going rummy" here, so no doubling: 2 + 10.
    expect(score(s, a)).toBe(12);
  });
});

describe('rummy: other house rules', () => {
  it('hides "Sort into melds" when it is switched off', () => {
    const { state, a } = table([['3H', '4H'], ['2D']], { options: { sortButton: false } });
    expect(types(state, a)).not.toContain('sortHand');
    const on = table([['3H', '4H'], ['2D']]);
    expect(types(on.state, on.a)).toContain('sortHand');
  });

  it('ends the hand when the stock runs out, with that house rule', () => {
    const { state, a } = table(
      [
        ['3H', '9C'],
        ['2D', '7S'],
      ],
      { options: { emptyStock: 'end' } },
    );
    const empty = withZones(state, { stock: ['QC'] }, 'discard');
    const drawn = applyMove(empty, draw(a));
    const after = applyMove(drawn, discard(a, '9C'));
    // Nobody went out: the hand ends at the next turn and everyone shows.
    expect(after.file.phases[after.cursor.phase]?.name).toBe('show');
  });
});

/**
 * Scenario tests for euchre.json: the rules a real table would check.
 * Seats are named from the left of the dealer: a, b, c, then the dealer d.
 * a and c are partners, as are b and d.
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

const euchre = builtInGames.euchre;
type Options = Record<string, OptionValue>;

const phase = (state: GameState) => state.file.phases[state.cursor.phase]?.name;
const choose = (player: number, value: string): Move => ({ player, type: 'choose', value });
const values = (state: GameState, seat: number) =>
  getLegalMoves(state, seat).flatMap((m) =>
    m.type === 'choose' ? [m.value] : m.type === 'declareTrump' ? [m.suit] : [],
  );

/** Hands for a, b, c and the dealer, with `upcard` turned up; the rest is the kitty. */
function table(
  hands: [string[], string[], string[], string[]],
  upcard: string,
  options: Options = {},
) {
  const base = createGame(euchre, options, 4, 'euchre');
  const d = base.dealer;
  const [a, b, c] = [(d + 1) % 4, (d + 2) % 4, (d + 3) % 4];
  const seats = [a, b, c, d];
  const zones: Record<string, string[]> = { upcard: [upcard] };
  hands.forEach((h, i) => (zones[`hand@${seats[i]}`] = h));
  return { state: withZones(base, zones, 'kitty'), a, b, c, d };
}

/** Plays every remaining trick with each player's first legal card. */
function playOut(state: GameState): GameState {
  let s = state;
  const round = s.round;
  while (s.round === round && s.status === 'inProgress') {
    s = applyMove(s, getLegalMoves(s, s.cursor.current)[0] as Move);
  }
  return s;
}
const score = (state: GameState, seat: number) =>
  state.teams[state.players[seat]?.team ?? 0]?.score;

// a holds the five best hearts; nobody else has a heart.
const MARCH: [string[], string[], string[], string[]] = [
  ['JH', 'JD', 'AH', 'KH', 'QH'],
  ['9C', '10C', 'JC', 'QC', 'KC'],
  ['9S', '10S', 'JS', 'QS', 'KS'],
  ['9D', '10D', 'QD', 'KD', 'AD'],
];
// a orders hearts with no hearts; b holds the five best.
const EUCHRED: [string[], string[], string[], string[]] = [
  ['9C', '10C', 'QC', 'KC', 'AC'],
  ['JH', 'JD', 'AH', 'KH', 'QH'],
  ['9S', '10S', 'JS', 'QS', 'KS'],
  ['9D', '10D', 'QD', 'KD', 'AD'],
];

describe('euchre: the deal', () => {
  it('deals 5 each from 24 cards, turns up one, and keeps 3 in the kitty', () => {
    const state = createGame(euchre, {}, 4, 'deal');
    for (let seat = 0; seat < 4; seat++) expect(hand(state, seat)).toHaveLength(5);
    expect(state.zones.upcard).toHaveLength(1);
    expect(state.zones.kitty).toHaveLength(3);
    expect(phase(state)).toBe('orderUp');
  });
});

describe('euchre: making trump', () => {
  it('lets players order up (the dealer picks up); the dealer then takes the card and discards', () => {
    const { state, a, b, c, d } = table(MARCH, '10H');
    expect(state.cursor.current).toBe(a);
    expect(values(state, a)).toEqual(['orderUp', 'pass']);
    let s = play(state, choose(a, 'pass'), choose(b, 'pass'), choose(c, 'pass'));
    expect(values(s, d)).toEqual(['pickUp', 'pass']);
    s = applyMove(s, choose(d, 'pickUp'));
    expect(s.vars.trump).toBe('hearts');
    // The maker decides whether to go alone, then the dealer exchanges.
    expect(values(s, d)).toEqual(['alone', 'withPartner']);
    s = applyMove(s, choose(d, 'withPartner'));
    expect(phase(s)).toBe('exchange');
    s = applyMove(s, { player: d, type: 'draw', from: 'upcard' });
    expect(hand(s, d)).toContain(id('10H'));
    s = applyMove(s, { player: d, type: 'discard', card: id('9D'), to: 'kitty' });
    expect(phase(s)).toBe('play');
    expect(s.cursor.current).toBe(a);
  });

  it('shows trump and who called it on the table once trump is made', () => {
    const { state, a, b, c, d } = table(MARCH, '10H');
    expect(viewFor(state, a).display).toEqual([]);
    let s = play(state, choose(a, 'pass'), choose(b, 'orderUp'), choose(b, 'alone'));
    expect(viewFor(s, c).display).toEqual([
      { label: 'Trump', value: '♥ Hearts' },
      { label: 'Called by', value: b, format: 'player' },
      { label: 'Going alone', value: 'Yes' },
    ]);
    // The dealer is b's partner, so sits out; play starts straight away.
    expect(phase(s)).toBe('play');
    expect(viewFor(s, d).display[0]).toEqual({ label: 'Trump', value: '♥ Hearts' });
  });

  it('then offers any other suit, and throws the hand in if everyone passes twice', () => {
    const { state, a, b, c, d } = table(MARCH, '10H');
    let s = play(state, ...[a, b, c, d].map((seat) => choose(seat, 'pass')));
    expect(phase(s)).toBe('nameTrump');
    expect(values(s, a)).toEqual(['clubs', 'diamonds', 'spades', 'pass']);
    s = play(s, ...[a, b, c, d].map((seat) => choose(seat, 'pass')));
    expect(s.round).toBe(2);
    expect(s.teams.map((t) => t.score)).toEqual([0, 0]);
    expect(s.dealer).toBe(a);
  });

  it("won't let the dealer pass in the second round with stick the dealer", () => {
    const { state, a, b, c, d } = table(MARCH, '10H', { stickTheDealer: true });
    const s = play(state, ...[a, b, c, d, a, b, c].map((seat) => choose(seat, 'pass')));
    expect(values(s, d)).toEqual(['clubs', 'diamonds', 'spades']);
  });

  it("makes the dealer's partner go alone when ordering the dealer up, with that house rule", () => {
    const { state, a, b } = table(MARCH, '10H', { canadianLoner: true });
    const s = play(state, choose(a, 'pass'), choose(b, 'orderUp'));
    expect(values(s, b)).toEqual(['alone']);
    const normal = table(MARCH, '10H');
    const n = play(normal.state, choose(normal.a, 'pass'), choose(normal.b, 'orderUp'));
    expect(values(n, normal.b)).toEqual(['alone', 'withPartner']);
  });
});

describe('euchre: play and scoring', () => {
  const orderAndExchange = (t: ReturnType<typeof table>, alone: boolean) =>
    play(
      t.state,
      choose(t.a, 'orderUp'),
      choose(t.a, alone ? 'alone' : 'withPartner'),
      { player: t.d, type: 'draw', from: 'upcard' },
      { player: t.d, type: 'discard', card: id('9D'), to: 'kitty' },
    );

  it('scores 2 for taking all five tricks', () => {
    const t = table(MARCH, '10H');
    expect(score(playOut(orderAndExchange(t, false)), t.a)).toBe(2);
  });

  it('scores 4 for a lone march (5 with that house rule), with the partner sitting out', () => {
    const t = table(MARCH, '10H');
    const ready = orderAndExchange(t, true);
    expect(ready.players[t.c]?.sittingOut).toBe(true);
    expect(score(playOut(ready), t.a)).toBe(4);
    const five = table(MARCH, '10H', { loneMarch: 5 });
    expect(score(playOut(orderAndExchange(five, true)), five.a)).toBe(5);
  });

  it('scores 1 for three or four tricks', () => {
    const t = table(
      [
        ['JH', 'JD', 'AH', '9C', '9S'],
        ['KH', 'QH', '10C', 'JC', 'QC'],
        ['10S', 'JS', 'QS', 'KS', 'AS'],
        ['9D', '10D', 'QD', 'KD', 'AD'],
      ],
      '10H',
    );
    const done = playOut(orderAndExchange(t, false));
    expect(score(done, t.a)).toBe(1);
    expect(score(done, t.b)).toBe(0);
  });

  it('gives the defenders 2 for a euchre, or 4 against a loner with that house rule', () => {
    const t = table(EUCHRED, '10H');
    const done = playOut(orderAndExchange(t, false));
    expect(score(done, t.b)).toBe(2);
    expect(score(done, t.a)).toBe(0);
    const loner = table(EUCHRED, '10H', { euchreLoner4: true });
    expect(score(playOut(orderAndExchange(loner, true)), loner.b)).toBe(4);
    const plain = table(EUCHRED, '10H');
    expect(score(playOut(orderAndExchange(plain, true)), plain.b)).toBe(2);
  });

  it('lets a defender go alone against a loner, with that house rule', () => {
    const t = table(EUCHRED, '10H', { defendAlone: true });
    let s = play(t.state, choose(t.a, 'orderUp'), choose(t.a, 'alone'));
    expect(phase(s)).toBe('defendAlone');
    expect(values(s, t.b)).toEqual(['defendAlone', 'pass']);
    s = applyMove(s, choose(t.b, 'defendAlone'));
    // b's partner is the dealer, who now sits out and doesn't pick up the upcard.
    expect(s.players[t.d]?.sittingOut).toBe(true);
    expect(phase(s)).toBe('play');
    const done = playOut(s);
    expect(score(done, t.b)).toBe(4);
  });
});

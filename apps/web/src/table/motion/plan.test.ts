import {
  applyMove,
  type GameState,
  getLegalMoves,
  type Move,
  type PlayerView,
  viewFor,
} from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { createGame, miniRummy, passing, playUntil, spades } from '../../test/games';
import { dealPlan, freshDeal, planMotion } from './plan';

/** Plays `move` (or the first legal move of whoever is to act). */
function step(state: GameState, choose?: (moves: Move[]) => Move | undefined): GameState {
  const seat = state.cursor.current;
  const moves = getLegalMoves(state, seat);
  const move = (choose ? choose(moves) : moves[0]) ?? moves[0];
  if (!move) throw new Error(`Seat ${seat} has no move`);
  return applyMove(state, move);
}

const inPhase = (name: string) => (s: GameState) => s.file.phases[s.cursor.phase]?.name === name;

/** Spades with the bids made, at the first card of the first trick. */
function spadesPlay(seed = 'motion'): GameState {
  return playUntil(createGame(spades, {}, 4, seed), inPhase('play'));
}

describe('planMotion: tricks', () => {
  it("brings another player's card from their seat, turning over", () => {
    const before = spadesPlay();
    const player = before.cursor.current;
    const watcher = (player + 1) % 4;
    const after = step(before);
    const plan = planMotion(viewFor(before, watcher), viewFor(after, watcher));
    const card = after.trick?.plays[0]?.card.id ?? '';
    expect(plan.arrivals.get(card)).toEqual({ from: { seat: player }, flip: true });
    expect(plan.deal).toBe(false);
  });

  it('leaves your own card to glide from your hand (it was on screen already)', () => {
    const before = spadesPlay();
    const player = before.cursor.current;
    const after = step(before);
    const plan = planMotion(viewFor(before, player), viewFor(after, player));
    expect(plan.arrivals.size).toBe(0);
    expect(plan.backs).toEqual([]);
  });

  it('sweeps a finished trick to whoever won it', () => {
    let state = spadesPlay();
    for (let i = 0; i < 4; i++) state = step(state);
    const winner = state.lastTrick?.winner ?? -1;
    const cards = state.lastTrick?.plays.map((p) => p.card.id) ?? [];
    // The next card is led: the finished trick leaves the table.
    const next = step(state);
    const plan = planMotion(viewFor(state, 0), viewFor(next, 0));
    expect(cards).toHaveLength(4);
    for (const card of cards) expect(plan.departures.get(card)).toEqual({ to: { seat: winner } });
  });
});

describe('planMotion: dealing', () => {
  it('deals a new round from the dealer: your cards turn over, others get backs', () => {
    const state = createGame(spades, {}, 4, 'deal');
    const view = viewFor(state, 0);
    const plan = dealPlan(view);
    const dealer = { seat: state.dealer };
    // Each seat's turn in the deal: the dealer's left first, the dealer last.
    const turn = (seat: number) => (seat - state.dealer + 3) % 4;
    expect(plan.deal).toBe(true);
    expect(plan.arrivals.size).toBe(13);
    const slots = [...plan.arrivals.values()].map(({ slot, ...rest }) => {
      expect(rest).toEqual({ from: dealer, flip: true });
      return slot;
    });
    // One card to you every time the deal comes round.
    expect(slots).toEqual(Array.from({ length: 13 }, (_, k) => k * 4 + turn(0)));
    expect(plan.backs).toEqual(
      [1, 2, 3].map((seat) => ({
        from: dealer,
        to: { seat },
        count: 13,
        slots: { first: turn(seat), every: 4 },
      })),
    );
  });

  it('counts a change of round as a deal', () => {
    let state = spadesPlay();
    const round = state.round;
    const before = viewFor(state, 0);
    state = playUntil(state, (s) => s.round > round, undefined);
    expect(planMotion(before, viewFor(state, 0)).deal).toBe(true);
  });

  it('knows a fresh deal from a game under way', () => {
    const state = createGame(spades, {}, 4, 'fresh');
    expect(freshDeal(viewFor(state, 0))).toBe(true);
    expect(freshDeal(viewFor(step(state), 0))).toBe(false);
  });
});

describe('planMotion: passing', () => {
  /** Seat `seat` passes its first three cards. */
  const passFirst = (state: GameState) =>
    step(state, (moves) => moves.find((m) => m.type === 'pass'));

  it('sends your passed cards to whoever gets them', () => {
    const before = createGame(passing, {}, 4, 'pass');
    const giver = before.cursor.current;
    const after = passFirst(before);
    const plan = planMotion(viewFor(before, giver), viewFor(after, giver));
    const sent = after.passes[0]?.cards ?? [];
    expect(sent).toHaveLength(3);
    for (const card of sent) {
      expect(plan.departures.get(card)).toEqual({ to: { seat: (giver + 1) % 4 } });
    }
  });

  it('brings the cards passed to you from the player who sent them', () => {
    let state = createGame(passing, {}, 4, 'receive');
    for (let i = 0; i < 3; i++) state = passFirst(state);
    const last = state.cursor.current;
    const receiver = (last + 1) % 4;
    const before = viewFor(state, receiver);
    state = passFirst(state);
    const plan = planMotion(before, viewFor(state, receiver));
    const got = state.passes.find((p) => p.to === receiver)?.cards ?? [];
    expect(got).toHaveLength(3);
    for (const card of got) {
      expect(plan.arrivals.get(card)).toEqual({ from: { seat: last }, flip: true });
    }
  });
});

describe('planMotion: piles', () => {
  const rummy = () => createGame(miniRummy, {}, 2, 'piles');

  it('brings a card you draw from the face-down stock, turning over', () => {
    const before = rummy();
    const you = before.cursor.current;
    const after = step(before, (moves) =>
      moves.find((m) => m.type === 'draw' && m.from === 'stock'),
    );
    const plan = planMotion(viewFor(before, you), viewFor(after, you));
    const drawn = after.zones[`hand@${you}`]?.find(
      (c) => !before.zones[`hand@${you}`]?.includes(c),
    );
    expect(plan.arrivals.get(drawn?.id ?? '')).toEqual({ from: { zone: 'stock' }, flip: true });
  });

  it("shows another player's draw from the stock as a face-down card", () => {
    const before = rummy();
    const drawer = before.cursor.current;
    const watcher = 1 - drawer;
    const after = step(before, (moves) =>
      moves.find((m) => m.type === 'draw' && m.from === 'stock'),
    );
    const plan = planMotion(viewFor(before, watcher), viewFor(after, watcher));
    expect(plan.backs).toEqual([{ from: { zone: 'stock' }, to: { seat: drawer }, count: 1 }]);
    expect(plan.arrivals.size).toBe(0);
  });

  it('sends the face-up card someone takes from the discard pile to them', () => {
    const before = rummy();
    const drawer = before.cursor.current;
    const watcher = 1 - drawer;
    const top = before.zones.discard?.at(-1)?.id ?? '';
    const after = step(before, (moves) =>
      moves.find((m) => m.type === 'draw' && m.from === 'discard'),
    );
    const plan = planMotion(viewFor(before, watcher), viewFor(after, watcher));
    expect(plan.departures.get(top)).toEqual({ to: { seat: drawer } });
    // The card flies face up, so no face-down one as well.
    expect(plan.backs).toEqual([]);
  });

  it("brings another player's discard from their seat", () => {
    let state = rummy();
    state = step(state, (moves) => moves.find((m) => m.type === 'draw'));
    const player = state.cursor.current;
    const watcher = 1 - player;
    const before = state;
    state = playUntil(
      state,
      (s) => s.log.length > before.log.length && s.log.at(-1)?.type === 'discard',
      (moves) => moves.find((m) => m.type === 'discard'),
    );
    const discard = state.log.at(-1);
    const card = discard?.type === 'discard' ? discard.card : '';
    const plan = planMotion(viewFor(before, watcher), viewFor(state, watcher));
    expect(plan.arrivals.get(card)).toEqual({ from: { seat: player }, flip: true });
  });
});

describe('planMotion: turning cards', () => {
  /** A view with one more zone, as given. */
  const withZone = (
    view: PlayerView,
    key: string,
    zone: PlayerView['zones'][string],
  ): PlayerView => ({
    ...view,
    zones: { ...view.zones, [key]: zone },
  });
  const card = { id: 'JH.0', rank: 'J', suit: 'hearts' } as const;
  const base = viewFor(createGame(spades, {}, 4, 'turn'), 0);

  it('turns a face-up card face down where it lies', () => {
    const before = withZone(base, 'upcard', { kind: 'count', count: 1, top: card });
    const after = withZone(base, 'upcard', { kind: 'count', count: 1, top: null });
    expect(planMotion(before, after).departures.get('JH.0')).toEqual({
      to: { zone: 'upcard' },
      turnDown: true,
    });
  });

  it('turns a face-down card face up where it lies', () => {
    const before = withZone(base, 'upcard', { kind: 'count', count: 1, top: null });
    const after = withZone(base, 'upcard', { kind: 'count', count: 1, top: card });
    expect(planMotion(before, after).arrivals.get('JH.0')).toEqual({
      from: { zone: 'upcard' },
      flip: true,
    });
  });

  it('just shows a card uncovered on a face-up pile, without turning it', () => {
    const under = { id: '4C.0', rank: '4', suit: 'clubs' } as const;
    const before = withZone(base, 'discard', { kind: 'count', count: 2, top: card });
    const after = withZone(base, 'discard', { kind: 'count', count: 1, top: under });
    expect(planMotion(before, after).arrivals.has('4C.0')).toBe(false);
  });
});

/**
 * Building blocks added for bridge: one seat playing another's cards
 * (`control`), a hand shown to everyone partway through (`reveal`), words
 * for bids, display values and counters, and a dealer rotation that can
 * depend on the hand just played.
 */
import { describe, expect, it } from 'vitest';
import { applyMove, createGame, getLegalMoves, playersToAct, viewFor } from './api';
import type { Move } from './game/move';
import type { GameState } from './game/state';
import type { GameFile } from './game/types';
import { validate } from './schema/validate';
import { findHiddenCardLeak, play } from './testing';

/**
 * Four players in partnerships, 4 cards each. One call each from the dealer:
 * a bid makes you the declarer and your partner the dummy, who is shown to
 * everyone after the opening lead and whose cards the declarer plays.
 */
const dummyGame: GameFile = {
  meta: {
    name: 'Dummy',
    players: 4,
    teams: [
      [0, 2],
      [1, 3],
    ],
  },
  deck: { copies: 1, ranks: ['2', '3', '4', '5'] },
  cardOrder: { ranks: ['2', '3', '4', '5'] },
  zones: {
    hand: {
      per: 'player',
      visibility: 'owner',
      reveal: 'player.id == state.dummy && state.shown',
    },
    trick: { shared: true, visibility: 'all' },
    won: { per: 'team', visibility: 'none', countVisible: true },
  },
  setup: {
    shuffle: true,
    deal: { to: 'hand', count: 4 },
    // A hand nobody bid is dealt again by the same dealer.
    dealerRotation: "state.declarer == null ? 'none' : 'left'",
  },
  phases: [
    {
      name: 'call',
      order: 'dealer',
      rounds: 1,
      actions: [
        {
          type: 'bid',
          values: [11, 12],
          labels: { '11': '1♣', '12': '1♦' },
          if: 'state.declarer == null',
          effects: [
            { set: { 'state.declarer': 'player.id' } },
            { set: { 'state.dummy': '(player.id + 2) % 4' } },
            { set: { 'state.contract': 'player.bid' } },
          ],
        },
        { type: 'passBid' },
      ],
    },
    {
      name: 'play',
      if: 'state.declarer != null',
      repeat: 4,
      leader: { first: '(state.declarer + 1) % 4', then: 'lastTrickWinner' },
      control: { seat: 'state.dummy', by: 'state.declarer' },
      actions: [{ type: 'playToTrick', followSuit: true, effects: [{ set: 'state.shown' }] }],
      afterTrick: [
        { resolveTrick: 'highestTrumpElseHighestLed' },
        { moveTrick: 'won', of: 'winnerTeam' },
      ],
    },
  ],
  scoring: {
    perTeam: [{ add: 'team.tricks', track: { hands: 1, secret: 1 } }],
    trackLabels: { hands: 'Hands played', secret: null },
  },
  endCondition: { when: 'round >= 3', winner: 'highestScore', ties: 'share' },
  display: [
    {
      label: 'Contract',
      value: 'state.contract',
      labels: { '11': '1♣', '12': '1♦' },
    },
    { label: 'Declarer', value: 'state.declarer', format: 'player' },
  ],
};

/** The dealer bids 1♣ and the others pass: the dealer declares, their partner is dummy. */
function afterAuction(seed = 'dummy'): { state: GameState; declarer: number; dummy: number } {
  let state = createGame(dummyGame, {}, 4, seed);
  const declarer = state.dealer;
  state = play(state, { player: declarer, type: 'bid', value: 11 });
  for (let i = 1; i < 4; i++) {
    state = play(state, { player: (declarer + i) % 4, type: 'passBid' });
  }
  return { state, declarer, dummy: (declarer + 2) % 4 };
}

const firstCard = (state: GameState, player: number, by?: number): Move => {
  const move = getLegalMoves(state, by ?? player).find(
    (m) => m.type === 'playToTrick' && m.player === player,
  );
  if (!move) throw new Error(`No card for seat ${player}`);
  return move;
};

describe('control: one seat plays for another', () => {
  it("gives the dummy's moves to the declarer on the dummy's turn", () => {
    const { state, declarer, dummy } = afterAuction();
    const leader = (declarer + 1) % 4;
    expect(playersToAct(state)).toEqual([leader]);
    const s = play(state, firstCard(state, leader));
    expect(s.cursor.current).toBe(dummy);
    expect(getLegalMoves(s, dummy)).toEqual([]);
    expect(playersToAct(s)).toEqual([declarer]);
    const moves = getLegalMoves(s, declarer);
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(m).toMatchObject({ player: dummy, by: declarer });
    expect(viewFor(s, declarer).control).toEqual({ seat: dummy, by: declarer });
  });

  it("plays the dummy's card from the dummy's hand, and logs who chose it", () => {
    const { state, declarer, dummy } = afterAuction();
    const s1 = play(state, firstCard(state, (declarer + 1) % 4));
    const move = firstCard(s1, dummy, declarer);
    const s2 = applyMove(s1, move);
    expect(s2.zones[`hand@${dummy}`]).toHaveLength(3);
    expect(s2.zones[`hand@${declarer}`]).toHaveLength(4);
    expect(s2.log.at(-1)).toEqual(move);
    expect(s2.cursor.current).toBe((dummy + 1) % 4);
  });

  it('refuses the dummy playing for itself, or anyone else playing for it', () => {
    const { state, declarer, dummy } = afterAuction();
    const s = play(state, firstCard(state, (declarer + 1) % 4));
    const { by: _by, ...own } = firstCard(s, dummy, declarer);
    expect(() => applyMove(s, own)).toThrow();
    const other = (declarer + 1) % 4;
    expect(() => applyMove(s, { ...own, by: other })).toThrow();
  });

  it('refuses `by` when nobody is controlled', () => {
    const state = createGame(dummyGame, {}, 4, 'dummy');
    const dealer = state.dealer;
    const partner = (dealer + 2) % 4;
    expect(() => applyMove(state, { player: dealer, type: 'passBid', by: partner })).toThrow();
    expect(() =>
      applyMove(state, { player: dealer, type: 'arrange', groups: [], by: partner }),
    ).toThrow('Only you can arrange your hand');
  });

  it('lets the declarer play their own cards too', () => {
    const { state, declarer, dummy } = afterAuction();
    let s = play(state, firstCard(state, (declarer + 1) % 4));
    s = play(s, firstCard(s, dummy, declarer));
    s = play(s, firstCard(s, (dummy + 1) % 4));
    expect(s.cursor.current).toBe(declarer);
    const own = getLegalMoves(s, declarer);
    expect(own.length).toBeGreaterThan(0);
    for (const m of own) expect(m.by).toBeUndefined();
  });

  it('plays a whole game with control and reveal without leaks', () => {
    let state = createGame(dummyGame, {}, 4, 'whole');
    for (let guard = 0; state.status !== 'over' && guard < 500; guard++) {
      const [actor] = playersToAct(state);
      const move = getLegalMoves(state, actor as number)[0] as Move;
      state = applyMove(state, move);
      expect(findHiddenCardLeak(state)).toBeNull();
    }
    expect(state.status).toBe('over');
  });

  it('rejects a control expression that gives something other than a seat', () => {
    const bad: GameFile = {
      ...dummyGame,
      phases: dummyGame.phases.map((p) =>
        p.control ? { ...p, control: { seat: "'north'", by: 'state.declarer' } } : p,
      ),
    };
    let state = createGame(bad, {}, 4, 'dummy');
    const declarer = state.dealer;
    state = play(state, { player: declarer, type: 'bid', value: 11 });
    for (let i = 1; i < 4; i++)
      state = play(state, { player: (declarer + i) % 4, type: 'passBid' });
    // The play phase has begun: asking who can move works out the control, and fails.
    expect(() => getLegalMoves(state, (declarer + 1) % 4)).toThrow('expected a seat');
  });
});

describe('reveal: a hand shown to everyone', () => {
  it('keeps the dummy hidden until the opening lead, then shows it to everyone', () => {
    const { state, declarer, dummy } = afterAuction();
    const other = (declarer + 1) % 4;
    expect(viewFor(state, other).zones[`hand@${dummy}`]).toMatchObject({ kind: 'count' });
    const s = play(state, firstCard(state, other));
    for (let seat = 0; seat < 4; seat++) {
      expect(viewFor(s, seat).zones[`hand@${dummy}`]).toMatchObject({ kind: 'cards' });
    }
    // Only the dummy's hand: the declarer's stays private.
    expect(viewFor(s, other).zones[`hand@${declarer}`]).toMatchObject({ kind: 'count' });
    expect(findHiddenCardLeak(s)).toBeNull();
  });
});

describe('words for bids, display values and counters', () => {
  it('sends bid labels, display labels and formats, and counter labels in the view', () => {
    const { state, declarer } = afterAuction();
    const view = viewFor(state, 0);
    expect(view.bidLabels).toEqual({ '11': '1♣', '12': '1♦' });
    expect(view.display).toEqual([
      { label: 'Contract', value: '1♣' },
      { label: 'Declarer', value: declarer, format: 'player' },
    ]);
    expect(view.trackLabels).toEqual({ hands: 'Hands played', secret: null });
  });

  it('checks labels against the bids and counters that exist', () => {
    const file: GameFile = {
      ...dummyGame,
      phases: dummyGame.phases.map((p, i) =>
        i === 0
          ? {
              ...p,
              actions: [
                { type: 'bid', values: { range: [1, 3] }, labels: { '4': 'Four' } },
                { type: 'passBid' },
              ],
            }
          : p,
      ),
      scoring: { ...dummyGame.scoring, trackLabels: { hand: 'Hands' } },
    };
    const result = validate(file);
    expect(result.ok).toBe(false);
    const messages = result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
    expect(messages.some((m) => m.includes('"4" isn\'t one of the values (1, 2, 3)'))).toBe(true);
    expect(messages.some((m) => m.includes('"hand" isn\'t tracked by any scoring rule'))).toBe(
      true,
    );
  });
});

describe('validation of control and reveal', () => {
  it('accepts the dummy game', () => {
    const result = validate(dummyGame);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('rejects reveal on a shared zone, and bad expressions', () => {
    const file: GameFile = {
      ...dummyGame,
      zones: {
        ...dummyGame.zones,
        trick: { shared: true, visibility: 'none', reveal: 'true' },
        won: { per: 'team', visibility: 'none', reveal: 'player.id == 0' },
      },
      setup: { ...dummyGame.setup, dealerRotation: 'state.' },
      phases: dummyGame.phases.map((p) =>
        p.control ? { ...p, control: { seat: 'card.rank', by: 'state.declarer' } } : p,
      ),
    };
    const result = validate(file);
    const messages = result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
    expect(messages.some((m) => m.includes('"reveal" is for a player\'s or team\'s zone'))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes('won') && m.includes('"player" isn\'t available'))).toBe(
      true,
    );
    expect(messages.some((m) => m.includes('dealerRotation'))).toBe(true);
    expect(messages.some((m) => m.includes('control') && m.includes('"card"'))).toBe(true);
  });
});

describe('dealerRotation as an expression', () => {
  it('keeps the dealer after a passed-out hand and moves on after a played one', () => {
    let state = createGame(dummyGame, {}, 4, 'rotate');
    const dealer = state.dealer;
    for (let i = 0; i < 4; i++) {
      state = play(state, { player: (dealer + i) % 4, type: 'passBid' });
    }
    expect(state.round).toBe(2);
    expect(state.dealer).toBe(dealer);

    state = play(state, { player: dealer, type: 'bid', value: 12 });
    for (let i = 1; i < 4; i++) state = play(state, { player: (dealer + i) % 4, type: 'passBid' });
    while (state.round === 2) {
      const [actor] = playersToAct(state);
      state = applyMove(state, getLegalMoves(state, actor as number)[0] as Move);
    }
    expect(state.dealer).toBe((dealer + 1) % 4);
  });
});

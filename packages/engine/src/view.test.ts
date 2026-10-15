import { describe, expect, it } from 'vitest';
import { miniRummy, sevensUp, spades, tinyTricks } from './__fixtures__/games';
import { validate } from './schema/validate';
import { id, play } from './testing';
import { createGame, viewFor } from './api';
import type { GameState } from './game/state';
import type { GameFile } from './game/types';

/** Ids of every card in other players' owner-only zones. */
function othersHiddenCards(state: GameState, viewer: number): string[] {
  return Object.entries(state.zones)
    .filter(([key]) => key.startsWith('hand@') && key !== `hand@${viewer}`)
    .flatMap(([, cards]) => cards.map((c) => c.id));
}

describe('viewFor', () => {
  it("shows your own hand but only the size of everyone else's", () => {
    const state = createGame(spades, {}, 4, 'view');
    const me = state.cursor.current;
    const view = viewFor(state, me);
    expect(view.zones[`hand@${me}`]).toEqual({ kind: 'cards', cards: state.zones[`hand@${me}`] });
    for (let seat = 0; seat < 4; seat++) {
      if (seat === me) continue;
      expect(view.zones[`hand@${seat}`]).toEqual({ kind: 'count', count: 13, top: null });
    }
    const json = JSON.stringify(view);
    for (const cardId of othersHiddenCards(state, me)) expect(json).not.toContain(cardId);
  });

  it('never includes the seed or random number state', () => {
    const state = createGame(spades, {}, 4, 'secret-seed');
    const view = viewFor(state, 0) as unknown as Record<string, unknown>;
    expect(view.rng).toBeUndefined();
    expect(view.seed).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('secret-seed');
  });

  it('shows only counts for face-down piles, and the top of top-card piles', () => {
    const state = createGame(sevensUp, {}, 3, 'piles');
    const view = viewFor(state, 0);
    expect(view.zones.stock).toEqual({
      kind: 'count',
      count: state.zones.stock?.length,
      top: null,
    });
    expect(view.zones.discard).toEqual({
      kind: 'count',
      count: 1,
      top: state.zones.discard?.[0],
    });
  });

  it('hides piles with no visible count entirely', () => {
    const hiddenWon = {
      ...tinyTricks,
      zones: { ...tinyTricks.zones, won: { per: 'player' as const, visibility: 'none' as const } },
    };
    const state = createGame(hiddenWon, {}, 2, 'hidden');
    expect(viewFor(state, 0).zones['won@0']).toEqual({ kind: 'hidden' });
  });

  it('shows cards played to the trick', () => {
    const start = createGame(tinyTricks, {}, 2, 'trick');
    const leader = start.cursor.current;
    const state = play(start, { player: leader, type: 'playToTrick', card: id('3H') });
    const other = 1 - leader;
    expect(viewFor(state, other).trick?.plays).toEqual([
      { player: leader, card: state.trick?.plays[0]?.card },
    ]);
    expect(viewFor(state, other).trick?.zone).toBe('trick');
    expect(viewFor(start, other).trickZones).toEqual(['trick']);
    expect(viewFor(createGame(sevensUp, {}, 3, 'trick'), 0).trickZones).toEqual([]);
    expect(viewFor(state, other).log).toEqual(state.log);
  });

  it('says who is winning the trick so far, by the rule that will decide it', () => {
    // Tiny Tricks: highest card of the suit led wins. L holds 5S 3S 5H 3H, D 4S 2S 4H 2H.
    const start = createGame(tinyTricks, {}, 2, 'leading');
    const L = start.cursor.current;
    const D = 1 - L;
    const card = (player: number, spec: string) => ({
      player,
      type: 'playToTrick' as const,
      card: id(spec),
    });
    expect(viewFor(start, D).trick?.leading).toBeNull();
    const led = play(start, card(L, '3H'));
    expect(viewFor(led, D).trick?.leading).toBe(L);
    // D's 4H takes it: the finished trick's winner.
    const done = play(led, card(D, '4H'));
    expect(viewFor(done, L).lastTrick?.leading).toBe(D);
    // The higher card of the suit led takes the lead.
    const next = play(done, card(D, '2S'), card(L, '5S'));
    expect(viewFor(next, D).lastTrick?.leading).toBe(L);
  });

  it("doesn't say who is winning a trick whose cards you can't all see", () => {
    const file: GameFile = {
      ...tinyTricks,
      zones: { ...tinyTricks.zones, trick: { shared: true, visibility: 'none' } },
    };
    const start = createGame(file, {}, 2, 'leading-hidden');
    const L = start.cursor.current;
    const led = play(start, { player: L, type: 'playToTrick', card: id('3H') });
    expect(viewFor(led, 1 - L).trick?.leading).toBeNull();
  });

  it("lets team members see their team's piles but not the other team's", () => {
    const teamPile = {
      ...spades,
      zones: { ...spades.zones, won: { per: 'team' as const, visibility: 'owner' as const } },
    };
    const state = createGame(teamPile, {}, 4, 'team');
    const view = viewFor(state, 0);
    expect(view.zones['won@t0']).toEqual({ kind: 'cards', cards: [] });
    expect(view.zones['won@t1']).toEqual({ kind: 'count', count: 0, top: null });
  });

  it('summarises players, teams and turn without private details', () => {
    const state = createGame(spades, {}, 4, 'summary');
    const view = viewFor(state, 2);
    expect(view.you).toBe(2);
    expect(view.game).toBe('Spades');
    expect(view.phase).toBe('bidding');
    expect(view.currentPlayer).toBe(state.cursor.current);
    expect(view.players).toHaveLength(4);
    expect(view.teams.map((t) => t.players)).toEqual([
      [0, 2],
      [1, 3],
    ]);
    expect(view.pending).toBeNull();
    expect(view.lastTrick).toBeNull();
  });
});

describe('showOnTable', () => {
  const withRule = (stock: string): GameFile => ({
    ...miniRummy,
    zones: {
      ...miniRummy.zones,
      stock: { shared: true, visibility: 'none', countVisible: true, showOnTable: stock },
    },
  });

  it('lists shared zones not drawn on the table right now', () => {
    expect(viewFor(createGame(miniRummy, {}, 2, 'table'), 0).offTable).toEqual([]);
    const hidden = viewFor(createGame(withRule('round > 1'), {}, 2, 'table'), 0);
    expect(hidden.offTable).toEqual(['stock']);
    // Its cards are still there.
    expect(hidden.zones.stock?.kind).toBe('count');
    expect(viewFor(createGame(withRule('round == 1'), {}, 2, 'table'), 0).offTable).toEqual([]);
  });

  it('is only for shared zones, and checks its expression', () => {
    const errors = (file: unknown) => {
      const result = validate(file);
      return result.ok ? [] : result.errors.map((e) => `${e.path}: ${e.message}`);
    };
    expect(errors(withRule('round > 1'))).toEqual([]);
    expect(
      errors({
        ...miniRummy,
        zones: {
          ...miniRummy.zones,
          hand: { per: 'player', visibility: 'owner', showOnTable: 'true' },
        },
      }),
    ).toEqual(['zones.hand.showOnTable: "showOnTable" is only for shared zones']);
    expect(errors(withRule('player.hand.count > 0'))).toEqual([
      expect.stringContaining('zones.stock.showOnTable'),
    ]);
  });
});

describe('dealer in expressions', () => {
  it("is the dealer's seat, and a display may show it", () => {
    const file: GameFile = {
      ...miniRummy,
      display: [{ label: 'Dealer', value: 'dealer', format: 'player' }],
    };
    expect(validate(file).ok).toBe(true);
    const state = createGame(file, {}, 2, 'dealer');
    expect(viewFor(state, 0).display).toEqual([
      { label: 'Dealer', value: state.dealer, format: 'player' },
    ]);
  });
});

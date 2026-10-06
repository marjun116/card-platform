import { describe, expect, it } from 'vitest';
import { sevensUp, spades, tinyTricks } from './__fixtures__/games';
import { id, play } from './__fixtures__/helpers';
import { createGame, viewFor } from './api';
import type { GameState } from './game/state';

/** Ids of every card in other players' owner-only zones. */
function othersHiddenCards(state: GameState, viewer: number): string[] {
  return Object.entries(state.zones)
    .filter(([key]) => key.startsWith('hand@') && key !== `hand@${viewer}`)
    .flatMap(([, cards]) => cards.map((c) => c.id));
}

describe('viewFor', () => {
  it("shows your own hand but only the size of everyone else's", () => {
    const state = play(createGame(spades, {}, 4, 'view'), {
      player: createGame(spades, {}, 4, 'view').cursor.current,
      type: 'lookAtHand',
    });
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
    expect(viewFor(state, other).log).toEqual(state.log);
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

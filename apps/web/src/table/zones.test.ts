import { viewFor } from '@card-table/engine';
import { describe, expect, it } from 'vitest';
import { createGame, miniRummy, playUntil, sevensUp, spades } from '../test/games';
import {
  cardsOverlap,
  humanize,
  layoutZones,
  parseZoneKey,
  seatPosition,
  trickAreaSize,
  trickLayout,
  zoneCount,
} from './zones';

describe('layoutZones', () => {
  it('puts your hand at the bottom and other hands at their seats (spades)', () => {
    const view = viewFor(createGame(spades, {}, 4, 'zones'), 1);
    const layout = layoutZones(view);
    expect(layout.hand?.key).toBe('hand@1');
    expect(layout.hand?.view.kind).toBe('cards');
    expect([...layout.seats.keys()].sort()).toEqual([0, 2, 3]);
    expect(layout.seats.get(0)?.[0]?.view).toEqual({ kind: 'count', count: 13, top: null });
    // Won tricks belong to teams; the trick zone isn't drawn as a pile.
    expect([...layout.teams.keys()].sort()).toEqual([0, 1]);
    expect(layout.piles).toEqual([]);
  });

  it('draws shared piles in the middle (Sevens Up)', () => {
    const view = viewFor(createGame(sevensUp, {}, 3, 'zones'), 0);
    const piles = layoutZones(view).piles;
    expect(piles.map((p) => p.name)).toEqual(['discard', 'stock']);
    expect(piles[0]?.view).toMatchObject({ kind: 'count', count: 1 });
  });

  it('keeps your melds with you and shows other players their melds (rummy)', () => {
    const state = playUntil(createGame(miniRummy, {}, 2, 'zones'), (s) =>
      Object.values(s.melds).some((m) => m.length > 0),
    );
    const melder = Object.entries(state.melds).find(([, m]) => m.length > 0)?.[0] ?? '';
    const seat = parseZoneKey(melder).seat as number;
    expect(layoutZones(viewFor(state, seat)).mine[0]?.view.kind).toBe('melds');
    const other = layoutZones(viewFor(state, 1 - seat));
    expect(other.seats.get(seat)?.find((z) => z.name === 'melds')?.view.kind).toBe('melds');
  });

  it('leaves the trick zone out of the piles while a trick is being played', () => {
    const state = playUntil(
      createGame(spades, {}, 4, 'zones'),
      (s) => (s.trick?.plays.length ?? 0) > 0,
    );
    const view = viewFor(state, 0);
    expect(view.trick?.zone).toBe('trick');
    expect(layoutZones(view).piles.map((p) => p.key)).not.toContain('trick');
  });
});

describe('zone helpers', () => {
  it('reads zone keys', () => {
    expect(parseZoneKey('hand@2')).toEqual({ name: 'hand', seat: 2, team: null });
    expect(parseZoneKey('won@t1')).toEqual({ name: 'won', seat: null, team: 1 });
    expect(parseZoneKey('stock')).toEqual({ name: 'stock', seat: null, team: null });
  });

  it('counts cards in any zone view', () => {
    expect(zoneCount({ kind: 'count', count: 4, top: null })).toBe(4);
    expect(zoneCount({ kind: 'hidden' })).toBeNull();
    expect(zoneCount({ kind: 'melds', melds: [[], []] })).toBe(0);
  });

  it('turns zone names into labels', () => {
    expect(humanize('won')).toBe('Won');
    expect(humanize('drawPile')).toBe('Draw pile');
    expect(humanize('blindNil')).toBe('Blind nil');
  });

  it('seats the viewer at the bottom and the next seat on their left', () => {
    expect(seatPosition(2, 2, 4)).toEqual({ order: 0, x: 50, y: 90 });
    expect(seatPosition(3, 2, 4)).toEqual({ order: 1, x: 8, y: 50 });
    expect(seatPosition(0, 2, 4)).toEqual({ order: 2, x: 50, y: 10 });
    expect(seatPosition(1, 2, 4)).toEqual({ order: 3, x: 92, y: 50 });
  });
});

describe('trickLayout', () => {
  const counts = [2, 3, 4, 5, 6, 7, 8, 9, 10];

  it.each(counts.flatMap((n) => [[n, 'wide'] as const, [n, 'tall'] as const]))(
    'fits %i cards in a %s ring without any overlapping',
    (n, shape) => {
      const layout = trickLayout(0, n, shape);
      const spots = Array.from({ length: n }, (_, seat) => layout.spot(seat));
      expect(cardsOverlap(spots)).toBe(false);
      // Every card lies inside the trick area.
      const { width, height } = trickAreaSize(layout);
      for (const { x, y } of spots) {
        expect(Math.abs(x) + 0.5).toBeLessThanOrEqual(width / 2 + 1e-9);
        expect(Math.abs(y) + 0.75).toBeLessThanOrEqual(height / 2 + 1e-9);
      }
    },
  );

  it('makes a narrower ring for phones', () => {
    for (const n of [7, 10]) {
      expect(trickAreaSize(trickLayout(0, n, 'tall')).width).toBeLessThan(
        trickAreaSize(trickLayout(0, n, 'wide')).width,
      );
    }
  });

  it('puts your card at the bottom and the next seat on your left', () => {
    const layout = trickLayout(2, 4);
    expect(layout.spot(2).y).toBeGreaterThan(0);
    expect(layout.spot(3).x).toBeLessThan(0);
    expect(layout.spot(0).y).toBeLessThan(0);
  });

  it('uses smaller cards and a bigger ring as players are added', () => {
    expect(trickLayout(0, 4).size).toBe('normal');
    expect(trickLayout(0, 5).size).toBe('small');
    expect(trickLayout(0, 10).ry).toBeGreaterThan(trickLayout(0, 4).ry);
  });

  it('notices overlapping cards', () => {
    expect(
      cardsOverlap([
        { x: 0, y: 0 },
        { x: 0.9, y: 1.4 },
      ]),
    ).toBe(true);
    expect(
      cardsOverlap([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toBe(false);
  });
});

/**
 * What "Show all hands" draws for one moment of a finished round: every
 * player's cards face up, and shared or team piles as the table shows them
 * (the top card and a count), so the stock isn't spread out as a row of cards.
 */
import type { Move, OpenView, TrickView } from '@card-table/engine';
import { sortHand } from './cards';
import { type PlacedZone, parseZoneKey } from './zones';

export interface ReplayZones {
  /** Each player's own zones, their hand first, cards sorted as your hand is. */
  seats: Map<number, PlacedZone[]>;
  /** Each team's zones (melds, won cards). */
  teams: Map<number, PlacedZone[]>;
  /** Zones everyone shares, other than the trick. */
  piles: PlacedZone[];
}

export function replayZones(frame: OpenView, trickZones: readonly string[]): ReplayZones {
  const zones: ReplayZones = { seats: new Map(), teams: new Map(), piles: [] };
  const add = <K>(map: Map<K, PlacedZone[]>, key: K, zone: PlacedZone) =>
    map.set(key, [...(map.get(key) ?? []), zone]);
  for (const [key, view] of Object.entries(frame.zones)) {
    const { name, seat, team } = parseZoneKey(key);
    if (trickZones.includes(name)) continue;
    if (seat !== null) {
      const sorted: PlacedZone['view'] =
        view.kind === 'cards' ? { kind: 'cards', cards: sortHand(view.cards, frame.trump) } : view;
      add(zones.seats, seat, { key, name, view: sorted });
      continue;
    }
    // A shared pile shows its top card and how many are in it, as on the table; a
    // team's pile (won tricks) just its count.
    const top = team === null && view.kind === 'cards' ? (view.cards.at(-1) ?? null) : null;
    const shown: PlacedZone['view'] =
      view.kind === 'cards' ? { kind: 'count', count: view.cards.length, top } : view;
    if (team !== null) add(zones.teams, team, { key, name, view: shown });
    else zones.piles.push({ key, name, view: shown });
  }
  for (const [seat, list] of zones.seats) {
    zones.seats.set(
      seat,
      [...list].sort((a, b) => Number(b.name === 'hand') - Number(a.name === 'hand')),
    );
  }
  return zones;
}

/**
 * The trick to draw: the one being played, or, just after its last card, the
 * finished trick with its winner (the engine has already moved it to a pile).
 */
export function shownTrick(frame: OpenView, move: Move | null): TrickView | null {
  if (frame.trick && frame.trick.plays.length > 0) return frame.trick;
  return move?.type === 'playToTrick' ? frame.lastTrick : null;
}

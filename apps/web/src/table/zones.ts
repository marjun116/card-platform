/**
 * Where each zone of a player's view goes on the table. Works only from
 * zone keys and what the view contains, never from the game's name:
 *
 *   "hand@2"  a zone belonging to seat 2
 *   "won@t1"  a zone belonging to team 1
 *   "stock"   a shared zone
 */
import type { PlayerView, ZoneView } from '@card-table/engine';

export interface PlacedZone {
  key: string;
  /** The zone's name in the game file, e.g. "hand" or "won". */
  name: string;
  view: ZoneView;
}

export interface TableLayout {
  /** Your hand (null if the game somehow has none). */
  hand: PlacedZone | null;
  /** Your other zones, such as your melds. */
  mine: PlacedZone[];
  /** Other players' zones, by seat. */
  seats: Map<number, PlacedZone[]>;
  /** Team zones, by team. */
  teams: Map<number, PlacedZone[]>;
  /** Shared zones other than trick zones. */
  piles: PlacedZone[];
}

export function parseZoneKey(key: string): {
  name: string;
  seat: number | null;
  team: number | null;
} {
  const [name = key, owner] = key.split('@');
  if (owner === undefined) return { name, seat: null, team: null };
  if (owner.startsWith('t')) return { name, seat: null, team: Number(owner.slice(1)) };
  return { name, seat: Number(owner), team: null };
}

export function layoutZones(view: PlayerView): TableLayout {
  const layout: TableLayout = {
    hand: null,
    mine: [],
    seats: new Map(),
    teams: new Map(),
    piles: [],
  };
  const trickZones = new Set(view.trickZones);
  for (const [key, zoneView] of Object.entries(view.zones).sort(([a], [b]) => a.localeCompare(b))) {
    const { name, seat, team } = parseZoneKey(key);
    const zone: PlacedZone = { key, name, view: zoneView };
    if (seat === view.you) {
      if (name === 'hand') layout.hand = zone;
      else layout.mine.push(zone);
    } else if (seat !== null) {
      const list = layout.seats.get(seat) ?? [];
      list.push(zone);
      layout.seats.set(seat, list);
    } else if (team !== null) {
      const list = layout.teams.get(team) ?? [];
      list.push(zone);
      layout.teams.set(team, list);
    } else if (!trickZones.has(name)) {
      layout.piles.push(zone);
    }
  }
  return layout;
}

/** How many cards a zone holds, whatever the viewer may see of it (null if hidden). */
export function zoneCount(view: ZoneView): number | null {
  switch (view.kind) {
    case 'cards':
      return view.cards.length;
    case 'melds':
      return view.melds.reduce((sum, meld) => sum + meld.length, 0);
    case 'count':
      return view.count;
    case 'hidden':
      return null;
  }
}

/** "won" → "Won", "drawPile" → "Draw pile". */
export function humanize(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Where a seat sits around the table, relative to the viewer: the viewer at
 * the bottom, then clockwise (to the viewer's left) around an oval. x and y
 * are percentages of the table area.
 */
export function seatPosition(
  seat: number,
  you: number,
  playerCount: number,
): { order: number; x: number; y: number } {
  const order = (seat - you + playerCount) % playerCount;
  const angle = Math.PI / 2 + (order * 2 * Math.PI) / playerCount;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { order, x: round(50 + 42 * Math.cos(angle)), y: round(50 + 40 * Math.sin(angle)) };
}

/** Cards are this many times taller than they are wide. */
const CARD_RATIO = 1.5;

export interface TrickLayout {
  /** Smaller cards once there are many players, so the ring stays a sensible size. */
  size: 'normal' | 'small';
  /** Half the ring's width and height, measured between card centres, in card widths. */
  rx: number;
  ry: number;
  /** Each seat's card centre, relative to the middle of the ring, in card widths. */
  spot: (seat: number) => { x: number; y: number };
}

/**
 * Where the cards of a trick go: in a ring, each on the side of the player
 * who played it (same order as seatPosition). The ring grows with the
 * number of players so that neighbouring cards don't cover each other.
 */
export function trickLayout(you: number, playerCount: number): TrickLayout {
  const n = Math.max(playerCount, 2);
  // Card centres for a ring of half-width rx and half-height ry, viewer's card first.
  const ring = (rx: number, ry: number) =>
    Array.from({ length: n }, (_, order) => {
      const angle = Math.PI / 2 + (order * 2 * Math.PI) / n;
      return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
    });
  // Start small and grow the ring until no two cards overlap.
  let rx = 1.3;
  let ry = 1.2;
  while (cardsOverlap(ring(rx, ry))) {
    rx *= 1.05;
    ry *= 1.05;
  }
  const spots = ring(rx, ry);
  return {
    size: n > 4 ? 'small' : 'normal',
    rx,
    ry,
    spot: (seat) => spots[(seat - you + n) % n] ?? { x: 0, y: 0 },
  };
}

/** Whether any two cards (one wide, CARD_RATIO tall) centred at these points overlap. */
export function cardsOverlap(centres: { x: number; y: number }[]): boolean {
  return centres.some((a, i) =>
    centres.slice(i + 1).some((b) => Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < CARD_RATIO),
  );
}

/** The trick area's size in card widths: the ring plus half a card on every side. */
export function trickAreaSize(layout: TrickLayout): { width: number; height: number } {
  return { width: 2 * layout.rx + 1, height: 2 * layout.ry + CARD_RATIO };
}

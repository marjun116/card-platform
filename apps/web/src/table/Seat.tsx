/**
 * Another player's place at the table: name, turn, bid, tricks and their zones.
 *
 * On phones with five or more players, the seat shrinks to a two-line "chip"
 * (name and cards in hand; bid and tricks won) placed around the table, and
 * the full panel opens as a popup when the chip is tapped. CSS decides which
 * is shown (see `.felt.many` in styles.css); both are always rendered.
 */
import type { PlayerView } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { useId, useState } from 'react';
import { CardBack } from './Card';
import { bidLabel, type SeatNames, seatStats } from './describe';
import { ZoneDisplay } from './ZoneViews';
import { type PlacedZone, seatPosition } from './zones';

export function Seat({
  seat,
  view,
  table,
  zones,
  names,
  toAct,
  showTricks,
  onNudge,
}: {
  seat: number;
  view: PlayerView;
  table: TableInfo;
  zones: PlacedZone[];
  names: SeatNames;
  toAct: number[];
  showTricks: boolean;
  onNudge: (seat: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const player = view.players[seat];
  const info = table.seats.find((s) => s.seat === seat);
  const { order, x, y } = seatPosition(seat, view.you, view.players.length);
  const acting = toAct.includes(seat);
  const hand = zones.find((z) => z.name === 'hand');
  const others = zones.filter((z) => z !== hand);
  const handCount = hand?.view.kind === 'count' ? hand.view.count : null;
  const partner = player && view.players[view.you]?.team === player.team;
  const name = names(seat);
  const stats = seatStats(player, handCount, showTricks);

  const facts = [
    seat === view.dealer ? 'Dealer' : null,
    partner && view.teams[player.team]?.players.length !== 1 ? 'Partner' : null,
    player?.bid != null ? `Bid ${bidLabel(player.bid).toLowerCase()}` : null,
    showTricks && player ? `Won ${player.tricks}` : null,
    player && !player.active ? 'Out' : null,
  ].filter(Boolean);

  // Which way the popup opens, so it stays on the table.
  const popup = `${x > 50 ? 'from-right' : 'from-left'} ${y > 50 ? 'upwards' : 'downwards'}`;

  return (
    <section
      className={`seat${acting ? ' acting' : ''}${open ? ' open' : ''}`}
      style={{ ['--x' as string]: x, ['--y' as string]: y, ['--order' as string]: order }}
      aria-label={`${name}${acting ? ', to play' : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) setOpen(false);
      }}
    >
      <button
        type="button"
        className="seat-chip"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${name}${stats.spoken ? `, ${stats.spoken}` : ''}${acting ? ', to play' : ''}. Details`}
        onClick={() => setOpen(!open)}
      >
        <span className="chip-line">
          <span className="chip-name">{name}</span>
          {handCount !== null && <span className="chip-count">{handCount}</span>}
        </span>
        {stats.short && <span className="chip-line chip-stats">{stats.short}</span>}
      </button>

      <div className={`seat-panel ${popup}`} id={panelId}>
        <div className="seat-head">
          <span
            className={`presence ${info?.connected ? 'on' : 'off'}`}
            role="img"
            aria-label={info?.connected ? 'here' : 'away'}
          />
          <strong className="seat-player">{name}</strong>
          {acting && <span className="turn-badge">Turn</span>}
          {acting && info?.user && (
            <button
              type="button"
              className="link-button nudge"
              aria-label={`Nudge ${name}`}
              onClick={() => onNudge(seat)}
            >
              Nudge
            </button>
          )}
        </div>
        <div className="seat-body">
          {handCount !== null && (
            <span className="stack-count" role="img" aria-label={`${handCount} cards in hand`}>
              <CardBack size="tiny" />
              <span className="count" aria-hidden="true">
                {handCount}
              </span>
            </span>
          )}
          {facts.length > 0 && <span className="seat-facts">{facts.join(' · ')}</span>}
        </div>
        {others.map((zone) => (
          <ZoneDisplay key={zone.key} zone={zone} compact />
        ))}
      </div>
    </section>
  );
}

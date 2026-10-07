/** Another player's place at the table: name, turn, bid, tricks and their zones. */
import type { PlayerView } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { CardBack } from './Card';
import { bidLabel, type SeatNames } from './describe';
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
  const player = view.players[seat];
  const info = table.seats.find((s) => s.seat === seat);
  const { order, x, y } = seatPosition(seat, view.you, view.players.length);
  const acting = toAct.includes(seat);
  const hand = zones.find((z) => z.name === 'hand');
  const others = zones.filter((z) => z !== hand);
  const handCount = hand?.view.kind === 'count' ? hand.view.count : null;
  const partner = player && view.players[view.you]?.team === player.team;

  const facts = [
    seat === view.dealer ? 'Dealer' : null,
    partner && view.teams[player.team]?.players.length !== 1 ? 'Partner' : null,
    player?.bid != null ? `Bid ${bidLabel(player.bid).toLowerCase()}` : null,
    showTricks && player ? `Won ${player.tricks}` : null,
    player && !player.active ? 'Out' : null,
  ].filter(Boolean);

  return (
    <section
      className={`seat${acting ? ' acting' : ''}`}
      style={{ ['--x' as string]: x, ['--y' as string]: y, ['--order' as string]: order }}
      aria-label={`${names(seat)}${acting ? ', to play' : ''}`}
    >
      <div className="seat-head">
        <span
          className={`presence ${info?.connected ? 'on' : 'off'}`}
          role="img"
          aria-label={info?.connected ? 'here' : 'away'}
        />
        <strong className="seat-player">{names(seat)}</strong>
        {acting && <span className="turn-badge">Turn</span>}
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
        <ZoneDisplay key={zone.key} zone={zone} />
      ))}
      {acting && info?.user && (
        <button type="button" className="small" onClick={() => onNudge(seat)}>
          Nudge
        </button>
      )}
    </section>
  );
}

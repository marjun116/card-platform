/**
 * Another player's place at the table: name, turn, bid, tricks and their zones.
 *
 * On phones with five or more players, the seat shrinks to a two-line "chip"
 * (name and cards in hand; bid and tricks won) placed around the table, and
 * the full panel opens as a popup when the chip is tapped. CSS decides which
 * is shown (see `.felt.many` in styles.css); both are always rendered.
 */
import type { Card as CardData, PlayerView } from '@card-table/engine';
import type { TableInfo } from '@card-table/server/protocol';
import { useId, useState } from 'react';
import { Avatar } from './Avatar';
import { type SeatInitials, teamColour } from './avatars';
import { CardBack, CardFace } from './Card';
import { SUITS, sortHand, spokenLabel } from './cards';
import { bidWords, type SeatNames, seatStats } from './describe';
import { type Controls, isCardUsable } from './moves';
import { ZoneDisplay } from './ZoneViews';
import { type PlacedZone, seatPosition } from './zones';

export function Seat({
  seat,
  view,
  table,
  zones,
  names,
  initials,
  toAct,
  showTricks,
  onNudge,
  controls,
  selected,
  onPress,
  onReplace,
}: {
  seat: number;
  view: PlayerView;
  table: TableInfo;
  zones: PlacedZone[];
  names: SeatNames;
  initials: SeatInitials;
  toAct: number[];
  showTricks: boolean;
  onNudge: (seat: number) => void;
  /** Your moves: when you play this seat's cards (bridge's dummy), its cards use them. */
  controls: Controls;
  selected: readonly string[];
  onPress: (card: CardData) => void;
  /** Host only: a bot takes over this (disconnected) player's seat. */
  onReplace?: (seat: number) => void;
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
  // A hand shown to everyone (bridge's dummy), which you may be the one playing.
  const openCards = hand?.view.kind === 'cards' ? hand.view.cards : null;
  const playedBy = view.control?.seat === seat ? view.control.by : null;
  const partner = player && view.players[view.you]?.team === player.team;
  const name = names(seat);
  const stats = seatStats(player, handCount, showTricks, view.bidLabels);

  const team = player?.team ?? seat;
  const dealer = seat === view.dealer;
  const facts = [
    partner && view.teams[player.team]?.players.length !== 1 ? 'Partner' : null,
    player?.bid != null ? `Bid ${bidWords(player.bid, view.bidLabels)}` : null,
    playedBy !== null ? `Played by ${playedBy === view.you ? 'you' : names(playedBy)}` : null,
    showTricks && player ? `Won ${player.tricks}` : null,
    player && !player.active ? 'Out' : null,
    player?.sittingOut ? 'Sitting out' : null,
    info?.bot ? 'Bot' : null,
  ].filter(Boolean);
  // A player who left can be replaced by a bot (built-in games only).
  const replaceable = table.botsAllowed && info?.user && !info.bot && !info.connected;

  // Which way the popup opens, so it stays on the table.
  const popup = `${x > 50 ? 'from-right' : 'from-left'} ${y > 50 ? 'upwards' : 'downwards'}`;

  return (
    <section
      className={`seat${acting ? ' acting' : ''}${dealer ? ' dealer' : ''}${open ? ' open' : ''}${openCards ? ' has-open-hand' : ''}`}
      style={{
        ['--x' as string]: x,
        ['--y' as string]: y,
        ['--order' as string]: order,
        ['--team' as string]: teamColour(team),
      }}
      aria-label={`${name}${dealer ? ', dealer' : ''}${acting ? ', to play' : ''}`}
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
        {/* The avatar stands beside the name and details; the here/away dot sits on it. */}
        <div className="seat-id">
          <Avatar initials={initials(seat)} team={team}>
            <span
              className={`presence ${info?.connected ? 'on' : 'off'}`}
              role="img"
              aria-label={info?.connected ? 'here' : 'away'}
            />
          </Avatar>
          <div className="seat-lines">
            <div className="seat-head">
              <strong className="seat-player">{name}</strong>
              {acting && <span className="turn-badge">Turn</span>}
              {acting && info?.user && !info.bot && (
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
              {(dealer || facts.length > 0) && (
                <span className="seat-facts">
                  {/* Same colour as the outline round the dealer's seat. */}
                  {dealer && <span className="dealer-tag">Dealer</span>}
                  {dealer && facts.length > 0 && ' · '}
                  {facts.join(' · ')}
                </span>
              )}
            </div>
          </div>
        </div>
        {replaceable && onReplace && (
          <button
            type="button"
            className="link-button replace-bot"
            aria-label={`Replace ${name} with a bot`}
            onClick={() => onReplace(seat)}
          >
            Replace with bot
          </button>
        )}
        {openCards && (
          <OpenHand
            cards={openCards}
            name={name}
            controls={playedBy === view.you ? controls : null}
            selected={selected}
            onPress={onPress}
          />
        )}
        {others.map((zone) => (
          <ZoneDisplay key={zone.key} zone={zone} compact />
        ))}
      </div>
    </section>
  );
}

/**
 * Another player's hand shown face up (bridge's dummy), in a row per suit.
 * When you play its cards, each card is a button that works like the cards
 * in your own hand.
 */
function OpenHand({
  cards,
  name,
  controls,
  selected,
  onPress,
}: {
  cards: readonly CardData[];
  name: string;
  controls: Controls | null;
  selected: readonly string[];
  onPress: (card: CardData) => void;
}) {
  const sorted = sortHand(cards);
  const rows = [
    ...SUITS.map((suit) => sorted.filter((c) => 'suit' in c && c.suit === suit)),
    sorted.filter((c) => !('suit' in c)),
  ]
    .filter((row) => row.length > 0)
    // High cards first, as a hand laid out on the table reads.
    .map((row) => [...row].reverse());
  const choosing = controls !== null && controls.byCard.size > 0;
  return (
    <div
      className={`open-hand${controls ? ' yours' : ''}`}
      role="group"
      aria-label={`${name}'s hand, face up: ${cards.length} card${cards.length === 1 ? '' : 's'}`}
    >
      {rows.map((row) => (
        <div key={row[0]?.id} className="open-row">
          {row.map((card) => {
            if (!controls) return <CardFace key={card.id} card={card} size="tiny" />;
            const usable = isCardUsable(controls, card.id);
            const isSelected = selected.includes(card.id);
            const state = [
              choosing && usable ? 'playable' : null,
              choosing && !usable ? 'unusable' : null,
              isSelected ? 'selected' : null,
            ];
            return (
              <button
                key={card.id}
                type="button"
                className={['hand-card', ...state].filter(Boolean).join(' ')}
                aria-pressed={isSelected}
                aria-disabled={!usable}
                aria-label={`${spokenLabel(card)}${choosing && !usable ? ", can't be played now" : ''}`}
                onClick={() => usable && onPress(card)}
              >
                <CardFace card={card} size="small" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

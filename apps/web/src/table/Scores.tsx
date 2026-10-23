/** The scoreboard, round summaries and the history of every round. */
import type { BidValue, PlayerView, RoundResult } from '@card-table/engine';
import { type ReactNode, useEffect, useRef } from 'react';
import { Avatar, TeamDot } from './Avatar';
import { CountUp } from './CountUp';
import { type SeatInitials, teamColour } from './avatars';
import { type BidLabels, bidWords, type SeatNames, teamName } from './describe';
import { ScoreTrend } from './ScoreTrend';
import { SuitText } from './SuitText';
import { leaders, signed, tracksText } from './summary';
import { ZoneDisplay } from './ZoneViews';
import { humanize, type PlacedZone, zoneCount } from './zones';

type Team = PlayerView['teams'][number];

function bidText(bid: BidValue | null, labels: BidLabels = {}): string {
  return bid === null ? '–' : bidWords(bid, labels);
}

/** Current scores, and this round's bids and tricks so far. */
export function Scoreboard({
  view,
  names,
  initials,
  teamZones,
  showTricks,
}: {
  view: PlayerView;
  names: SeatNames;
  initials: SeatInitials;
  teamZones: Map<number, PlacedZone[]>;
  showTricks: boolean;
}) {
  const showBids = view.players.some((p) => p.bid !== null);
  const lead = leaders(view.teams, view.goal.winner);
  return (
    <section className="scoreboard" aria-label="Scores">
      <h2>Scores</h2>
      <ul>
        {view.teams.map((team) => {
          const mine = team.players.includes(view.you);
          const tracks = tracksText({ ...team.tracks, ...team.held }, view.trackLabels);
          return (
            <li
              key={team.id}
              className={`team-entry${mine ? ' mine' : ''}`}
              style={{ ['--team' as string]: teamColour(team.id) }}
            >
              <div className="team-row">
                <TeamAvatars team={team} initials={initials} />
                <span className="team-name">
                  {teamName(team, names)}
                  {lead.includes(team.id) && (
                    <>
                      <span className="crown" aria-hidden="true">
                        ♛
                      </span>
                      <span className="visually-hidden"> (leading)</span>
                    </>
                  )}
                </span>
                <CountUp value={team.score} className="team-score" />
              </div>
              {tracks && <div className="muted">{tracks}</div>}
              {/* One-player teams already show their name; their bid and tricks fit on one line. */}
              {(showBids || showTricks) && team.players.length === 1 && (
                <div className="muted">
                  <SuitText
                    text={[
                      showBids
                        ? `bid ${bidText(view.players[team.players[0] ?? 0]?.bid ?? null, view.bidLabels)}`
                        : null,
                      showTricks ? `won ${view.players[team.players[0] ?? 0]?.tricks ?? 0}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  />
                </div>
              )}
              {(showBids || showTricks) && team.players.length > 1 && (
                <ul className="team-players">
                  {team.players.map((seat) => {
                    const player = view.players[seat];
                    if (!player) return null;
                    return (
                      <li key={seat}>
                        <span>{names(seat)}</span>
                        {showBids && (
                          <span>
                            bid <SuitText text={bidText(player.bid, view.bidLabels)} />
                          </span>
                        )}
                        {showTricks && <span>won {player.tricks}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {(teamZones.get(team.id) ?? []).map((zone) => {
                const count = zoneCount(zone.view);
                // Cards a team can see are drawn; piles it can't are just a count.
                return zone.view.kind === 'cards' || zone.view.kind === 'melds' ? (
                  <ZoneDisplay key={zone.key} zone={zone} />
                ) : count === null ? null : (
                  <div key={zone.key} className="muted">
                    {humanize(zone.name)} pile: {count} card{count === 1 ? '' : 's'}
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The avatars of a team's players, overlapping a little. */
export function TeamAvatars({
  team,
  initials,
}: {
  team: Pick<Team, 'id' | 'players'>;
  initials: SeatInitials;
}) {
  return (
    <span className="team-avatars">
      {team.players.map((seat) => (
        <Avatar key={seat} initials={initials(seat)} team={team.id} size="small" />
      ))}
    </span>
  );
}

/** All rounds so far, with each team's running total, drawn as a chart and in a table. */
export function HistoryTable({
  history,
  teams,
  names,
  target = null,
}: {
  history: RoundResult[];
  teams: Pick<Team, 'id' | 'players'>[];
  names: SeatNames;
  /** The score the game is played to, drawn as a dashed line on the chart. */
  target?: number | null;
}) {
  if (history.length === 0) return <p className="muted">No rounds finished yet.</p>;
  return (
    <>
      <ScoreTrend history={history} target={target} />
      <table className="history-table">
        <caption className="visually-hidden">Scores after each round</caption>
        <thead>
          <tr>
            <th scope="col">Round</th>
            {teams.map((team) => (
              <th scope="col" key={team.id}>
                <TeamDot team={team.id} /> {teamName(team, names)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {history.map((result) => (
            <tr key={result.round}>
              <th scope="row">{result.round}</th>
              {result.teams.map((team) => (
                <td key={team.id}>
                  {team.score} <span className="muted">({signed(team.points)})</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** A modal dialog using the browser's own <dialog>, which traps focus and closes on Esc. */
export function Dialog({
  title,
  onClose,
  children,
  closeLabel = 'Continue',
  startAtTop = false,
  closeOnOutsideClick = false,
  extraAction,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
  /** Focus the title rather than the button, so long content opens at its start. */
  startAtTop?: boolean;
  /** A click on the darkened page around the dialog closes it too. */
  closeOnOutsideClick?: boolean;
  /** A second button beside the close button, which doesn't close the dialog itself. */
  extraAction?: { label: string; onSelect: () => void };
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Set while the page takes the dialog away, so that isn't taken for the player closing it.
  const removing = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    removing.current = false;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    if (startAtTop) titleRef.current?.focus();
    return () => {
      removing.current = true;
      if (typeof dialog.close === 'function') dialog.close();
    };
  }, [startAtTop]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      // The close event arrives after the fact; ignore it if the dialog was opened again
      // meanwhile (React mounts components twice in development).
      onClose={() => {
        if (!removing.current && !ref.current?.open) onClose();
      }}
      // A click on the backdrop is reported as a click on the dialog itself, as is one on
      // its padding, so only a click outside the dialog's box counts.
      onClick={(event) => {
        const dialog = ref.current;
        if (!closeOnOutsideClick || !dialog || event.target !== dialog) return;
        const box = dialog.getBoundingClientRect();
        const outside =
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom;
        if (!outside) return;
        if (typeof dialog.close === 'function') dialog.close();
        else onClose();
      }}
    >
      <h2 id="dialog-title" ref={titleRef} tabIndex={startAtTop ? -1 : undefined}>
        {title}
      </h2>
      {children}
      <form method="dialog" className="dialog-actions">
        {extraAction && (
          <button type="button" onClick={extraAction.onSelect}>
            {extraAction.label}
          </button>
        )}
        <button type="submit" className="primary" autoFocus={!startAtTop}>
          {closeLabel}
        </button>
      </form>
    </dialog>
  );
}

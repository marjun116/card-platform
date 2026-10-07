/** The scoreboard, round summaries and the history of every round. */
import type { PlayerView, RoundResult } from '@card-table/engine';
import { type ReactNode, useEffect, useRef } from 'react';
import { bidLabel, type SeatNames, teamName } from './describe';
import { ZoneDisplay } from './ZoneViews';
import { humanize, type PlacedZone, zoneCount } from './zones';

type Team = PlayerView['teams'][number];

function tracksText(tracks: Record<string, number>): string {
  return Object.entries(tracks)
    .map(([name, value]) => `${humanize(name)} ${value}`)
    .join(' · ');
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** Current scores, and this round's bids and tricks so far. */
export function Scoreboard({
  view,
  names,
  teamZones,
  showTricks,
}: {
  view: PlayerView;
  names: SeatNames;
  teamZones: Map<number, PlacedZone[]>;
  showTricks: boolean;
}) {
  const showBids = view.players.some((p) => p.bid !== null);
  return (
    <section className="scoreboard" aria-label="Scores">
      <h2>Scores</h2>
      <ul>
        {view.teams.map((team) => {
          const mine = team.players.includes(view.you);
          const tracks = tracksText(team.tracks);
          return (
            <li key={team.id} className={mine ? 'mine' : undefined}>
              <div className="team-row">
                <span className="team-name">{teamName(team, names)}</span>
                <span className="team-score">{team.score}</span>
              </div>
              {tracks && <div className="muted">{tracks}</div>}
              {(showBids || showTricks) && team.players.length > 0 && (
                <ul className="team-players">
                  {team.players.map((seat) => {
                    const player = view.players[seat];
                    if (!player) return null;
                    return (
                      <li key={seat}>
                        <span>{names(seat)}</span>
                        {showBids && (
                          <span>
                            bid {player.bid === null ? '–' : bidLabel(player.bid).toLowerCase()}
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

/** One finished round: what each team bid, took and scored. */
export function RoundTable({
  result,
  teams,
  names,
}: {
  result: RoundResult;
  /** Who is on which team (teams never change during a game). */
  teams: Pick<Team, 'id' | 'players'>[];
  names: SeatNames;
}) {
  const showBids = result.players.some((p) => p.bid !== null);
  const showTricks = result.players.some((p) => p.tricks > 0);
  return (
    <table className="round-table">
      <caption className="visually-hidden">Round {result.round} results</caption>
      <thead>
        <tr>
          <th scope="col">Player</th>
          {showBids && <th scope="col">Bid</th>}
          {showTricks && <th scope="col">Won</th>}
          <th scope="col">Points</th>
          <th scope="col">Total</th>
        </tr>
      </thead>
      {result.teams.map((team) => {
        const members = teams.find((t) => t.id === team.id)?.players ?? [];
        const players = result.players.filter((p) => members.includes(p.id));
        const tracks = tracksText(team.tracks);
        return (
          <tbody key={team.id}>
            {players.map((player, i) => (
              <tr key={player.id}>
                <th scope="row">
                  {names(player.id)}
                  {player.eliminated && <span className="muted"> (out)</span>}
                </th>
                {showBids && (
                  <td>{player.bid === null ? '–' : bidLabel(player.bid).toLowerCase()}</td>
                )}
                {showTricks && <td>{player.tricks}</td>}
                {i === 0 && (
                  <>
                    <td rowSpan={players.length} className="points">
                      {signed(team.points)}
                    </td>
                    <td rowSpan={players.length} className="total">
                      {team.score}
                      {tracks && <div className="muted">{tracks}</div>}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        );
      })}
    </table>
  );
}

/** All rounds so far, with each team's running total. */
export function HistoryTable({
  history,
  teams,
  names,
}: {
  history: RoundResult[];
  teams: Pick<Team, 'id' | 'players'>[];
  names: SeatNames;
}) {
  if (history.length === 0) return <p className="muted">No rounds finished yet.</p>;
  return (
    <table className="history-table">
      <caption className="visually-hidden">Scores after each round</caption>
      <thead>
        <tr>
          <th scope="col">Round</th>
          {teams.map((team) => (
            <th scope="col" key={team.id}>
              {teamName(team, names)}
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
  );
}

/** A modal dialog using the browser's own <dialog>, which traps focus and closes on Esc. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      // The close event arrives after the fact; ignore it if the dialog was opened again
      // meanwhile (React mounts components twice in development).
      onClose={() => {
        if (!ref.current?.open) onClose();
      }}
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
      <form method="dialog" className="dialog-actions">
        <button type="submit" className="primary" autoFocus>
          Continue
        </button>
      </form>
    </dialog>
  );
}

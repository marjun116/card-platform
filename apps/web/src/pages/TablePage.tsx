import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { Shuffling } from '../components/Shuffling';
import { useSession } from '../useSession';
import { GameOver } from '../table/GameOver';
import { Lobby } from '../table/Lobby';
import { TableView } from '../table/TableView';
import { CardMotion } from '../table/motion/animate';
import { usePacedGame } from '../table/motion/pace';
import { useTable } from '../table/useTable';
import { useLoad } from '../useLoad';
import { RequireUser } from './SignIn';

export function TablePage() {
  const { code = '' } = useParams();
  return (
    <RequireUser why="Pick a name to join this table">
      {/* Keyed by the code, so going to another table (a rematch) starts afresh. */}
      <TableLoader key={code.toUpperCase()} code={code.toUpperCase()} />
    </RequireUser>
  );
}

/** Checks the table exists before opening a connection to it. */
function TableLoader({ code }: { code: string }) {
  const found = useLoad(() => api.table(code), code);
  if (found.state === 'loading') return <Shuffling label="Finding the table…" />;
  if (found.state === 'error') {
    return (
      <div className="page narrow">
        <h1>{found.status === 404 ? 'No table with that code' : 'Could not open the table'}</h1>
        <p>
          {found.status === 404
            ? 'Check the invite link or code with whoever sent it.'
            : found.message}
        </p>
        <p>
          <Link to="/">Go home</Link>
        </p>
      </div>
    );
  }
  return <TableScreen code={code} />;
}

function TableScreen({ code }: { code: string }) {
  const { user } = useSession();
  const { connection, snapshot } = useTable(code);
  const { table, status } = snapshot;
  // Other players' moves are shown one at a time, so they don't blur together, and
  // where the cards were is noted just before each change so they can move.
  const [motion] = useState(() => new CardMotion());
  const game = usePacedGame(snapshot.game, motion.capture);
  // A game that ends while you're playing stays on screen, so you can look over the
  // table, until you choose to see the results. One that was already over goes straight
  // to them.
  const [watchedEnd, setWatchedEnd] = useState(false);
  const [resultsShown, setResultsShown] = useState(false);
  if (!watchedEnd && (table?.status === 'playing' || table?.status === 'paused')) {
    setWatchedEnd(true);
  }

  const banner =
    status === 'reconnecting' ? (
      <p className="banner warn" role="status">
        Connection lost. Reconnecting…
      </p>
    ) : null;

  if (snapshot.deleted) {
    return (
      <div className="page narrow">
        <h1>This table was deleted</h1>
        <p>The host deleted it, along with its game.</p>
        <p>
          <Link to="/">Go home</Link>
        </p>
      </div>
    );
  }

  if (!table || !user) {
    return (
      <>
        {banner}
        <Shuffling label="Connecting to the table…" />
      </>
    );
  }

  const mySeat = table.seats.find((s) => s.user?.id === user.id)?.seat ?? null;
  const isHost = table.hostId === user.id;

  let body;
  if (table.status === 'lobby') {
    body = <Lobby table={table} connection={connection} mySeat={mySeat} isHost={isHost} />;
  } else if (mySeat === null) {
    body = (
      <div className="page narrow">
        <h1>{table.game.name}</h1>
        <p>
          {table.status === 'finished' || table.status === 'abandoned'
            ? 'This game is over.'
            : 'This game has already started, and only seated players can watch.'}
        </p>
        <p>
          <Link to="/">Go home</Link>
        </p>
      </div>
    );
  } else if (!game) {
    body = <Shuffling label="Dealing…" />;
  } else if (
    table.status === 'abandoned' ||
    (table.status === 'finished' && (resultsShown || !watchedEnd))
  ) {
    body = (
      <GameOver
        table={table}
        game={game}
        over={snapshot.over}
        celebrate={watchedEnd}
        connection={connection}
      />
    );
  } else {
    body = (
      <TableView
        table={table}
        game={game}
        motion={motion}
        connection={connection}
        error={snapshot.error}
        nudgedBy={snapshot.nudgedBy}
        isHost={isHost}
        onShowResults={() => setResultsShown(true)}
      />
    );
  }

  return (
    <>
      {banner}
      {body}
    </>
  );
}

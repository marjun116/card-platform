/**
 * Something to watch while the table loads: three card backs shuffling, with
 * what's happening written underneath (which is all a screen reader hears). A
 * still stack with "reduce motion" switched on or animation speed off.
 */
import { CardBack } from '../table/Card';

export function Shuffling({ label }: { label: string }) {
  return (
    <div className="page shuffling" role="status">
      <div className="shuffle-deck" aria-hidden="true">
        <CardBack size="small" />
        <CardBack size="small" />
        <CardBack size="small" />
      </div>
      <p className="muted">{label}</p>
    </div>
  );
}

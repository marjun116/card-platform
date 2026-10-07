import type { Mailer } from './auth/mailer';
import type { Config } from './config';
import type { Store } from './store/types';
import type { TurnNotifier } from './tables/notifier';

/** Everything the app talks to outside itself. Tests pass in fakes. */
export interface Deps {
  store: Store;
  mailer: Mailer;
  notifier: TurnNotifier;
  config: Config;
  /** The clock. Tests can move it forward. */
  now: () => Date;
}

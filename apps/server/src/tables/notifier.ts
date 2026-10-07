/**
 * The turn-nudge hook. Today it only logs; email or push delivery can be
 * added later by passing a different TurnNotifier to buildApp.
 */
export interface TurnNudge {
  tableId: string;
  seat: number;
  userId: string;
  /** 'manual': another player pressed nudge. 'idle': the turn has lasted too long. */
  reason: 'manual' | 'idle';
}

export interface TurnNotifier {
  notify(nudge: TurnNudge): Promise<void>;
}

export function loggingNotifier(log: (message: string) => void): TurnNotifier {
  return {
    notify(n) {
      log(`Turn nudge (${n.reason}): table ${n.tableId}, seat ${n.seat}, user ${n.userId}`);
      return Promise.resolve();
    },
  };
}

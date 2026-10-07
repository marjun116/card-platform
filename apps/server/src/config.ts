/** Server settings, read from environment variables (see .env.example). */
export interface Config {
  /** Where the website is served; magic links point here and WebSocket origins must match it. */
  publicUrl: string;
  /** Send cookies over HTTPS only. On in production. */
  secureCookies: boolean;
  /** How long a session lasts without being used. */
  sessionDays: number;
  /** Notify a disconnected player once their turn has lasted this long. */
  idleNudgeAfterMs: number;
  /** How often to look for idle turns. */
  idleCheckEveryMs: number;
  /** Minimum time between manual nudges of the same seat. */
  nudgeCooldownMs: number;
  /** Minimum time between sign-in emails to the same address. */
  emailCooldownMs: number;
}

const HOUR = 60 * 60 * 1000;

export const defaultConfig: Config = {
  publicUrl: 'http://localhost:5173',
  secureCookies: false,
  sessionDays: 90,
  idleNudgeAfterMs: 12 * HOUR,
  idleCheckEveryMs: 10 * 60 * 1000,
  nudgeCooldownMs: 5 * 60 * 1000,
  emailCooldownMs: 60 * 1000,
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const hours = Number(env.IDLE_NUDGE_HOURS);
  return {
    ...defaultConfig,
    publicUrl: env.PUBLIC_URL ?? defaultConfig.publicUrl,
    secureCookies: env.NODE_ENV === 'production',
    ...(hours > 0 && { idleNudgeAfterMs: hours * HOUR }),
  };
}

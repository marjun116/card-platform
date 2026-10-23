import { describe, expect, it } from 'vitest';
import { configFromEnv } from './config';

describe('configFromEnv', () => {
  it('accepts pages on this computer, except in production', () => {
    expect(configFromEnv({}).localOrigins).toBe(true);
    expect(configFromEnv({ NODE_ENV: 'development' }).localOrigins).toBe(true);
    expect(configFromEnv({ NODE_ENV: 'production' }).localOrigins).toBe(false);
  });
});

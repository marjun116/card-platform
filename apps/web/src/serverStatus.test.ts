import { describe, expect, it } from 'vitest';
import { describeServerStatus } from './serverStatus';

describe('describeServerStatus', () => {
  it('describes each status', () => {
    expect(describeServerStatus('ok')).toBe('Server is running');
    expect(describeServerStatus('unreachable')).toBe('Server is not reachable');
  });
});

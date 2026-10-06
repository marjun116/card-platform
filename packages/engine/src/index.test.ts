import { describe, expect, it } from 'vitest';
import { SUITS } from './index';

describe('engine placeholder', () => {
  it('knows the four standard suits', () => {
    expect(SUITS).toHaveLength(4);
  });
});

import { describe } from 'vitest';
import { storeContract } from './contract';
import { MemoryStore } from './memory';

describe('MemoryStore', () => {
  storeContract(() => Promise.resolve(new MemoryStore()));
});

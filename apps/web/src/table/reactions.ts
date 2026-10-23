/** How each quick reaction looks, and what screen readers say for it. */
import type { Reaction } from '@card-table/server/protocol';

export const REACTION_LOOK: Record<Reaction, { shown: string; said: string }> = {
  thumbsUp: { shown: '👍', said: 'Thumbs up' },
  wow: { shown: '😮', said: 'Wow' },
  laugh: { shown: '😂', said: 'Laughing' },
  goodGame: { shown: 'GG', said: 'Good game' },
};

/** The reactions, in the order they're offered. */
export const REACTION_CHOICES = Object.keys(REACTION_LOOK) as Reaction[];

/** The least time between your reactions, as the server has it (see room.ts), in ms. */
export const REACTION_COOLDOWN = 3000;

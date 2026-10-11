/**
 * Saved variants: a game's house rules and player count, saved under a name
 * like "Grandma's Spades" and shared by link. Like tables, a variant is
 * identified by its code, and having the code is what lets you see it.
 *
 *   POST   /api/variants          save one
 *   GET    /api/variants/mine     my variants, newest first
 *   GET    /api/variants/:code    one variant (anyone with the code)
 *   DELETE /api/variants/:code    delete one of mine
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { newInviteCode } from '../auth/tokens';
import type { Deps } from '../deps';
import type { GameCatalog } from '../games/catalog';
import { checkSettings, fitSettings } from '../games/settings';
import type { VariantInfo } from '../tables/protocol';
import { ConflictError, type NewVariant, type Variant } from '../store/types';

/** Most variants one person can keep. */
export const MAX_VARIANTS = 50;

const saveBody = z.strictObject({
  game: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(60),
  options: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  playerCount: z.number().int().min(1).max(10).optional(),
});
const codeParams = z.object({ code: z.string().min(1).max(32) });

export function variantRoutes(app: FastifyInstance, deps: Deps, catalog: GameCatalog): void {
  const { store } = deps;

  app.post('/api/variants', async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: 'Sign in or play as a guest first' });
    const body = saveBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Give the variant a name' });

    const settings = checkSettings(
      catalog,
      body.data.game,
      body.data.options,
      body.data.playerCount,
    );
    if ('error' in settings) return reply.code(settings.status).send({ error: settings.error });
    if ((await store.listVariants(user.id)).length >= MAX_VARIANTS) {
      return reply
        .code(400)
        .send({ error: `You can keep up to ${MAX_VARIANTS} variants. Delete one first.` });
    }

    const variant = await createWithFreshCode({
      ownerId: user.id,
      definitionId: settings.game.definitionId,
      name: body.data.name,
      options: settings.options,
      playerCount: settings.playerCount,
    });
    return reply.code(201).send({ variant: infoFor(variant) });
  });

  app.get('/api/variants/mine', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const variants = await store.listVariants(request.user.id);
    return { variants: variants.map(infoFor) };
  });

  app.get('/api/variants/:code', async (request, reply) => {
    const variant = await variantFromParams(request);
    if (!variant) return reply.code(404).send({ error: 'No variant with that code' });
    return { variant: infoFor(variant) };
  });

  app.delete('/api/variants/:code', async (request, reply) => {
    if (!request.user) return reply.code(401).send({ error: 'Not signed in' });
    const variant = await variantFromParams(request);
    if (!variant) return reply.code(404).send({ error: 'No variant with that code' });
    if (variant.ownerId !== request.user.id) {
      return reply.code(403).send({ error: 'Only the person who saved a variant can delete it' });
    }
    await store.deleteVariant(variant.id);
    return { ok: true };
  });

  async function createWithFreshCode(data: Omit<NewVariant, 'code'>): Promise<Variant> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await store.createVariant({ ...data, code: newInviteCode() });
      } catch (error) {
        if (!(error instanceof ConflictError) || attempt >= 4) throw error;
      }
    }
  }

  async function variantFromParams(request: FastifyRequest): Promise<Variant | null> {
    const params = codeParams.safeParse(request.params);
    return params.success ? store.getVariantByCode(params.data.code.toUpperCase()) : null;
  }

  /** The variant fitted to its game's current file. */
  function infoFor(variant: Variant): VariantInfo {
    const game = catalog.builtIn(variant.slug);
    const fitted = game
      ? fitSettings(game.file, variant.options, variant.playerCount)
      : { options: variant.options, playerCount: variant.playerCount };
    return {
      code: variant.code,
      name: variant.name,
      game: { slug: variant.slug, name: game?.name ?? variant.slug },
      ...fitted,
      owner: { id: variant.ownerId, displayName: variant.ownerName },
    };
  }
}

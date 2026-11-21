import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import {
  providerKeyBodySchema,
  providerKeyDeleteQuerySchema,
} from '@contexta/shared';
import type { Db } from '../../db/client.js';
import { providerKeys } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/errors.js';
import { parseOrThrow } from '../../lib/validate.js';
import { getRequestUser } from '../../middleware/auth.js';
import {
  encryptProviderKey,
  keyAad,
} from '../../services/keys.js';
import type { ProviderValidator } from '../../services/providerValidation.js';

export interface SettingsRouterDependencies {
  db: Db;
  masterKey: Buffer;
  providerValidator: ProviderValidator;
}

export function createSettingsRouter({
  db,
  masterKey,
  providerValidator,
}: SettingsRouterDependencies): Router {
  const router = Router();

  // PUT /settings/provider-key — validate before persisting, then encrypt.
  router.put(
    '/provider-key',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const body = parseOrThrow(providerKeyBodySchema, req.body ?? {});

      await providerValidator.validate(body.provider, body.apiKey);

      const encrypted = encryptProviderKey(
        body.apiKey,
        masterKey,
        keyAad(user.id, body.provider),
      );

      await db
        .insert(providerKeys)
        .values({
          userId: user.id,
          provider: body.provider,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [providerKeys.userId, providerKeys.provider],
          set: {
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            authTag: encrypted.authTag,
            updatedAt: new Date(),
          },
        });

      res.status(204).send();
    }),
  );

  // GET /settings/provider-key — metadata only, never key material.
  router.get(
    '/provider-key',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const rows = await db
        .select({
          provider: providerKeys.provider,
          createdAt: providerKeys.createdAt,
        })
        .from(providerKeys)
        .where(eq(providerKeys.userId, user.id))
        .orderBy(providerKeys.createdAt);
      res.json({
        providers: rows.map((row) => ({
          provider: row.provider,
          createdAt: row.createdAt.toISOString(),
        })),
      });
    }),
  );

  // DELETE /settings/provider-key?provider=openai (omit to remove all)
  router.delete(
    '/provider-key',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const query = parseOrThrow(providerKeyDeleteQuerySchema, req.query ?? {});

      const where = query.provider
        ? and(
            eq(providerKeys.userId, user.id),
            eq(providerKeys.provider, query.provider),
          )
        : eq(providerKeys.userId, user.id);

      await db.delete(providerKeys).where(where);
      res.status(204).send();
    }),
  );

  // Guard against accidental plaintext exposure if a future field is added.
  router.use((_req, _res, next) => {
    next(AppError.notFound());
  });

  return router;
}

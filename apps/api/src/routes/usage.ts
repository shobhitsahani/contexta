import { Router } from 'express';
import type { Db } from '../db/client.js';
import { asyncHandler } from '../lib/errors.js';
import { getRequestUser } from '../middleware/auth.js';
import { UsageService } from '../services/usage.js';

export interface UsageRouterDependencies {
  db: Db;
  freeTokensCap: number;
}

export function createUsageRouter({
  db,
  freeTokensCap,
}: UsageRouterDependencies): Router {
  const router = Router();
  const usageService = new UsageService(db, { freeTokensCap });

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const user = getRequestUser(req);
      const snapshot = await usageService.getUsage(
        user.id,
        user.emailVerified,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(snapshot);
    }),
  );

  return router;
}

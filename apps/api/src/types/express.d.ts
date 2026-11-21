import type { AuthUser } from '../middleware/auth.js';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      authSession?: {
        id: string;
        userId: string;
        expiresAt: Date | string;
      };
      /** Compatibility alias used by the messages stream. */
      userId?: string;
    }
  }
}

export {};

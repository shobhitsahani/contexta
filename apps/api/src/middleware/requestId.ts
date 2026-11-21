import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Adds a server-generated request id and never trusts a client-supplied one. */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  };
}

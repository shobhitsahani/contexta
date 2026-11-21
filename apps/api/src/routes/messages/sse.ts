/**
 * SSE helpers for streaming responses.
 *
 * Event contract: delta, sources, usage, done, error.
 */

import type { Response } from 'express';
import type { Citation } from '@contexta/shared';

export function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable proxy buffering (Nginx, Render)
  });
  res.flushHeaders();
}

export function sendDelta(res: Response, text: string): void {
  res.write(`: data: ${JSON.stringify(text)}\nevent: delta\ndata: ${JSON.stringify({ type: 'delta', delta: text, text })}\n\n`);
}

export function sendSources(res: Response, sources: Citation[]): void {
  res.write(`event: sources\ndata: ${JSON.stringify({ type: 'sources', sources })}\n\n`);
}

export function sendUsage(res: Response, tokensIn: number, tokensOut: number): void {
  res.write(`event: usage\ndata: ${JSON.stringify({ type: 'usage', tokensIn, tokensOut })}\n\n`);
}

export function sendDone(res: Response): void {
  res.write(`event: done\ndata: ${JSON.stringify({ type: 'done' })}\n\n`);
}

export function sendError(res: Response, code: string, message: string): void {
  res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', code, message })}\n\n`);
}

export function sendKeepAlive(res: Response): void {
  res.write(': keep-alive\n\n');
}

import type { Request, Response } from 'express';
import { gzip } from 'node:zlib';
import { logger } from './logger';

/**
 * Sends `payload` as JSON, gzipped by hand: there is no compression middleware
 * in this app, and a 10k-card collection is megabytes of JSON that phones fetch
 * on every visit (~4x smaller on the wire). Falls back to plain JSON when the
 * client doesn't advertise gzip or compression fails. `Vary: Accept-Encoding`
 * keeps a shared cache from handing the gzipped body to a client that can't
 * read it.
 */
export function sendGzippedJson(req: Request, res: Response, payload: unknown, tag: string): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  res.vary('Accept-Encoding');
  if (!req.acceptsEncodings('gzip')) {
    res.type('application/json').send(body);
    return;
  }
  gzip(body, (err, gzipped) => {
    if (err) {
      logger.warn(`[${tag}] gzip failed, sending uncompressed:`, err);
      res.type('application/json').send(body);
      return;
    }
    res
      .set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' })
      .send(gzipped);
  });
}

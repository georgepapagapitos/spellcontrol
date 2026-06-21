// POST /api/scanner/match — server-side card recognition.
//
// Body: multipart/form-data with field "image" — a card image (preferably the
// perspective-warped 488×680 crop produced by the on-device opencv pipeline,
// but any cropped card photo works; sharp normalizes the input).
//
// Response (200):
//   { kind: 'confident', match: ScanCandidate, timings: ScanTimings }
//   { kind: 'borderline', candidates: ScanCandidate[], timings: ScanTimings }
//   { kind: 'miss', reason: string, detail?: string, timings: ScanTimings }
//
// 413 when the upload exceeds MAX_IMAGE_BYTES; 415 if the body shape is wrong;
// 503 if the matcher's data files aren't present on the server yet.
//
// No authentication required — this is a stateless identification service.
// Guests and signed-out users hit the same endpoint. A per-IP rate limit
// keeps abusive scripting in check without blocking real scanning sessions
// (200 scans/min is well above what a human can scan).

import * as path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { testAwareLimiter } from '../route-utils';
import multer from 'multer';
import { logger } from '../logger';
import { errorMessage } from '../error-utils';
import { getMatcher } from '../scanner/matcher';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const DEFAULT_DATA_DIR = path.resolve(__dirname, '..', '..', 'data', 'scanner');

function getScannerDataDir(): string {
  return process.env.SCANNER_DATA_DIR
    ? path.resolve(process.env.SCANNER_DATA_DIR)
    : DEFAULT_DATA_DIR;
}

const matchLimiter = testAwareLimiter({ windowMs: 60_000, max: 200 });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
});

export const scannerRouter: Router = Router();

scannerRouter.post(
  '/match',
  matchLimiter,
  upload.single('image'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res
        .status(415)
        .json({ error: 'Provide a multipart/form-data request with field "image".' });
    }

    const matcher = await getMatcher(getScannerDataDir());
    if (!matcher) {
      return res
        .status(503)
        .json({ error: 'Scanner data not provisioned on this server.', kind: 'unavailable' });
    }

    try {
      const result = await matcher.match(req.file.buffer);
      res.json(result);
    } catch (err) {
      logger.error('[scanner/match] error:', err);
      const message = errorMessage(err);
      res.status(500).json({ error: `Match failed: ${message}` });
    }
  }
);

scannerRouter.get('/stats', async (_req: Request, res: Response) => {
  const matcher = await getMatcher(getScannerDataDir());
  if (!matcher) {
    return res.status(503).json({ error: 'Scanner data not provisioned.' });
  }
  res.json(matcher.stats());
});

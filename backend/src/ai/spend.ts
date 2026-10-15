import { getPool } from '../db';
import { estimateUsd } from './client';

/** Default for AI_DAILY_USD_CAP. */
export const DEFAULT_DAILY_USD_CAP = 5;

/**
 * Global backstop on Anthropic spend, across every account, per UTC day.
 * The per-user limit bounds one account; this bounds all of them together, so
 * a flood of new accounts (or AI_PUBLIC=1 going viral) can't run up the bill.
 * Estimated from the stored token counts at list price (estimateUsd), which
 * is what the admin spend readout shows too. `AI_DAILY_USD_CAP` overrides it.
 */
export function aiDailyUsdCap(): number {
  const raw = process.env.AI_DAILY_USD_CAP;
  const n = raw ? Number(raw) : NaN;
  // 0 is a valid setting: it pauses fresh generations (cached replays still serve).
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_USD_CAP;
}

/** Today's (UTC) estimated spend across every account and feature. */
export async function spentTodayUsd(): Promise<number> {
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  // Grouped by model: review and refine run on different tiers, priced apart.
  const res = await getPool().query<{
    model: string;
    input_tokens: string;
    output_tokens: string;
    cache_write_tokens: string;
    cache_read_tokens: string;
  }>(
    `SELECT model,
            SUM(input_tokens)::text AS input_tokens,
            SUM(output_tokens)::text AS output_tokens,
            SUM(cache_write_tokens)::text AS cache_write_tokens,
            SUM(cache_read_tokens)::text AS cache_read_tokens
       FROM ai_reviews WHERE created_at >= $1 GROUP BY model`,
    [dayStartMs]
  );
  return res.rows.reduce(
    (usd, r) =>
      usd +
      estimateUsd(
        {
          inputTokens: Number(r.input_tokens),
          outputTokens: Number(r.output_tokens),
          cacheWriteTokens: Number(r.cache_write_tokens),
          cacheReadTokens: Number(r.cache_read_tokens),
        },
        r.model
      ),
    0
  );
}

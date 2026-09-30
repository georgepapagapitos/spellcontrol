import { randomInt } from 'node:crypto';
import { getPool } from '../db';
import { getAnswerPool, type PoolCard } from './data';

/** Puzzle #1. */
export const EPOCH = '2026-09-30';
export const REPEAT_GAP_DAYS = 365;
const DAY_MS = 86_400_000;

export interface Puzzle {
  date: string;
  number: number;
  name: string;
  payload: PoolCard;
}

export function todayUtc(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function puzzleNumber(date: string): number {
  const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / DAY_MS;
  return Math.round(days) + 1;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

interface Row {
  puzzle_date: string;
  number: number;
  name: string;
  payload: PoolCard;
}

const toPuzzle = (r: Row): Puzzle => ({
  date: r.puzzle_date,
  number: r.number,
  name: r.name,
  payload: r.payload,
});

/**
 * The day's answer. Picked on first request, stored whole (so a later pool
 * refresh can't change a live day) and stable afterwards; the conflict clause
 * makes concurrent first requests agree on one row.
 */
export async function getPuzzle(date: string): Promise<Puzzle> {
  const db = getPool();
  const sel = `SELECT puzzle_date, number, name, payload FROM daily_puzzles WHERE puzzle_date = $1`;
  const existing = await db.query<Row>(sel, [date]);
  if (existing.rows[0]) return toPuzzle(existing.rows[0]);

  const pool = getAnswerPool();
  if (pool.length === 0) throw new Error('Daily answer pool is empty');
  const recent = await db.query<{ name: string }>(
    `SELECT name FROM daily_puzzles WHERE puzzle_date >= $1 AND puzzle_date < $2`,
    [addDays(date, -REPEAT_GAP_DAYS), date]
  );
  const used = new Set(recent.rows.map((r) => r.name));
  const fresh = pool.filter((c) => !used.has(c.name));
  const from = fresh.length > 0 ? fresh : pool;
  const pick = from[randomInt(from.length)]!;
  await db.query(
    `INSERT INTO daily_puzzles (puzzle_date, number, name, payload, created_at)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (puzzle_date) DO NOTHING`,
    [date, puzzleNumber(date), pick.name, JSON.stringify(pick), Date.now()]
  );
  const row = (await db.query<Row>(sel, [date])).rows[0]!;
  return toPuzzle(row);
}

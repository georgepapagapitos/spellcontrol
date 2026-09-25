import type { StateStorage } from 'zustand/middleware';
import { logger } from './logger';

/**
 * `localStorage` for zustand's `persist`, minus the throw. A full or blocked
 * storage makes `setItem` throw (`QuotaExceededError`, or a SecurityError in
 * a locked-down browser), and `persist` writes synchronously inside `set` —
 * so the throw lands in the middle of whatever store action the player just
 * took, and every line after that `set` never runs. The paper Horde table hit
 * exactly this: a long game's persisted state passed the quota, and "Done" on
 * the damage sheet cleared the result but never closed the sheet, leaving it
 * stuck over the table for good.
 *
 * A failed save is logged and dropped; the in-memory state stays correct and
 * the next write that fits goes through. Every `persist` store that keeps its
 * state in `localStorage` uses this rather than the raw object
 * (`safe-local-storage.test.ts` enforces it).
 */
export const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch (err) {
      logger.warn(`[storage] couldn't save "${name}" (${value.length} chars)`, err);
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* best effort */
    }
  },
};

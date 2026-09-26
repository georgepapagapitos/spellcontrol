import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from './safe-local-storage';
import type { Condition, Finish } from '../types';

/**
 * Scanner preferences, set from the camera's settings sheet. Device-local like
 * the scan queue itself: they describe how this phone scans, not collection
 * data, so they stay off the sync path.
 *
 * The two defaults are what save taps when opening a box: set Foil once and
 * every scan lands foil (clamped to the printings that have one), set LP once
 * for a stack of played cards.
 */
interface ScannerSettings {
  /** Finish a new scan lands as. Etched is never a default: it's rare enough
   *  to pick per card, and most printings don't offer it. */
  defaultFinish: Extract<Finish, 'nonfoil' | 'foil'>;
  defaultCondition: Condition;
  /** The value-tiered chime on each accepted scan. Haptics stay on regardless. */
  sound: boolean;
  /** The running total in the camera's top bar. The card count always shows. */
  showTotal: boolean;
  set: (patch: Partial<Omit<ScannerSettings, 'set'>>) => void;
}

export const useScannerSettings = create<ScannerSettings>()(
  persist(
    (set) => ({
      defaultFinish: 'nonfoil',
      defaultCondition: 'nm',
      sound: true,
      showTotal: true,
      set: (patch) => set(patch),
    }),
    {
      name: 'spellcontrol-scanner-settings',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);

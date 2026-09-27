import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from './safe-local-storage';
import type { Condition, Finish } from '../types';

/**
 * "Add settings": the defaults every new copy lands with, whether it arrives
 * through the scanner's gear or the Add cards sheet's gear (T153) — one store
 * so setting Foil/LP once covers both. Device-local like the scan queue
 * itself: they describe how this device adds cards, not collection data, so
 * they stay off the sync path.
 *
 * The name and persisted key stay "scanner" from when this only covered the
 * camera; renaming the key would drop existing users' saved defaults on
 * upgrade for no benefit, since it's an internal storage key nobody reads.
 *
 * The three defaults are what save taps when opening a box: set Foil once and
 * every new copy lands foil (clamped to what the printing has), set LP once
 * for a stack of played cards, set a language once for a foreign-language lot.
 */
interface ScannerSettings {
  /** Finish a new copy lands as. Etched is never a default: it's rare enough
   *  to pick per card, and most printings don't offer it. */
  defaultFinish: Extract<Finish, 'nonfoil' | 'foil'>;
  defaultCondition: Condition;
  /** '' means English, the unmarked default (§ Copy details). */
  defaultLanguage: string;
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
      defaultLanguage: '',
      sound: true,
      showTotal: true,
      set: (patch) => set(patch),
    }),
    {
      // Same key as before defaultLanguage existed — zustand's default merge
      // spreads the fresh initial state under whatever was persisted, so an
      // old record missing the field just keeps the '' default above.
      name: 'spellcontrol-scanner-settings',
      storage: createJSONStorage(() => safeLocalStorage),
    }
  )
);

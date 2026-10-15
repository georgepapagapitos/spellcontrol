import { useMemo, useState } from 'react';
import type { BinderFilter } from '../../types';
import {
  compileFilter,
  manaSymbolQueryIsActive,
  normalizeManaValues,
} from '@spellcontrol/binder-routing';

/**
 * The add-cards panel's mana value (chips + Custom comparator) and printed
 * cost symbol filters. Applied client-side over the owned rows by the
 * Collection tab: it is the only tab the Filters dialog narrows, so no
 * Scryfall query translation is involved.
 */
export function useManaFilters() {
  const [cmcMin, setCmcMin] = useState<number | undefined>(undefined);
  const [cmcMax, setCmcMax] = useState<number | undefined>(undefined);
  const [manaValues, setManaValues] = useState<BinderFilter['manaValues']>(undefined);
  const [manaSymbols, setManaSymbols] = useState<BinderFilter['manaSymbols']>(undefined);
  const compiled = useMemo(
    () => compileFilter({ cmcMin, cmcMax, manaValues, manaSymbols }),
    [cmcMin, cmcMax, manaValues, manaSymbols]
  );
  const activeCount =
    (cmcMin !== undefined || cmcMax !== undefined ? 1 : 0) +
    (normalizeManaValues(manaValues) ? 1 : 0) +
    (manaSymbolQueryIsActive(manaSymbols) ? 1 : 0);
  return {
    compiled,
    activeCount,
    dialogProps: {
      cmcMin,
      setCmcMin,
      cmcMax,
      setCmcMax,
      manaValues,
      setManaValues,
      manaSymbols,
      setManaSymbols,
    },
  };
}

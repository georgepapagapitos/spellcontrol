import { createContext, useContext } from 'react';
import type { FilterFieldId } from '../lib/filter-fields';

export interface RuleFieldVisibility {
  /** Whether this field's row should render at all. */
  isVisible: (id: FilterFieldId) => boolean;
  /** Clear the field's value and take its row away. */
  clearField: (id: FilterFieldId) => void;
}

/**
 * Present only inside the binder / dynamic-list rule editor, where a field's
 * row renders because the field HAS a value (or was just added) rather than
 * unconditionally.
 *
 * Null everywhere else — notably in the collection Filters dialog, which shares
 * `FilterFieldEditor` but is a flat always-visible form and should stay one.
 * A null context means "render every row", which is exactly the old behaviour,
 * so nothing outside the rule editor changes.
 */
export const RuleFieldContext = createContext<RuleFieldVisibility | null>(null);

export const useRuleFieldVisibility = () => useContext(RuleFieldContext);

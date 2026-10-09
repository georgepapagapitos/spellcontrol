import type { ReactNode } from 'react';

export interface SelectOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Visible only inside the popover; falls back to `label` when omitted. */
  itemLabel?: ReactNode;
  /** Hidden text used when the trigger renders this option's label. */
  triggerLabel?: ReactNode;
}

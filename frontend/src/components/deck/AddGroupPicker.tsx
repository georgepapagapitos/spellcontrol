import { Layers } from 'lucide-react';
import { useState } from 'react';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import type { SelectOption } from '@/lib/util/select-option';

// Groups are the deck's own tags (plus suggested groups), so which one the user
// last filed into is a per-deck, per-viewer habit: keyed by deck id, kept in
// this browser only. Another deck may not have a group of that name, so it
// can't be per user.
const key = (deckId: string) => `sc.addGroup.${deckId}`;
// Before the vocabulary settled on "group" this was `sc.addStack.<deckId>`.
const legacyKey = (deckId: string) => `sc.addStack.${deckId}`;
const NONE = '';

function readStored(deckId: string): string {
  try {
    const current = localStorage.getItem(key(deckId));
    if (current !== null) return current;
    // One-time migration of the old key, so nobody's last pick resets.
    const legacy = localStorage.getItem(legacyKey(deckId));
    if (legacy === null) return NONE;
    localStorage.setItem(key(deckId), legacy);
    localStorage.removeItem(legacyKey(deckId));
    return legacy;
  } catch {
    return NONE;
  }
}

function writeStored(deckId: string, group: string): void {
  try {
    if (group === NONE) localStorage.removeItem(key(deckId));
    else localStorage.setItem(key(deckId), group);
  } catch {
    // Private mode or a full quota: the choice just doesn't outlive the panel.
  }
}

/**
 * The group the Add cards panel files new slots into, defaulting to the one
 * used last on this deck. A remembered group the deck no longer has reads as
 * "No group" without erasing the memory, so it comes back if the tag does.
 * Returns `null` when nothing is chosen.
 */
export function useAddGroup(deckId: string, groups: string[]) {
  const [stored, setStored] = useState(() => readStored(deckId));
  const match = groups.find((s) => s.toLowerCase() === stored.toLowerCase());
  const group = match ?? null;
  const choose = (next: string) => {
    setStored(next);
    writeStored(deckId, next);
  };
  return { group, choose };
}

export function AddGroupPicker({
  groups,
  value,
  onChange,
}: {
  groups: string[];
  value: string | null;
  onChange: (group: string) => void;
}) {
  const options: SelectOption<string>[] = [
    { value: NONE, label: 'No group' },
    ...groups.map((s) => ({ value: s, label: s })),
  ];
  return (
    <div className="card-search-group">
      <SelectMenu<string>
        ariaLabel="Add to group"
        leadingIcon={<Layers width={14} height={14} strokeWidth={1.8} aria-hidden />}
        value={value ?? NONE}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}

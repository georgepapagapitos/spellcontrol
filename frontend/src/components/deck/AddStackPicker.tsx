import { Layers } from 'lucide-react';
import { useState } from 'react';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import type { SelectOption } from '@/lib/util/select-option';

// Stacks are the deck's own tags, so which one the user last filed into is a
// per-deck, per-viewer habit: keyed by deck id, kept in this browser only.
// Another deck may not have a stack of that name, so it can't be per user.
const key = (deckId: string) => `sc.addStack.${deckId}`;
const NONE = '';

function readStored(deckId: string): string {
  try {
    return localStorage.getItem(key(deckId)) ?? NONE;
  } catch {
    return NONE;
  }
}

function writeStored(deckId: string, stack: string): void {
  try {
    if (stack === NONE) localStorage.removeItem(key(deckId));
    else localStorage.setItem(key(deckId), stack);
  } catch {
    // Private mode or a full quota: the choice just doesn't outlive the panel.
  }
}

/**
 * The stack the Add cards panel files new slots into, defaulting to the one
 * used last on this deck. A remembered stack the deck no longer has reads as
 * "No stack" without erasing the memory, so it comes back if the tag does.
 * Returns `null` when nothing is chosen.
 */
export function useAddStack(deckId: string, stacks: string[]) {
  const [stored, setStored] = useState(() => readStored(deckId));
  const match = stacks.find((s) => s.toLowerCase() === stored.toLowerCase());
  const stack = match ?? null;
  const choose = (next: string) => {
    setStored(next);
    writeStored(deckId, next);
  };
  return { stack, choose };
}

export function AddStackPicker({
  stacks,
  value,
  onChange,
}: {
  stacks: string[];
  value: string | null;
  onChange: (stack: string) => void;
}) {
  const options: SelectOption<string>[] = [
    { value: NONE, label: 'No stack' },
    ...stacks.map((s) => ({ value: s, label: s })),
  ];
  return (
    <div className="card-search-stack">
      <SelectMenu<string>
        ariaLabel="Add to stack"
        leadingIcon={<Layers width={14} height={14} strokeWidth={1.8} aria-hidden />}
        value={value ?? NONE}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}

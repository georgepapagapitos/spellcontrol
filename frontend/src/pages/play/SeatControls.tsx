import { X } from 'lucide-react';
import { IconButton } from '@/components/shared/Button';
import { useState } from 'react';
import { type Deck } from '@/store/decks';
import { type Friend } from '@/lib/social/friends-client';
import { formatIdentity } from '@/lib/social/display-name';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { DeckPicker } from '@/components/play/SetupControls';
import type { PickedDeck } from '@/components/play/DeckPickerDialog';

export function SeatDeck({
  decks,
  value,
  deckName,
  onChange,
}: {
  decks: Deck[];
  value: string | null;
  deckName: string | null;
  onChange: (picked: PickedDeck | null) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!open && !value) {
    return (
      <button
        type="button"
        className="play-setup-seat-deck-add"
        onClick={() => setOpen(true)}
        aria-label="Add deck"
      >
        + Deck
      </button>
    );
  }
  return (
    <div className="play-setup-seat-deck">
      <DeckPicker decks={decks} value={value} valueName={deckName} onChange={onChange} />
      {value && deckName && (
        <IconButton
          className="play-setup-seat-deck-clear"
          label="Clear deck"
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
          icon={<X width={14} height={14} strokeWidth={1.8} />}
        />
      )}
    </div>
  );
}

/** Someone who can hold a seat: the signed-in user or one of their friends. */
export interface SeatPerson {
  id: string;
  username: string;
  displayName: string | null;
}

export const SEAT_GUEST = '__guest__';

/**
 * Who sits here: a guest (a name, no account — most seats at most tables),
 * you, or a friend. Picking an account fills the name with how they present
 * themselves and credits their record when the game ends; the name stays
 * editable because a table has its own nicknames. An account already in
 * another seat isn't offered twice.
 */
export function SeatWho({
  seatIndex,
  value,
  me,
  friends,
  taken,
  onChange,
}: {
  seatIndex: number;
  value: string | null;
  me: SeatPerson;
  friends: Friend[];
  taken: Set<string>;
  onChange: (person: SeatPerson | null) => void;
}) {
  const people: SeatPerson[] = [me, ...friends];
  const options = [
    { value: SEAT_GUEST, label: 'Guest' },
    ...people
      .filter((p) => p.id === value || !taken.has(p.id))
      .map((p) => ({
        value: p.id,
        label: p.id === me.id ? 'You' : formatIdentity(p).primary,
      })),
  ];
  return (
    <SelectMenu<string>
      ariaLabel={`Who is in seat ${seatIndex + 1}`}
      className="play-setup-seat-who"
      value={value ?? SEAT_GUEST}
      options={options}
      onChange={(next) =>
        onChange(next === SEAT_GUEST ? null : (people.find((p) => p.id === next) ?? null))
      }
    />
  );
}

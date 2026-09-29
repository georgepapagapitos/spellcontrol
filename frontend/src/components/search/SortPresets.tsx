import { Check, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { SORT_PRESETS, matchSortPreset, type SortPreset } from '@/lib/search/sorting';
import { ColorPip } from '@/components/shared/ManaSymbol';
import { ChoiceList } from '@/components/shared/form';
import { Chip } from '@/components/shared/Chip';
import type { SortEntry } from '@/types/index';

/** The named order a stored chain matches, or "Choose fields" — the id this
 *  UI uses for "no preset, edit the chain directly" everywhere it appears.
 *  Never "Custom order": that name already means the hand-dragged manual
 *  order (Manage cards › Order, #2446). */
const FIELDS_ID = 'fields';

function byColorHint(): ReactNode {
  return (
    <span className="sort-preset-color-hint">
      {(['W', 'U', 'B', 'R', 'G'] as const).map((c) => (
        <ColorPip key={c} color={c} />
      ))}
      <span>then multicolor and colorless; A to Z inside</span>
    </span>
  );
}

/**
 * A named order (E491): six presets — a saved sort chain plus a name and a
 * description — sitting IN FRONT of the chain editor, plus a "Choose fields"
 * row that drills into it. This is the radio-row form: one name, one
 * description, used in the sort sheet on a phone and above the chain editor
 * in the desktop popover. `BinderEditor`'s Order disclosure uses the compact
 * chip form below instead (`SortPresetChips`) — that surface is already an
 * open disclosure with the full chain visible underneath, so a description
 * per row would repeat what's already on screen.
 */
export function SortPresetList({
  sorts,
  onPick,
  onChooseFields,
}: {
  sorts: SortEntry[];
  onPick: (preset: SortPreset) => void;
  onChooseFields: () => void;
}) {
  const active = matchSortPreset(sorts);
  return (
    // "Choose fields" is a NAVIGATION, not a value the chain can already be
    // "at" in a way a click can re-fire — a radio's `change` event only fires
    // when its value actually flips, so clicking it while it's already the
    // selected option (the common case: no preset matches, so it's checked by
    // default) produced no event at all and the row silently did nothing.
    // `onClickCapture` fires on every click regardless.
    <div
      onClickCapture={(e) => {
        const target = e.target as HTMLElement;
        if (target instanceof HTMLInputElement && target.value === FIELDS_ID) onChooseFields();
      }}
    >
      <ChoiceList
        ariaLabel="Order"
        value={active?.id ?? FIELDS_ID}
        onChange={(id) => {
          if (id === FIELDS_ID) return; // handled by onClickCapture above
          const preset = SORT_PRESETS.find((p) => p.id === id);
          if (preset) onPick(preset);
        }}
        options={[
          ...SORT_PRESETS.map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.id === 'by-color' ? byColorHint() : p.description,
          })),
          {
            value: FIELDS_ID,
            label: (
              <span className="sort-preset-fields-row">
                Choose fields
                <ChevronRight width={14} height={14} strokeWidth={1.8} aria-hidden />
              </span>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The compact chip form of the same named orders, for `BinderEditor`'s Order
 * disclosure — already open, with the full chain editor visible right below,
 * so a one-line pill per preset is enough; the description lives in the
 * disclosure's own summary line instead of repeating per chip.
 */
export function SortPresetChips({
  sorts,
  onPick,
  onChooseFields,
}: {
  sorts: SortEntry[];
  onPick: (preset: SortPreset) => void;
  onChooseFields: () => void;
}) {
  const active = matchSortPreset(sorts);
  const isFields = !active;
  return (
    <div className="sort-preset-chips" role="group" aria-label="Order">
      {SORT_PRESETS.map((p) => {
        const selected = active?.id === p.id;
        return (
          <Chip
            key={p.id}
            className={`sort-preset-chip${selected ? ' is-selected' : ''}`}
            pressed={selected}
            title={p.description}
            icon={selected ? <Check width={12} height={12} strokeWidth={2} /> : undefined}
            onClick={() => onPick(p)}
          >
            {p.name}
          </Chip>
        );
      })}
      <Chip
        className={`sort-preset-chip${isFields ? ' is-selected' : ''}`}
        pressed={isFields}
        icon={isFields ? <Check width={12} height={12} strokeWidth={2} /> : undefined}
        onClick={onChooseFields}
      >
        Choose fields
      </Chip>
    </div>
  );
}

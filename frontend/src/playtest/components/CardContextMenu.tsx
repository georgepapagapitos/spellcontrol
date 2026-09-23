import { useState } from 'react';
import { usePressRepeat } from '@/lib/use-press-repeat';
import type { Zone } from '@/lib/playtest';
import type { ShortcutId } from '../lib/shortcuts';
import { moveToEntries } from './move-to-entries';
import { SEPARATOR, TableContextMenu, type MenuEntry } from './TableContextMenu';

interface Props {
  x: number;
  y: number;
  cardName: string;
  stickers: string[];
  /** Live counter tallies on this card — drives the value shown beside each
   *  ± row, and surfaces custom counter kinds that aren't in COUNTER_KINDS. */
  counters: Record<string, number>;
  /** Other battlefield permanents this card can be attached to. */
  attachTargets: Array<{ id: string; name: string }>;
  /** Name of the permanent this card is currently attached to, if any. */
  attachedToName?: string;
  /** `null` detaches. */
  onAttach(targetId: string | null): void;
  /** Current commander tax (already ×2, e.g. 4 for "Tax: +4"); 0/undefined hides the line. */
  tax?: number;
  /** Only true two-faced cards (transform/MDFC) offer Flip. */
  canTransform?: boolean;
  /** Current tapped / face-down state — the menu names the action that
   *  changes it ("Untap", "Turn face up") rather than a "Tap / Untap"
   *  toggle the player has to resolve against the board. */
  tapped?: boolean;
  faceDown?: boolean;
  /** Current phased-out state — purely a "doesn't interact right now"
   *  reminder flag, no rules enforcement. See `BattlefieldCard.phased`. */
  phased?: boolean;
  variant?: 'floating' | 'sheet';
  /** A submenu to open on arrival. The counters key (J) opens the menu
   *  straight onto Counters rather than making the player drill in by hand. */
  initialPage?: CardMenuPage;
  /** The live binding for a shortcut, already formatted for display — every
   *  row that has one prints it, so the menu teaches the keyboard instead of
   *  competing with it. Omitted (tests, previews) simply prints no keys. */
  keyFor?(id: ShortcutId): string | undefined;
  onClose(): void;
  /** Opens the shared CardPreview (B6-07). Omitted (no menu item) when this
   *  card has no resolvable ScryfallCard to preview. */
  onPreview?(): void;
  onTap(): void;
  onAddCounter(kind: string): void;
  onRemoveCounter(kind: string): void;
  /** Bulk steps across every counter already on the card, and clearing them
   *  all. Omitted hides the rows; a card with no counters shows them off. */
  onAdjustAllCounters?(op: 'inc' | 'dec' | 'double' | 'clear'): void;
  onAddSticker(text: string): void;
  onRemoveSticker(index: number): void;
  onFlip(): void;
  onTransform(): void;
  onTogglePhased(): void;
  /** Current power/toughness modifier, if any — shown as the running total
   *  beside the ± steps so the menu never asks the player to remember what
   *  they have already pumped. */
  pt?: { power: number; toughness: number };
  /** The printed body when both halves are numbers. "Set power / toughness"
   *  has to know what the modifier is relative to, and a `*` creature has no
   *  printed number to set from, so omitted hides that row. */
  printedPt?: { power: number; toughness: number };
  onAdjustPT(power: number, toughness: number): void;
  /** Starts an arrow from this card. Online tables only — an arrow with
   *  nobody to see it is a note to yourself. Omitted hides the row. */
  onDrawArrow?(): void;
  /** Put this card on the stack, or put a copy of it there. */
  onPutOnStack(copy: boolean): void;
  /** Token-copy this card. When a multi-card selection is active and includes
   *  this card, the whole selection is copied — `selectionSize` says so. */
  onDuplicate(): void;
  /** How many cards this menu acts on (1 unless it was opened on a card in
   *  a live selection). Above 1 the menu says so and its batch-capable
   *  actions run over the whole selection. */
  selectionSize?: number;
  onMoveTo(zone: Zone, toIndex?: number): void;
  /** Cards in the library, which caps how far down a card can be buried.
   *  Omitted (tests, previews) hides the "X from top" row — there is no
   *  honest maximum to offer without it. */
  libraryCount?: number;
}

/** The submenu the menu can open on. */
export type CardMenuPage = 'counters';

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
const MAX_COUNTER_NAME = 20;

/** A ± counter step that repeats while held. Own component because the hook
 *  can't be called inside a `.map`. */
function CounterStep({
  label,
  onAdjust,
  children,
}: {
  label: string;
  onAdjust(): void;
  children: React.ReactNode;
}) {
  const press = usePressRepeat(onAdjust);
  return (
    <button type="button" aria-label={label} {...press}>
      {children}
    </button>
  );
}

/** Power and toughness typed in as the numbers the card should read, for the
 *  effects that SET a body (Humility, becoming a 0/1) rather than pump it. */
function SetPtPage({
  current,
  onSet,
}: {
  current: { power: number; toughness: number };
  onSet(power: number, toughness: number): void;
}) {
  const [power, setPower] = useState(String(current.power));
  const [toughness, setToughness] = useState(String(current.toughness));
  const p = Number.parseInt(power, 10);
  const t = Number.parseInt(toughness, 10);
  const valid = Number.isFinite(p) && Number.isFinite(t);
  return (
    <form
      className="playtest-ctx-count"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSet(p, t);
      }}
    >
      <div className="playtest-ctx-count__step">
        <input
          type="number"
          value={power}
          onChange={(e) => setPower(e.target.value)}
          aria-label="Power"
        />
        <span aria-hidden>/</span>
        <input
          type="number"
          value={toughness}
          onChange={(e) => setToughness(e.target.value)}
          aria-label="Toughness"
        />
      </div>
      <button type="submit" className="playtest-ctx-action" disabled={!valid}>
        <span>{valid ? `Set to ${p}/${t}` : 'Set'}</span>
      </button>
    </form>
  );
}

/**
 * The menu behind a right-click / long-press on a battlefield permanent, laid
 * out the way EDHPlay lays out the same menu (the table these players arrive
 * from): tap / counters and power / move / face / copies and the stack /
 * information, a line between each group, and everything that needs a
 * stepper, a picker or a text field one submenu down. Every row prints its
 * live binding, the same one the board's keydown handler dispatches: the menu
 * is the discoverable face of the keyboard map, never a second set of
 * behaviour.
 *
 * Phasing, copying onto the stack, attachments and stickers are ours
 * (EDHPlay has none of them in this menu) and live under More, last, where
 * they cost the common path nothing.
 */
export function CardContextMenu({
  x,
  y,
  cardName,
  stickers,
  counters,
  attachTargets,
  attachedToName,
  onAttach,
  tax,
  canTransform = false,
  tapped = false,
  faceDown = false,
  phased = false,
  variant = 'floating',
  initialPage,
  keyFor,
  onClose,
  onPreview,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onAdjustAllCounters,
  onAddSticker,
  onRemoveSticker,
  onFlip,
  onTransform,
  onTogglePhased,
  pt,
  printedPt,
  onAdjustPT,
  onDrawArrow,
  onPutOnStack,
  onDuplicate,
  selectionSize = 1,
  onMoveTo,
  libraryCount,
}: Props) {
  const [stickerText, setStickerText] = useState('');
  const [counterText, setCounterText] = useState('');

  const key = (id: ShortcutId) => keyFor?.(id);

  function submitSticker() {
    const text = stickerText.trim();
    if (!text) return;
    onAddSticker(text);
    setStickerText('');
  }

  function submitCounter() {
    const kind = counterText.trim().slice(0, MAX_COUNTER_NAME);
    if (!kind) return;
    onAddCounter(kind);
    setCounterText('');
  }

  // The four presets plus whatever custom kinds are already on the card, so a
  // counter added by name stays adjustable (and removable) afterwards rather
  // than being visible only on the card face.
  const counterKinds = [
    ...COUNTER_KINDS,
    ...Object.keys(counters).filter((k) => !COUNTER_KINDS.includes(k)),
  ];
  const hasCounters = Object.keys(counters).length > 0;
  /** The keys that add one of a kind, where the kind has one. */
  const counterKey: Record<string, ShortcutId> = {
    '+1/+1': 'counter-plus',
    '-1/-1': 'counter-minus',
  };

  const countersPage = (
    <>
      {counterKinds.map((k) => {
        const plusKey = k in counterKey ? key(counterKey[k]) : undefined;
        return (
          <div key={k} className="playtest-ctx-counter">
            <span>{k}</span>
            <span className="playtest-ctx-counter__value" aria-hidden>
              {counters[k] ?? 0}
            </span>
            <CounterStep
              label={`Remove ${k}, currently ${counters[k] ?? 0}`}
              onAdjust={() => onRemoveCounter(k)}
            >
              −
            </CounterStep>
            <CounterStep
              label={`Add ${k}, currently ${counters[k] ?? 0}${plusKey ? `, ${plusKey}` : ''}`}
              onAdjust={() => onAddCounter(k)}
            >
              +
            </CounterStep>
          </div>
        );
      })}
      {/* EDHPlay's "Add New Counter". The reducer accepts any counter name,
          so saga chapters, ascend, fade and the rest need only this field. */}
      <div className="playtest-ctx-counter-add">
        <input
          type="text"
          value={counterText}
          onChange={(e) => setCounterText(e.target.value)}
          placeholder="New counter"
          maxLength={MAX_COUNTER_NAME}
          aria-label="Counter name"
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitCounter();
          }}
        />
        <button
          type="button"
          disabled={!counterText.trim()}
          onClick={submitCounter}
          aria-label="Add counter"
        >
          Add
        </button>
      </div>
    </>
  );

  const ptPage = (
    <>
      {/* A running modifier, not an absolute — the card face adds it to the
          printed body. Kept apart from the +1/+1 counters because a pump that
          wears off at end of turn and a counter that stays are different
          things at a real table. */}
      {(
        [
          ['Power', pt?.power ?? 0, (d: number) => onAdjustPT(d, 0), 'power-inc', 'power-dec'],
          [
            'Toughness',
            pt?.toughness ?? 0,
            (d: number) => onAdjustPT(0, d),
            'toughness-inc',
            'toughness-dec',
          ],
        ] as const
      ).map(([label, value, adjust, upId, downId]) => {
        const reading = value >= 0 ? `+${value}` : String(value);
        const down = key(downId);
        const up = key(upId);
        return (
          <div key={label} className="playtest-ctx-counter">
            <span>{label}</span>
            <span className="playtest-ctx-counter__value" aria-hidden>
              {reading}
            </span>
            <CounterStep
              label={`${label} down, currently ${reading}${down ? `, ${down}` : ''}`}
              onAdjust={() => adjust(-1)}
            >
              −
            </CounterStep>
            <CounterStep
              label={`${label} up, currently ${reading}${up ? `, ${up}` : ''}`}
              onAdjust={() => adjust(1)}
            >
              +
            </CounterStep>
          </div>
        );
      })}
    </>
  );

  const attachPage = (
    <>
      {attachedToName ? (
        <div className="playtest-ctx-attached">
          <span>{attachedToName}</span>
          <button type="button" onClick={() => onAttach(null)}>
            Unattach
          </button>
        </div>
      ) : (
        <div className="playtest-ctx-attached playtest-ctx-attached--none">Not attached</div>
      )}
      {attachTargets.length > 0 && (
        // A native <select> rather than a custom list: it stays usable at
        // any board size, opens the platform picker on touch, and is
        // keyboard/screen-reader correct for free.
        <select
          className="playtest-ctx-attach-select"
          value=""
          aria-label={`Attach ${cardName} to`}
          onChange={(e) => {
            if (e.target.value) onAttach(e.target.value);
          }}
        >
          <option value="">{attachedToName ? 'Move to…' : 'Attach to…'}</option>
          {attachTargets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
    </>
  );

  const stickersPage = (
    <>
      {/* The reducer hard-caps at 8 per card; mirror it here so the input
          can't silently swallow a 9th (the add would no-op). */}
      {stickers.length >= 8 ? (
        <div className="playtest-ctx-sticker-limit">Sticker limit reached (8 per card).</div>
      ) : (
        <div className="playtest-ctx-sticker-add">
          <input
            type="text"
            value={stickerText}
            onChange={(e) => setStickerText(e.target.value)}
            placeholder="flying"
            maxLength={30}
            aria-label="Sticker text"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitSticker();
            }}
          />
          <button
            type="button"
            disabled={!stickerText.trim()}
            onClick={submitSticker}
            aria-label="Add sticker"
          >
            Add
          </button>
        </div>
      )}
      {stickers.map((s, i) => (
        <div key={`${i}-${s}`} className="playtest-ctx-sticker">
          <span>{s}</span>
          <button
            type="button"
            onClick={() => onRemoveSticker(i)}
            aria-label={`Remove sticker ${s}`}
          >
            ×
          </button>
        </div>
      ))}
    </>
  );

  const body = {
    power: (printedPt?.power ?? 0) + (pt?.power ?? 0),
    toughness: (printedPt?.toughness ?? 0) + (pt?.toughness ?? 0),
  };

  const items: MenuEntry[] = [
    { label: tapped ? 'Untap' : 'Tap', shortcut: key('tap-selection'), onClick: onTap },
    SEPARATOR,
    {
      id: 'counters',
      label: 'Counters',
      shortcut: key('counters'),
      content: countersPage,
      // A card with no counters has nothing to step, so these stay in place
      // switched off: the submenu is the same shape on every card.
      items: onAdjustAllCounters && [
        {
          label: 'Add one to each',
          shortcut: key('counters-all-inc'),
          disabled: !hasCounters,
          onClick: () => onAdjustAllCounters('inc'),
        },
        {
          label: 'Take one off each',
          shortcut: key('counters-all-dec'),
          disabled: !hasCounters,
          onClick: () => onAdjustAllCounters('dec'),
        },
        {
          label: 'Double each',
          shortcut: key('counters-all-double'),
          disabled: !hasCounters,
          onClick: () => onAdjustAllCounters('double'),
        },
        SEPARATOR,
        {
          label: 'Remove every counter',
          disabled: !hasCounters,
          onClick: () => onAdjustAllCounters('clear'),
        },
      ],
    },
    {
      label: 'Power / toughness',
      content: ptPage,
      items: [
        ...(printedPt
          ? [
              {
                label: 'Set power / toughness',
                content: (
                  <SetPtPage
                    current={body}
                    onSet={(p, t) => {
                      onAdjustPT(p - body.power, t - body.toughness);
                      onClose();
                    }}
                  />
                ),
              },
            ]
          : []),
        {
          label: 'Back to printed size',
          disabled: !pt,
          onClick: () => pt && onAdjustPT(-pt.power, -pt.toughness),
        },
      ],
    },
    SEPARATOR,
    {
      label: 'Move to',
      items: moveToEntries({ from: 'battlefield', keyFor, libraryCount, onMoveTo }),
    },
    SEPARATOR,
    ...(canTransform ? [{ label: 'Flip', shortcut: key('transform'), onClick: onTransform }] : []),
    {
      label: faceDown ? 'Turn face up' : 'Turn face down',
      shortcut: key('face-down'),
      onClick: onFlip,
    },
    SEPARATOR,
    {
      label: selectionSize > 1 ? `Make ${selectionSize} token copies` : 'Make a token copy',
      shortcut: key('clone'),
      onClick: onDuplicate,
    },
    ...(onDrawArrow
      ? [{ label: 'Draw an arrow', shortcut: key('arrow'), onClick: onDrawArrow }]
      : []),
    { label: 'Add to the stack', shortcut: key('stack-add'), onClick: () => onPutOnStack(false) },
    SEPARATOR,
    ...(onPreview ? [{ label: 'View information', onClick: onPreview }] : []),
    SEPARATOR,
    {
      label: 'More',
      items: [
        { label: phased ? 'Phase in' : 'Phase out', onClick: onTogglePhased },
        {
          label: 'Copy onto the stack',
          shortcut: key('stack-copy'),
          onClick: () => onPutOnStack(true),
        },
        ...(attachTargets.length > 0 || attachedToName
          ? [{ label: attachedToName ? 'Attached to' : 'Attach to', content: attachPage }]
          : []),
        {
          label: stickers.length > 0 ? `Stickers (${stickers.length})` : 'Stickers',
          content: stickersPage,
        },
      ],
    },
  ];

  // Opened on a card that is part of a selection, this menu acts on the whole
  // selection — the heading is what says so before anything is clicked.
  const header = (selectionSize > 1 || Boolean(tax)) && (
    <>
      {selectionSize > 1 && (
        <div className="playtest-ctx-selection">{selectionSize} cards selected</div>
      )}
      {Boolean(tax) && <div className="playtest-ctx-tax">Tax: +{tax}</div>}
    </>
  );

  return (
    <TableContextMenu
      x={x}
      y={y}
      variant={variant}
      title={selectionSize > 1 ? `${selectionSize} cards selected` : cardName}
      header={header}
      openId={initialPage}
      items={items}
      onClose={onClose}
    />
  );
}

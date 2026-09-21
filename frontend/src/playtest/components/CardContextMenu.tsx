import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePressRepeat } from '@/lib/use-press-repeat';
import type { Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, destinationKey } from '../lib/zones';
import type { ShortcutId } from '../lib/shortcuts';
import { CtxMenuShell } from '@/components/shared/CtxMenuShell';
import { CountPage } from './CountPage';

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
  /** Only true two-faced cards (transform/MDFC) offer Transform. */
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
  /** Which page the menu opens on. The counters key (J) opens it straight on
   *  Counters rather than making the player drill in by hand. */
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
  /** Bulk steps across every counter already on the card. Omitted hides the
   *  rows, as does a card with no counters (all three are no-ops there). */
  onAdjustAllCounters?(op: 'inc' | 'dec' | 'double'): void;
  onAddSticker(text: string): void;
  onRemoveSticker(index: number): void;
  onFlip(): void;
  onTransform(): void;
  onTogglePhased(): void;
  /** Current power/toughness modifier, if any — shown as the running total
   *  beside the ± steps so the menu never asks the player to remember what
   *  they have already pumped. */
  pt?: { power: number; toughness: number };
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
   *  Omitted (tests, previews) hides the "X from the top" row — there is no
   *  honest maximum to offer without it. */
  libraryCount?: number;
}

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
const MAX_COUNTER_NAME = 20;

/** Which shortcut each Move-to destination answers to, so the submenu prints
 *  the same keys the board already listens for. The command zone has none. */
const MOVE_SHORTCUT: Record<string, ShortcutId | undefined> = {
  'hand:end': 'to-hand',
  'graveyard:end': 'to-graveyard',
  'exile:end': 'to-exile',
  'library:0': 'to-library-top',
  'library:end': 'to-library-bottom',
  'command:end': undefined,
};

/** The pages this menu drills into. `root` is the short action list; the rest
 *  are one level down, reached by a `▸` row and left by the back row. */
export type CardMenuPage = 'root' | 'counters' | 'pt' | 'move' | 'move-x' | 'more';
type Page = CardMenuPage;

const PAGE_TITLE: Record<Exclude<Page, 'root'>, string> = {
  counters: 'Counters',
  pt: 'Power / toughness',
  move: 'Move to',
  'move-x': 'Library, X from the top',
  more: 'More',
};

/** One action row: what it does, and the key that does the same thing. */
function MenuAction({
  label,
  shortcut,
  onClick,
  pressed,
}: {
  label: string;
  shortcut?: string;
  onClick(): void;
  pressed?: boolean;
}) {
  return (
    <button type="button" className="playtest-ctx-action" onClick={onClick} aria-pressed={pressed}>
      <span>{label}</span>
      {shortcut && <kbd className="playtest-ctx-key">{shortcut}</kbd>}
    </button>
  );
}

/** One row that opens a page instead of doing something. */
function MenuSubmenu({
  label,
  shortcut,
  onOpen,
}: {
  label: string;
  shortcut?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      className="playtest-ctx-action playtest-ctx-action--submenu"
      aria-haspopup="menu"
      onClick={onOpen}
    >
      <span>{label}</span>
      <span className="playtest-ctx-action__end">
        {shortcut && <kbd className="playtest-ctx-key">{shortcut}</kbd>}
        <ChevronRight width={14} height={14} aria-hidden />
      </span>
    </button>
  );
}

/** A ± counter step that repeats while held. Own component because the hook
 *  can't be called inside the `.map` below. */
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

/**
 * The menu behind a right-click / long-press on a battlefield permanent.
 *
 * A short list of actions with four drill-downs rather than one scrolling
 * panel: everything that needs a stepper, a picker or a text field — counters,
 * power/toughness, the zone list, and the rarely-wanted rest — lives one row
 * down, so the menu opens at a size a player can read at a glance. Every row
 * prints its live binding, the same one the board's keydown handler
 * dispatches: the menu is the discoverable face of the keyboard map, never a
 * second set of behaviour.
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
  initialPage = 'root',
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
  onAdjustPT,
  onDrawArrow,
  onPutOnStack,
  onDuplicate,
  selectionSize = 1,
  onMoveTo,
  libraryCount,
}: Props) {
  const [page, setPage] = useState<Page>(initialPage);
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

  const root = (
    <>
      {/* Opened on a card that is part of a selection, this menu acts on the
          whole selection — the heading is what says so before anything is
          clicked. */}
      {selectionSize > 1 && (
        <div className="playtest-ctx-selection">{selectionSize} cards selected</div>
      )}
      {Boolean(tax) && <div className="playtest-ctx-tax">Tax: +{tax}</div>}
      <MenuAction
        label={tapped ? 'Untap' : 'Tap'}
        shortcut={key('tap-selection')}
        onClick={onTap}
      />
      <MenuSubmenu label="Counters" shortcut={key('counters')} onOpen={() => setPage('counters')} />
      <MenuSubmenu label="Power / toughness" onOpen={() => setPage('pt')} />
      <MenuSubmenu label="Move to" onOpen={() => setPage('move')} />
      <MenuAction
        label={faceDown ? 'Turn face up' : 'Turn face down'}
        shortcut={key('face-down')}
        onClick={onFlip}
      />
      <MenuAction
        label={selectionSize > 1 ? `Make ${selectionSize} token copies` : 'Make a token copy'}
        shortcut={key('clone')}
        onClick={onDuplicate}
      />
      {onDrawArrow && (
        <MenuAction label="Draw an arrow" shortcut={key('arrow')} onClick={onDrawArrow} />
      )}
      <MenuAction
        label="Put on the stack"
        shortcut={key('stack-add')}
        onClick={() => onPutOnStack(false)}
      />
      {onPreview && <MenuAction label="View information" onClick={onPreview} />}
      <MenuSubmenu label="More" onOpen={() => setPage('more')} />
    </>
  );

  const countersPage = (
    <>
      {counterKinds.map((k) => (
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
            label={`Add ${k}, currently ${counters[k] ?? 0}`}
            onAdjust={() => onAddCounter(k)}
          >
            +
          </CounterStep>
        </div>
      ))}
      {/* The reducer already accepts any counter name — this input is the
          only thing that was missing for saga chapters, ascend, fade, etc. */}
      <div className="playtest-ctx-counter-add">
        <input
          type="text"
          value={counterText}
          onChange={(e) => setCounterText(e.target.value)}
          placeholder="chapter"
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
      {/* Bulk steps act on every kind at once — the saga-and-charge card where
          stepping each kind by hand is the tedious part. */}
      {onAdjustAllCounters && hasCounters && (
        <div className="playtest-ctx-group">
          <div className="playtest-ctx-heading">Every counter</div>
          <MenuAction
            label="Add one to each"
            shortcut={key('counters-all-inc')}
            onClick={() => onAdjustAllCounters('inc')}
          />
          <MenuAction
            label="Take one off each"
            shortcut={key('counters-all-dec')}
            onClick={() => onAdjustAllCounters('dec')}
          />
          <MenuAction
            label="Double each"
            shortcut={key('counters-all-double')}
            onClick={() => onAdjustAllCounters('double')}
          />
        </div>
      )}
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

  const movePage = (
    <>
      {MOVE_DESTINATIONS.map((z) => {
        const id = MOVE_SHORTCUT[destinationKey(z)];
        return (
          <MenuAction
            key={destinationKey(z)}
            label={z.label}
            shortcut={id && key(id)}
            onClick={() => onMoveTo(z.key, z.toIndex)}
          />
        );
      })}
      {/* Top and bottom are the two ends; this is everywhere between them —
          a tutor putting something back a few cards down, or a Brainstorm
          leftover that should not be the next draw. */}
      {libraryCount !== undefined && libraryCount > 0 && (
        <MenuSubmenu label="Library, X from the top" onOpen={() => setPage('move-x')} />
      )}
    </>
  );

  const moveXPage = (
    <CountPage
      max={libraryCount ?? 0}
      // 1 is the first position the two end rows do not already cover.
      initial={1}
      // Says the RESULT, not the index: "3 from the top" reads as either the
      // third card or the fourth depending on who you ask, and burying a card
      // in the wrong slot is invisible until you draw it.
      label={(n) => `Put it under ${n} card${n === 1 ? '' : 's'}`}
      onConfirm={(n) => onMoveTo('library', n)}
    />
  );

  const morePage = (
    <>
      {canTransform && (
        <MenuAction label="Transform" shortcut={key('transform')} onClick={onTransform} />
      )}
      <MenuAction
        label={phased ? 'Phase in' : 'Phase out'}
        onClick={onTogglePhased}
        pressed={phased}
      />
      <MenuAction
        label="Copy onto the stack"
        shortcut={key('stack-copy')}
        onClick={() => onPutOnStack(true)}
      />
      {(attachTargets.length > 0 || attachedToName) && (
        <div className="playtest-ctx-group">
          <div className="playtest-ctx-heading">Attached to</div>
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
        </div>
      )}
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Stickers</div>
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
      </div>
    </>
  );

  const pages: Record<Page, React.ReactNode> = {
    root,
    counters: countersPage,
    pt: ptPage,
    move: movePage,
    'move-x': moveXPage,
    more: morePage,
  };

  // What the page you are on is about. A "Move to" headed "Grizzly Bears"
  // while it is about to move five cards was a lie the root page had already
  // corrected — but counters and power/toughness DO act on the one card you
  // opened the menu on, so there the card's name is the true heading.
  const actsOnSelection = selectionSize > 1 && (page === 'root' || page === 'move');
  const subject = actsOnSelection ? `${selectionSize} cards selected` : cardName;
  // "X from the top" is a page UNDER "Move to", so its back row goes up one
  // level rather than all the way out.
  const backTo: Page = page === 'move-x' ? 'move' : 'root';
  const backLabel = backTo === 'root' ? subject : PAGE_TITLE.move;

  return (
    <CtxMenuShell
      x={x}
      y={y}
      title={page === 'root' ? subject : PAGE_TITLE[page]}
      variant={variant}
      // A page swap changes the panel's height, so the floating variant
      // re-clamps, and focus lands on the new page's first row.
      contentKey={page}
      onClose={onClose}
    >
      {page !== 'root' && (
        <button
          type="button"
          className="playtest-ctx-back"
          onClick={() => setPage(backTo)}
          aria-label={`Back to ${backLabel}`}
        >
          <ChevronLeft width={14} height={14} aria-hidden />
          <span>{backLabel}</span>
        </button>
      )}
      {pages[page]}
    </CtxMenuShell>
  );
}

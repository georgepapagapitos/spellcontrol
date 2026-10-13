import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Boxes, ChevronRight, Layers, Notebook } from 'lucide-react';
import type { EnrichedCard } from '@/types/index';
import type { CubeListing } from '@/lib/cube/cube-listings';
import {
  copiesWord,
  describeCopyPlaces,
  listedNotHeld,
  markGroups,
  type CopyBreakdown,
  type CopyPlace,
  type MarkGroup,
  type MarkKind,
} from '@/lib/collection/copy-locations';
import { formatLocation, formatLocationSpan, type CardLocation } from '@/lib/binder/card-locations';
import { useAnchoredPanel } from '@/lib/overlays/use-anchored-panel';
import { useMediaQuery } from '@/lib/util/use-media-query';
import { printedName } from '@spellcontrol/binder-routing';
import { Modal } from '@/components/overlays/Modal';
import { Button } from './Button';
import { ArtBadge } from './ArtBadge';
import { Surface } from './Surface';
import { SectionHeader } from './SectionHeader';
import './CopyPlaces.css';

/** The phone tier, where the list opens as a bottom sheet (as SortPopover). */
const NARROW = '(max-width: 599px)';

const ICON: Record<MarkKind, typeof Layers> = {
  deck: Layers,
  cube: Boxes,
  binder: Notebook,
  listed: Boxes,
};

/** Keep Enter and Space on the trigger from reaching a row around it, which
 *  opens the card. (A tap stops in the trigger's onClick; the panel is a
 *  portal, and CardRow ignores events from outside its own DOM.) */
const stopActivationKeys = (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
};

function ArtMark({ group }: { group: MarkGroup }) {
  const Icon = ICON[group.kind];
  const identity = group.kind === 'listed' ? 'listed' : group.color ? 'one' : 'many';
  const disc = (
    <ArtBadge
      className="identity-mark"
      data-identity={identity}
      style={group.color ? ({ '--identity-color': group.color } as CSSProperties) : undefined}
      aria-hidden
    >
      <Icon width={11} height={11} strokeWidth={2} aria-hidden />
    </ArtBadge>
  );
  if (!group.counted) return disc;
  // The same identity disc, seated on a plate that carries the count. The
  // count reads on the scrim, never on the owner's color, so it holds on a
  // light deck color as well as a dark one.
  return (
    <ArtBadge className="copy-places-counted" aria-hidden>
      {disc}
      <span className="copy-places-count">{group.copies}</span>
    </ArtBadge>
  );
}

function RowMark({ group }: { group: MarkGroup }) {
  const Icon = ICON[group.kind];
  const binder = group.kind === 'binder';
  const base = binder ? 'card-list-binder-badge' : 'card-list-deck-badge';
  const cls = [
    base,
    group.kind === 'listed' ? 'card-list-deck-badge--listed' : '',
    group.color ? '' : `${base}--multi`,
  ]
    .filter(Boolean)
    .join(' ');
  const style: CSSProperties | undefined = !group.color
    ? undefined
    : binder
      ? ({ '--binder-color': group.color, color: group.color } as CSSProperties)
      : ({ '--deck-color': group.color } as CSSProperties);
  return (
    <span className={cls} style={style} aria-hidden>
      <Icon width={binder ? 12 : 11} height={binder ? 12 : 11} strokeWidth={2} aria-hidden />
      {group.counted && <span className="card-list-deck-badge-count">{group.copies}</span>}
    </span>
  );
}

/** The second line of a place's row: what it is and where its copies sit. */
function placeDetail(place: CopyPlace, locations: ReadonlyMap<string, CardLocation>): string {
  const spots = place.copyIds.map((id) => locations.get(id)).filter((l): l is CardLocation => !!l);
  if (place.kind === 'binder') {
    const volumes = new Set(spots.map((s) => s.volume));
    const where = formatLocationSpan(spots, {
      volume: volumes.size === 1 ? [...volumes][0] : undefined,
    });
    return where ? `Binder · ${where}` : 'Binder';
  }
  const what = place.kind === 'deck' ? 'Deck' : 'Cube';
  // A copy out in a deck or cube keeps its pocket; say where it goes back.
  const binders = new Set(spots.map((s) => s.binderId));
  if (spots.length === 0) return what;
  if (binders.size > 1) return `${what} · its pockets are in ${binders.size} binders`;
  if (spots.length === 1) return `${what} · its pocket is ${formatLocation(spots[0])}`;
  return `${what} · its pockets are ${spots[0].binderName} · ${formatLocationSpan(spots)}`;
}

function PlaceRow({
  place,
  locations,
  onNavigate,
}: {
  place: CopyPlace;
  locations: ReadonlyMap<string, CardLocation>;
  onNavigate: () => void;
}) {
  const Icon = ICON[place.kind];
  return (
    <li>
      <Link
        to={place.href}
        className="toolbar-popover-item copy-places-link"
        onClick={onNavigate}
        aria-label={`${place.name}, ${placeDetail(place, locations)}, ${copiesWord(place.copyIds.length)}`}
      >
        <span
          className="copy-places-row-mark"
          style={{ '--identity-color': place.color } as CSSProperties}
          aria-hidden
        >
          <Icon width={12} height={12} strokeWidth={2} />
        </span>
        <span className="copy-places-row-text">
          <span className="copy-places-row-name">{place.name}</span>
          <span className="copy-places-row-detail">{placeDetail(place, locations)}</span>
        </span>
        <span className="copy-places-row-count" aria-hidden>
          {place.copyIds.length}
        </span>
        <ChevronRight
          className="copy-places-row-chevron"
          width={14}
          height={14}
          strokeWidth={1.8}
          aria-hidden
        />
      </Link>
    </li>
  );
}

/** Every place a stack's copies are, one row each: the trigger's panel. */
function CopyPlacesList({
  card,
  breakdown,
  listedIn,
  locations,
  onNavigate,
}: {
  card: EnrichedCard;
  breakdown: CopyBreakdown;
  listedIn: readonly CubeListing[];
  locations: ReadonlyMap<string, CardLocation>;
  onNavigate: () => void;
}) {
  const listed = listedNotHeld(breakdown, listedIn);
  return (
    <div className="copy-places-list">
      <div className="copy-places-head">
        <span className="copy-places-title">{printedName(card)}</span>
        <span className="copy-places-sub">
          {card.setCode ? `${card.setCode.toUpperCase()} · ` : ''}
          {copiesWord(breakdown.total)}
        </span>
      </div>
      <ul className="copy-places-rows">
        {breakdown.places.map((p) => (
          <PlaceRow
            key={`${p.kind}:${p.id}`}
            place={p}
            locations={locations}
            onNavigate={onNavigate}
          />
        ))}
        {breakdown.unplaced > 0 && (
          <li className="copy-places-static">
            <span className="copy-places-row-mark copy-places-row-mark--none" aria-hidden />
            <span className="copy-places-row-text">
              <span className="copy-places-row-name">Not in a deck or binder</span>
            </span>
            <span className="copy-places-row-count">
              <span aria-hidden>{breakdown.unplaced}</span>
              <span className="visually-hidden">{copiesWord(breakdown.unplaced)}</span>
            </span>
            <span className="copy-places-row-spacer" aria-hidden />
          </li>
        )}
      </ul>
      {listed.length > 0 && (
        <>
          <SectionHeader
            id={`copy-places-listed-${card.copyId}`}
            level={3}
            variant="overline"
            className="copy-places-section"
            title="Listed, no copy held"
          />
          <ul className="copy-places-rows" aria-labelledby={`copy-places-listed-${card.copyId}`}>
            {listed.map((l) => (
              <li key={l.cubeId}>
                <Link
                  to={`/decks/cube/${l.cubeId}`}
                  className="toolbar-popover-item copy-places-link"
                  onClick={onNavigate}
                  aria-label={`${l.cubeName}, lists this card`}
                >
                  <span className="copy-places-row-mark copy-places-row-mark--listed" aria-hidden>
                    <Boxes width={12} height={12} strokeWidth={2} />
                  </span>
                  <span className="copy-places-row-text">
                    <span className="copy-places-row-name">{l.cubeName}</span>
                    <span className="copy-places-row-detail">Lists this card</span>
                  </span>
                  <span aria-hidden />
                  <ChevronRight
                    className="copy-places-row-chevron"
                    width={14}
                    height={14}
                    strokeWidth={1.8}
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export interface CopyPlacesProps {
  /** The stack's representative copy: names the list's header. */
  card: EnrichedCard;
  breakdown: CopyBreakdown;
  listedIn?: readonly CubeListing[];
  /** Pages and pockets by copyId (`indexCardLocations(...).byCopyId`). */
  locations: ReadonlyMap<string, CardLocation>;
  /** `art` on a grid tile, `row` beside a name. */
  placement: 'art' | 'row';
  /** Which marks this trigger draws; the list always shows every place. */
  kinds?: readonly MarkKind[];
  /** False in select mode: the marks show, but a tap selects the tile. */
  interactive?: boolean;
}

/**
 * Where a stack's copies are: the deck, cube and binder marks, counted when a
 * mark holds part of the stack, as one button that opens every place with
 * its count and pocket. An anchored popover on a roomy screen and a bottom
 * sheet on a phone (STYLE_GUIDE § Anchored panels, as SortPopover).
 */
export function CopyPlaces(props: CopyPlacesProps) {
  const groups = markGroups(props.breakdown, props.listedIn ?? [], props.kinds);
  const narrow = useMediaQuery(NARROW);
  if (groups.length === 0) return null;
  const label = describeCopyPlaces(props.breakdown, props.listedIn ?? []);
  const Mark = props.placement === 'art' ? ArtMark : RowMark;
  const marks = groups.map((g) => <Mark key={g.kind} group={g} />);
  const cls = `copy-places-trigger copy-places-trigger--${props.placement}`;
  if (props.interactive === false) {
    return (
      <span className={cls} role="img" aria-label={label} title={label}>
        {marks}
      </span>
    );
  }
  return narrow ? (
    <CopyPlacesSheet {...props} label={label} className={cls}>
      {marks}
    </CopyPlacesSheet>
  ) : (
    <CopyPlacesPopover {...props} label={label} className={cls}>
      {marks}
    </CopyPlacesPopover>
  );
}

interface TriggerProps extends CopyPlacesProps {
  label: string;
  className: string;
  children: ReactNode;
}

function CopyPlacesPopover({ label, className, children, ...props }: TriggerProps) {
  const { open, toggle, close, triggerRef, panelRef, panelStyle } = useAnchoredPanel();
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${className}${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        onKeyDown={stopActivationKeys}
      >
        {children}
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <Surface
            as="div"
            variant="popover"
            ref={panelRef}
            className="copy-places-panel"
            role="dialog"
            aria-label={label}
            style={panelStyle}
          >
            <CopyPlacesList
              card={props.card}
              breakdown={props.breakdown}
              listedIn={props.listedIn ?? []}
              locations={props.locations}
              onNavigate={close}
            />
          </Surface>,
          document.body
        )}
    </>
  );
}

function CopyPlacesSheet({ label, className, children, ...props }: TriggerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={stopActivationKeys}
      >
        {children}
      </button>
      {open && (
        <Modal
          backdropClassName="modal-backdrop--sheet"
          className="choice-dialog copy-places-sheet"
          label={label}
          onClose={() => setOpen(false)}
        >
          <CopyPlacesList
            card={props.card}
            breakdown={props.breakdown}
            listedIn={props.listedIn ?? []}
            locations={props.locations}
            onNavigate={() => setOpen(false)}
          />
          <div className="copy-places-sheet-foot">
            <Button variant="link" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

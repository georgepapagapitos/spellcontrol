import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Layers, Notebook } from 'lucide-react';
import type { AllocationInfo } from '@/lib/collection/allocations';
import type { CubeListing } from '@/lib/cube/cube-listings';
import type { BinderInfo } from '@/lib/binder/binder-refs';
import type { CopyBreakdown } from '@/lib/collection/copy-locations';

// A pill's copy count. Inline rather than a class: this module is on the boot
// path, its sheet (footer-card-preview.css) sits at the CSS budget, and the
// count only shows in the collection. The pill's name truncates; the count
// never shrinks.
const PILL_COUNT_STYLE: CSSProperties = { flexShrink: 0, fontVariantNumeric: 'tabular-nums' };

/**
 * The card preview's context line: the scope it was opened from, then a pill
 * for every binder, deck and cube the stack touches, then the stack's size.
 * Split out of CardPreview (file-size ratchet).
 *
 * Given `places` (the collection), binder pills name only binders that hold a
 * copy now, and on a stack of more than one every pill carries its count:
 * the same numbers as the tile's marks. Without it (binder, deck and list
 * views), the pills are the stack's binders and claims, uncounted.
 */
export function PreviewContextLine({
  words,
  binders,
  allocations,
  listings,
  places,
  qty,
  currentDeckId,
  onClose,
}: {
  /** The scope and section, already joined ("Collection", "Rares · Page 3"). */
  words: string;
  binders: readonly BinderInfo[];
  allocations: readonly AllocationInfo[];
  listings: readonly CubeListing[];
  places: CopyBreakdown | undefined;
  qty: number;
  /** The deck the preview was opened from: its own pill is noise there. */
  currentDeckId?: string;
  onClose: () => void;
}) {
  const binderById = new Map<string, BinderInfo>();
  if (places) {
    for (const p of places.places)
      if (p.kind === 'binder') binderById.set(p.id, { id: p.id, name: p.name, color: p.color });
  } else {
    for (const b of binders) binderById.set(b.id, b);
  }
  const countOf = new Map<string, number>();
  if (places && qty > 1)
    for (const p of places.places) countOf.set(`${p.kind}:${p.id}`, p.copyIds.length);
  const count = (kind: 'deck' | 'cube' | 'binder', id: string) => {
    const n = countOf.get(`${kind}:${id}`);
    return n === undefined
      ? { tag: null, words: '' }
      : {
          tag: (
            <span style={PILL_COUNT_STYLE} aria-hidden>
              {n}
            </span>
          ),
          words: `, ${n} ${n === 1 ? 'copy' : 'copies'}`,
        };
  };
  const deckById = new Map<string, AllocationInfo>();
  const cubeById = new Map<string, AllocationInfo>();
  for (const a of allocations) {
    if (a.ownerKind === 'cube') cubeById.set(a.ownerId, a);
    else if (a.deckId !== currentDeckId) deckById.set(a.deckId, a);
  }
  const pills: ReactNode[] = [
    ...[...binderById.values()].map((b) => {
      const n = count('binder', b.id);
      return (
        <Link
          key={`b-${b.id}`}
          to={`/collection/binders/${b.id}`}
          className="card-preview-context-pill text-link card-preview-context-pill--binder"
          style={{ '--pill-color': b.color || 'var(--accent)' } as CSSProperties}
          onClick={onClose}
          title={`Open binder ${b.name}`}
          aria-label={n.words ? `${b.name}${n.words}` : undefined}
        >
          <Notebook width={12} height={12} strokeWidth={2} aria-hidden />
          <span>{b.name}</span>
          {n.tag}
        </Link>
      );
    }),
    ...[...deckById.values()].map((d) => {
      const n = count('deck', d.ownerId);
      return (
        <Link
          key={`d-${d.deckId}`}
          to={`/decks/${d.ownerId}`}
          className="card-preview-context-pill text-link card-preview-context-pill--deck"
          style={{ '--pill-color': d.deckColor || 'var(--accent)' } as CSSProperties}
          onClick={onClose}
          title={`In deck: ${d.deckName}`}
          aria-label={`In deck: ${d.deckName}${n.words}`}
        >
          <Layers width={12} height={12} strokeWidth={2} aria-hidden />
          <span>{d.deckName}</span>
          {n.tag}
        </Link>
      );
    }),
    ...[...cubeById.values()].map((c) => {
      const n = count('cube', c.ownerId);
      return (
        <Link
          key={`c-${c.ownerId}`}
          to={`/decks/cube/${c.ownerId}`}
          className="card-preview-context-pill text-link card-preview-context-pill--cube"
          style={{ '--pill-color': 'var(--cube-color)' } as CSSProperties}
          onClick={onClose}
          title={`In cube: ${c.ownerName}`}
          aria-label={`In cube: ${c.ownerName}${n.words}`}
        >
          <Boxes width={12} height={12} strokeWidth={2} aria-hidden />
          <span>{c.ownerName}</span>
          {n.tag}
        </Link>
      );
    }),
    // A cube that only lists the card: same pill, hollow and dashed, since
    // it holds no copy (DeckBadge's listed badge, the same ruling).
    ...listings
      .filter((l) => !cubeById.has(l.cubeId))
      .map((l) => (
        <Link
          key={`cl-${l.cubeId}`}
          to={`/decks/cube/${l.cubeId}`}
          className="card-preview-context-pill text-link card-preview-context-pill--cube card-preview-context-pill--listed"
          style={{ '--pill-color': 'var(--cube-color)' } as CSSProperties}
          onClick={onClose}
          title={`Listed in cube: ${l.cubeName}`}
          aria-label={`Listed in cube: ${l.cubeName}`}
        >
          <Boxes width={12} height={12} strokeWidth={2} aria-hidden />
          <span>{l.cubeName}</span>
        </Link>
      )),
  ];
  if (!words && pills.length === 0 && qty <= 1) return null;
  return (
    <div className="card-preview-context">
      {words && <span className="card-preview-context-words">{words}</span>}
      {pills}
      {qty > 1 && (
        <span className="card-preview-qty" aria-label={`${qty} copies`} role="img">
          <span aria-hidden>×</span>
          {qty}
        </span>
      )}
    </div>
  );
}

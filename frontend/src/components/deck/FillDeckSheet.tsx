import './FillDeckSheet.css';
import { type JSX, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { useCardThumb } from '@/lib/card-thumbs';
import { buildFill, type FillResult } from '@/lib/fill-deck';
import { userMessage } from '@/lib/user-error';
import { MeterBar } from '../shared/MeterBar';
import type { Deck } from '../../store/decks';

/** Staples <-> Synergy dial stops offered here: the two ends and the middle. */
const LEANS = [
  { value: 0, label: 'Most played', hint: 'What decks with this commander run most' },
  { value: 0.5, label: 'Balanced', hint: 'Popular picks and cards that fit your plan' },
  { value: 1, label: 'Synergy', hint: 'Cards that play off this commander' },
] as const;

/** Type buckets for the review list, in deck-list order. */
const GROUPS = [
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Battle',
  'Land',
] as const;
const groupOf = (c: ScryfallCard) =>
  GROUPS.find((g) => getFrontFaceTypeLine(c).includes(g)) ?? 'Creature';
const PLURAL: Record<(typeof GROUPS)[number], string> = {
  Creature: 'Creatures',
  Planeswalker: 'Planeswalkers',
  Instant: 'Instants',
  Sorcery: 'Sorceries',
  Artifact: 'Artifacts',
  Enchantment: 'Enchantments',
  Battle: 'Battles',
  Land: 'Lands',
};

function Thumb({ name }: { name: string }): JSX.Element {
  const url = useCardThumb(name, 'small');
  return (
    <span className="fill-deck-thumb" aria-hidden>
      {url && <img src={url} alt="" loading="lazy" />}
    </span>
  );
}

export interface FillDeckSheetProps {
  deck: Deck;
  /** Mainboard size the deck should reach (99, or 98 with a partner). */
  target: number;
  /** Owned card names, for the "Favor cards I own" option. Empty hides it. */
  ownedNames: Set<string>;
  onClose: () => void;
  /** Add the reviewed cards (one undo entry is the caller's job). */
  onAdd: (cards: ScryfallCard[]) => void;
}

type Phase =
  | { kind: 'setup' }
  | { kind: 'building'; message: string; percent: number }
  | { kind: 'review'; result: FillResult }
  | { kind: 'error'; message: string };

/**
 * "Fill the rest" for a part-built Commander deck: the generator builds around
 * every card already in it and this sheet lists what it would add, grouped by
 * type with the generator's own reason for each, before anything changes.
 * House card-picker overlay: a bottom sheet on phones, centered from 1024px.
 */
export function FillDeckSheet({
  deck,
  target,
  ownedNames,
  onClose,
  onAdd,
}: FillDeckSheetProps): JSX.Element {
  useLockBodyScroll();
  const titleId = useId();
  const leanGroup = useId();
  const open = Math.max(0, target - deck.cards.length);
  const [lean, setLean] = useState<number>(0.5);
  const [preferOwned, setPreferOwned] = useState(ownedNames.size > 0);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  // A build can't be cancelled mid-flight; closing just drops its answer.
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    []
  );

  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  const run = async () => {
    setPhase({ kind: 'building', message: 'Reading your deck…', percent: 2 });
    try {
      const result = await buildFill(
        deck,
        target,
        { brewLevel: lean, preferOwned: preferOwned && ownedNames.size > 0 },
        {
          ownedNames,
          onProgress: (message, percent) => {
            if (alive.current) setPhase({ kind: 'building', message, percent });
          },
        }
      );
      if (alive.current) setPhase({ kind: 'review', result });
    } catch (e) {
      if (alive.current)
        setPhase({ kind: 'error', message: userMessage(e, "Couldn't fill the deck.") });
    }
  };

  const groups = useMemo(() => {
    if (phase.kind !== 'review') return [];
    const by = new Map<(typeof GROUPS)[number], ScryfallCard[]>();
    for (const c of phase.result.plan.additions) {
      const g = groupOf(c);
      by.set(g, [...(by.get(g) ?? []), c]);
    }
    return GROUPS.filter((g) => by.has(g)).map((g) => ({ group: g, cards: by.get(g)! }));
  }, [phase]);

  const commanderName = deck.commander?.name ?? 'this commander';
  const additions = phase.kind === 'review' ? phase.result.plan.additions : [];

  return (
    <div
      className="card-picker-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet fill-deck-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <p id={titleId} className="fill-deck-title">
            Fill the rest
          </p>
          <p className="fill-deck-subtitle">
            {open === 1 ? '1 open slot' : `${open} open slots`} · {deck.cards.length} of {target}{' '}
            cards picked
          </p>
        </div>

        <div className="fill-deck-body">
          {phase.kind === 'setup' && (
            <>
              <p className="fill-deck-lead">
                Every card you picked stays. The builder finds the rest from EDHREC data for{' '}
                {commanderName}, favoring cards that play well with yours, and shows you the list
                before anything is added.
              </p>
              <fieldset className="bracket-pill-row fill-deck-lean" aria-label="Lean toward">
                {LEANS.map((l) => (
                  <label
                    key={l.value}
                    className={`bracket-pill${lean === l.value ? ' active' : ''}`}
                  >
                    <input
                      type="radio"
                      name={leanGroup}
                      value={l.value}
                      checked={lean === l.value}
                      onChange={() => setLean(l.value)}
                    />
                    <span className="bracket-pill-label">{l.label}</span>
                    <span className="bracket-pill-sub">{l.hint}</span>
                  </label>
                ))}
              </fieldset>
              {ownedNames.size > 0 && (
                <label className="field-checkbox fill-deck-owned">
                  <input
                    type="checkbox"
                    checked={preferOwned}
                    onChange={(e) => setPreferOwned(e.target.checked)}
                  />
                  <span>Favor cards I own</span>
                </label>
              )}
            </>
          )}

          {phase.kind === 'building' && (
            <div className="fill-deck-progress" aria-live="polite">
              <MeterBar
                value={phase.percent}
                size="md"
                role="progressbar"
                label="Building the rest of the deck"
              />
              <p className="fill-deck-progress-text">{phase.message}</p>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="error-banner" role="alert">
              {phase.message}
            </div>
          )}

          {phase.kind === 'review' && (
            <>
              {phase.result.notes.map((n) => (
                <p key={n} className="fill-deck-note">
                  {n}
                </p>
              ))}
              {additions.length === 0 ? (
                <p className="fill-deck-lead">
                  The builder found nothing to add. Try another lean, or add cards by hand.
                </p>
              ) : (
                groups.map(({ group, cards }) => (
                  <section key={group} className="fill-deck-group" aria-label={PLURAL[group]}>
                    <h3 className="fill-deck-group-title">
                      {PLURAL[group]} <span className="fill-deck-group-count">{cards.length}</span>
                    </h3>
                    <ul className="fill-deck-list" role="list">
                      {cards.map((c, i) => (
                        <li key={`${c.name}-${i}`} className="fill-deck-row">
                          <Thumb name={c.name} />
                          <span className="fill-deck-card">
                            <span className="fill-deck-name">{c.name}</span>
                            {phase.result.reasons[c.name] && (
                              <span className="fill-deck-why">{phase.result.reasons[c.name]}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )}
              {phase.result.plan.stillOpen > 0 && (
                <p className="fill-deck-note">
                  {phase.result.plan.stillOpen === 1
                    ? '1 slot stays open: the card pool ran out.'
                    : `${phase.result.plan.stillOpen} slots stay open: the card pool ran out.`}
                </p>
              )}
            </>
          )}
        </div>

        <div className="card-picker-footer fill-deck-footer">
          {phase.kind === 'setup' && (
            <>
              <button type="button" className="btn" onClick={dismiss}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void run()}>
                Find {open} {open === 1 ? 'card' : 'cards'}
              </button>
            </>
          )}
          {phase.kind === 'building' && (
            <button type="button" className="btn" onClick={dismiss}>
              Cancel
            </button>
          )}
          {phase.kind === 'error' && (
            <>
              <button type="button" className="btn" onClick={dismiss}>
                Close
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void run()}>
                Try again
              </button>
            </>
          )}
          {phase.kind === 'review' && (
            <>
              <button type="button" className="btn" onClick={() => setPhase({ kind: 'setup' })}>
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={additions.length === 0}
                onClick={() => onAdd(additions)}
              >
                <Plus width={14} height={14} aria-hidden /> Add {additions.length}{' '}
                {additions.length === 1 ? 'card' : 'cards'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

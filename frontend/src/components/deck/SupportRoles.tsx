import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { hasCardFacts, loadCardFacts } from '@/deck-builder/services/cardFacts';
import {
  answerCoverageByTarget,
  type AnswerCoverageRow,
  type AnswerTarget,
} from '@/deck-builder/services/deckBuilder/answerCoverage';
import {
  summarizeSupportRoles,
  type SupportRoleSummary,
} from '@/deck-builder/services/deckBuilder/supportRoles';

const TARGET_LABEL: Record<AnswerTarget, string> = {
  creature: 'Creatures',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  planeswalker: 'Planeswalkers',
  graveyard: 'Graveyards',
  stack: 'Spells on the stack',
};

/** "A, B, C and 2 more": a few names, never a wall of them. */
function nameList(names: readonly string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

/** Card facts load on first use; the sections wait for them rather than pop in half-filled. */
function useCardFactsReady(): boolean {
  const [ready, setReady] = useState(hasCardFacts);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void loadCardFacts().then((ok) => {
      if (live && ok) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

function answerSub(row: AnswerCoverageRow): string {
  if (row.count === 0) return 'No answer in the deck.';
  const parts = [`${row.instant} at instant speed`];
  if (row.durable < row.count) parts.push(`${row.durable} exile or destroy`);
  return parts.join(' · ');
}

/**
 * Two sections under the Roles bars: the support roles the deck fills
 * (protection, recursion, graveyard hate, tutors, mana sinks) and its
 * interaction by target type. Each shows only what it has to say: a role with
 * no card is left out, a target the deck's colors cannot answer is left out,
 * and a section with nothing renders nothing. Win conditions have their own
 * panel and are not repeated here.
 */
export function SupportRoles({
  cards,
  colorIdentity,
}: {
  /** The mainboard, commander excluded (the same cards the role counts use). */
  cards: readonly ScryfallCard[];
  colorIdentity: readonly string[];
}) {
  const ready = useCardFactsReady();
  const roles = useMemo<SupportRoleSummary[]>(
    () => (ready ? summarizeSupportRoles(cards).filter((r) => r.role !== 'winCon') : []),
    [cards, ready]
  );
  const answers = useMemo<AnswerCoverageRow[]>(
    () =>
      (answerCoverageByTarget([...cards], [...colorIdentity]) ?? []).filter(
        (r) => r.count > 0 || r.fillable
      ),
    [cards, colorIdentity]
  );

  if (roles.length === 0 && answers.length === 0) return null;
  return (
    <>
      {roles.length > 0 && (
        <section aria-labelledby="deck-support-roles-title" className="deck-roles-section">
          <h5 id="deck-support-roles-title" className="deck-roles-section-title">
            Also in the deck
          </h5>
          <p className="deck-roles-note">A card can fill more than one of these.</p>
          <ul className="list-stack deck-roles">
            {roles.map((r) => (
              <li key={r.role}>
                <div className="deck-roles-row">
                  <span className="deck-roles-name">{r.label}</span>
                  <span className="deck-roles-count">{r.names.length}</span>
                </div>
                <div className="deck-roles-sub">
                  <span>{nameList(r.names)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {answers.length > 0 && (
        <section aria-labelledby="deck-answers-title" className="deck-roles-section">
          <h5 id="deck-answers-title" className="deck-roles-section-title">
            Answers by target
          </h5>
          <ul className="list-stack deck-roles">
            {answers.map((r) => (
              <li key={r.target}>
                <div className="deck-roles-row">
                  <span className="deck-roles-name">{TARGET_LABEL[r.target]}</span>
                  <span className={r.count === 0 ? 'deck-roles-count-short' : 'deck-roles-count'}>
                    {r.count}
                  </span>
                </div>
                <div className="deck-roles-sub">
                  <span>{answerSub(r)}</span>
                </div>
                {r.count > 0 && (
                  <div className="deck-roles-sub">
                    <span>{nameList(r.names)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

import { useId, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { SelectMenu } from '@/components/overlays/SelectMenu';
import { askOdds, tutorsFor } from '@/lib/deck-analysis/ask-odds';
import { isLand } from '@/lib/mana-sim/hand-classify';

interface Props {
  /** Every card in the library: the mainboard, one entry per physical card. */
  library: ScryfallCard[];
  /** Role groups only exist once tagger data has loaded. */
  taggerReady: boolean;
}

const ROLE_GROUPS: Array<{ role: RoleKey; label: string }> = [
  { role: 'ramp', label: 'Ramp' },
  { role: 'removal', label: 'Removal' },
  { role: 'boardwipe', label: 'Board wipes' },
  { role: 'cardDraw', label: 'Card draw' },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const MAX_TURN = 30;

/** A number field that lets the player clear and retype; the answer uses the clamped value. */
function useClampedNumber(initial: number, min: number, max: number) {
  const [raw, setRaw] = useState(String(initial));
  const parsed = Number.parseInt(raw, 10);
  const value = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : initial;
  return {
    raw,
    value,
    setRaw,
    commit: () => setRaw(String(value)),
  };
}

/**
 * "Ask your own": at least N of a role group or one card by turn T, on the play
 * and on the draw, exact and before a mulligan. A single card also gets the
 * odds counting the tutors in the deck that can fetch it.
 */
export function AskYourOwn({ library, taggerReady }: Props) {
  const id = useId();
  const [choice, setChoice] = useState('');
  const howMany = useClampedNumber(1, 1, 99);
  const turn = useClampedNumber(5, 1, MAX_TURN);

  const { groups, cards } = useMemo(() => {
    const groupCards = new Map<string, ScryfallCard[]>();
    const byName = new Map<string, ScryfallCard[]>();
    for (const c of library) {
      if (isLand(c)) {
        groupCards.set('role:land', [...(groupCards.get('role:land') ?? []), c]);
        continue;
      }
      byName.set(c.name, [...(byName.get(c.name) ?? []), c]);
      const role = taggerReady ? getCardRole(c.name) : null;
      if (role) groupCards.set(`role:${role}`, [...(groupCards.get(`role:${role}`) ?? []), c]);
    }
    const groups = [{ key: 'role:land', label: 'Lands' }]
      .concat(ROLE_GROUPS.map((g) => ({ key: `role:${g.role}`, label: g.label })))
      .filter((g) => groupCards.has(g.key))
      .map((g) => ({ ...g, count: groupCards.get(g.key)!.length }));
    return {
      groups,
      cards: [...byName.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, copies]) => ({ key: `card:${name}`, name, count: copies.length })),
    };
  }, [library, taggerReady]);

  const options = useMemo(
    () => [
      ...groups.map((g) => ({
        value: g.key,
        label: `${g.label} · ${g.count} ${g.count === 1 ? 'card' : 'cards'}`,
      })),
      ...cards.map((c) => ({ value: c.key, label: c.name })),
    ],
    [groups, cards]
  );

  // Fall back to the first option until the player picks one, or if their pick
  // left the deck.
  const selected = options.find((o) => o.value === choice)?.value ?? options[0]?.value ?? '';
  const answer = useMemo(() => {
    if (!selected) return null;
    const pool = library.length;
    if (selected.startsWith('card:')) {
      const name = selected.slice(5);
      const copies = library.filter((c) => c.name === name);
      const target = copies[0];
      const base = askOdds(pool, copies.length, howMany.value, turn.value);
      if (howMany.value !== 1 || !target) return { base, tutors: null };
      const tutors = tutorsFor(library, target);
      if (tutors.length === 0) return { base, tutors: null };
      const tutorCopies = library.filter((c) => tutors.some((t) => t.name === c.name)).length;
      return {
        base,
        tutors: {
          names: tutors.map((t) => t.name),
          odds: askOdds(pool, copies.length + tutorCopies, 1, turn.value),
        },
      };
    }
    const role = selected.slice(5);
    const hits = library.filter((c) =>
      role === 'land' ? isLand(c) : !isLand(c) && taggerReady && getCardRole(c.name) === role
    ).length;
    return { base: askOdds(pool, hits, howMany.value, turn.value), tutors: null };
  }, [selected, library, howMany.value, turn.value, taggerReady]);

  if (options.length === 0) return null;

  const tutorNames = answer?.tutors
    ? new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(answer.tutors.names)
    : '';

  return (
    <section className="deck-test-hand-sim" aria-label="Ask your own">
      <div className="deck-test-hand-sim-bar">
        <span className="deck-test-hand-sim-heading">
          Ask your own
          <span className="deck-test-hand-sim-heading-sub">exact odds, before a mulligan</span>
        </span>
      </div>

      <div className="deck-test-hand-ask-line">
        <label htmlFor={`${id}-n`}>At least</label>
        <input
          id={`${id}-n`}
          className="deck-test-hand-ask-num"
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          value={howMany.raw}
          onChange={(e) => howMany.setRaw(e.target.value)}
          onBlur={howMany.commit}
        />
        <SelectMenu
          ariaLabel="Card or group"
          value={selected}
          options={options}
          onChange={setChoice}
          searchable
          searchPlaceholder="Find a card…"
          className="deck-test-hand-ask-pick"
        />
        <label htmlFor={`${id}-t`}>by turn</label>
        <input
          id={`${id}-t`}
          className="deck-test-hand-ask-num"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_TURN}
          value={turn.raw}
          onChange={(e) => turn.setRaw(e.target.value)}
          onBlur={turn.commit}
        />
      </div>

      {answer && (
        <>
          <ul className="deck-test-hand-sim-stats" aria-label="Odds for this question">
            <li className="deck-test-hand-sim-stat">
              <strong>{pct(answer.base.play)}</strong>
              <span className="deck-test-hand-sim-stat-label">On the play</span>
            </li>
            <li className="deck-test-hand-sim-stat">
              <strong>{pct(answer.base.draw)}</strong>
              <span className="deck-test-hand-sim-stat-label">On the draw</span>
            </li>
          </ul>
          {answer.tutors && (
            <p className="deck-test-hand-stat-secondary">
              With {tutorNames}: <strong>{pct(answer.tutors.odds.play)}</strong> on the play ·{' '}
              <strong>{pct(answer.tutors.odds.draw)}</strong> on the draw
            </p>
          )}
          <p className="sr-only" role="status">
            {`At least ${howMany.value} by turn ${turn.value}: ${pct(answer.base.play)} on the play, ${pct(answer.base.draw)} on the draw.`}
            {answer.tutors
              ? ` With ${tutorNames}: ${pct(answer.tutors.odds.play)} on the play, ${pct(answer.tutors.odds.draw)} on the draw.`
              : ''}
          </p>
        </>
      )}
    </section>
  );
}

import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { candidateShortfalls, type CastabilityRow } from '@/lib/deck-analysis/castability';
import { useDecksStore } from '@/store/decks';
import { useProducedMana } from './use-produced-mana';

const NONE: ReadonlyMap<string, CastabilityRow> = new Map();

/**
 * For the Add cards suggestions: which candidates would clearly miss their
 * castability bar in this deck, by name.
 *
 * One goldfish run of the current deck answers every candidate (see
 * `candidateShortfalls`), about 150 ms for a 100-card list. It runs when the
 * browser is idle, so the rows paint first and the segments join them a moment
 * later. Rows with no problem never change. After an edit the last answer stays
 * up until the next one lands (a segment that blinks out on every add is worse
 * than one that is a beat late), but an answer is tagged with its deck and
 * never shown on another.
 */
export function useAddCastability(
  deckId: string,
  names: readonly string[]
): ReadonlyMap<string, CastabilityRow> {
  const deck = useDecksStore((s) => s.decks.find((d) => d.id === deckId));
  const commander = deck?.commander ?? null;
  const partner = deck?.partnerCommander ?? null;
  const mainboard = deck?.cards;

  const stored = useMemo(
    () => [
      ...[commander, partner].filter((c): c is ScryfallCard => !!c),
      ...(mainboard ?? []).map((c) => c.card),
    ],
    [commander, partner, mainboard]
  );
  const commandZone = (commander ? 1 : 0) + (partner ? 1 : 0);
  const mana = useProducedMana(stored);
  const [commanders, library] = useMemo(
    () => [mana.slice(0, commandZone), mana.slice(commandZone)],
    [mana, commandZone]
  );

  const [resolved, setResolved] = useState<{
    key: string;
    cards: ScryfallCard[];
  }>({ key: '', cards: [] });
  const namesKey = names.join('|');
  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const found = await getCardsByNames([...names]);
        if (!cancelled) setResolved({ key: namesKey, cards: [...found.values()] });
      } catch {
        // Offline: the rows keep to their usual line.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  const deckKey = useMemo(
    () => [...commanders, ...library].map((c) => c.name).join('|'),
    [commanders, library]
  );
  const key = `${deckKey}#${resolved.key}`;
  const [answer, setAnswer] = useState<{
    deckId: string;
    rows: ReadonlyMap<string, CastabilityRow>;
  } | null>(null);

  useEffect(() => {
    if (commanders.length === 0 || library.length === 0 || resolved.cards.length === 0) return;
    const run = () =>
      setAnswer({ deckId, rows: candidateShortfalls(commanders, library, resolved.cards) });
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(run, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [deckId, key, commanders, library, resolved.cards]);

  return answer?.deckId === deckId ? answer.rows : NONE;
}

import { useId } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { choosesColorBeforeGame, chosenColorOf } from '@/deck-builder/lib/partnerUtils';
import { ColorPip } from '../shared/ManaSymbol';

const COLORS = [
  { key: 'W', name: 'White' },
  { key: 'U', name: 'Blue' },
  { key: 'B', name: 'Black' },
  { key: 'R', name: 'Red' },
  { key: 'G', name: 'Green' },
] as const;

/** The commander in the command zone that chooses a color, if either does. */
export function colorChooserOf(
  commander: ScryfallCard | null,
  partner: ScryfallCard | null
): ScryfallCard | null {
  if (choosesColorBeforeGame(commander)) return commander;
  if (choosesColorBeforeGame(partner)) return partner;
  return null;
}

/**
 * The before-the-game color choice for The Prismatic Piper, Clara Oswald and
 * Faceless One. Renders nothing for any other commander. Until a color is
 * picked the deck has no colors of its own, so the pages hold Generate back.
 */
export function ChosenColorPicker({
  commander,
  partner,
  onChoose,
}: {
  commander: ScryfallCard | null;
  partner: ScryfallCard | null;
  onChoose: (color: string) => void;
}) {
  const group = useId();
  const chooser = colorChooserOf(commander, partner);
  if (!chooser) return null;
  const chosen = chosenColorOf(chooser);
  const name = chooser.name.split(' // ')[0];

  return (
    <section className="deck-builder-section">
      <h2 className="deck-builder-section-title">{name}&apos;s color</h2>
      <fieldset className="bracket-pill-row color-choice-row" aria-label={`${name}'s color`}>
        {COLORS.map((c) => (
          <label key={c.key} className={`bracket-pill${chosen === c.key ? ' active' : ''}`}>
            <input
              type="radio"
              name={group}
              value={c.key}
              checked={chosen === c.key}
              onChange={() => onChoose(c.key)}
            />
            <ColorPip color={c.key} />
            <span className="bracket-pill-sub">{c.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="format-pill-hint">
        {chosen
          ? `${name} is ${COLORS.find((c) => c.key === chosen)?.name.toLowerCase()}, so the deck can run ${COLORS.find((c) => c.key === chosen)?.name.toLowerCase()} cards.`
          : `${name} becomes the color you choose before the game. Pick one to build the deck in it.`}
      </p>
    </section>
  );
}

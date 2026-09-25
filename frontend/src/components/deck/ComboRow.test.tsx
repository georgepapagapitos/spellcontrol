// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ComboRow, type CardImageIndex } from './ComboRow';
import type { ComboMatch } from '../../types/combos';
import type { ScryfallCard } from '@/deck-builder/types';

// useCardThumb hits the thumbnail CDN resolver; stub it so the row renders the
// placeholder art and the test stays offline.
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const EMPTY_INDEX: CardImageIndex = { byOracle: new Map(), byName: new Map() };

function match(over: Partial<ComboMatch> = {}): ComboMatch {
  return {
    combo: {
      id: 'c1',
      identity: 'ub',
      produces: ['Infinite mana'],
      prerequisites: null,
      description: null,
      manaNeeded: null,
      popularity: 0,
      cardCount: 2,
      bracket: null,
      bracketTag: null,
      cards: [
        { oracleId: 'o1', cardName: "Thassa's Oracle", quantity: 1 },
        { oracleId: 'o2', cardName: 'Demonic Consultation', quantity: 1 },
      ],
    },
    presentOracleIds: ['o1', 'o2'],
    missingOracleIds: [],
    ...over,
  };
}

function renderRow(props: Partial<Parameters<typeof ComboRow>[0]> = {}) {
  const onAddMissing = vi.fn();
  render(
    <ul>
      <ComboRow
        match={match()}
        isOneAway={false}
        edhrec={null}
        cardImageIndex={EMPTY_INDEX}
        ownedOracleIds={new Set(['o1', 'o2'])}
        onAddMissing={onAddMissing}
        onCardTap={vi.fn()}
        {...props}
      />
    </ul>
  );
  return { onAddMissing };
}

describe('ComboRow', () => {
  it('renders a complete combo with no missing-piece footer or add CTA', () => {
    renderRow();

    expect(screen.getByLabelText('Complete')).toBeTruthy();
    expect(screen.getByText("Thassa's Oracle + Demonic Consultation")).toBeTruthy();
    // "Infinite X" renders as an ∞ glyph + the bare noun; the full phrase
    // survives on the chip's title.
    expect(screen.getByTitle('Infinite mana').textContent).toContain('mana');
    expect(screen.queryByText('Missing:')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('names a template requirement instead of calling the combo complete', () => {
    // Spellbook 5534--28: Stella Lee + "an instant or sorcery that untaps a creature".
    const base = match();
    renderRow({
      match: {
        ...base,
        combo: {
          ...base.combo,
          id: '5534--28',
          templates: ['Instant or Sorcery that untaps a Creature'],
        },
      },
    });

    expect(screen.queryByLabelText('Complete')).toBeNull();
    expect(screen.getByLabelText('Also needs a card by type')).toBeTruthy();
    expect(screen.getByText('Also needs:')).toBeTruthy();
    expect(screen.getByText('Instant or Sorcery that untaps a Creature')).toBeTruthy();
  });

  it('shows a template combo as complete and names the deck card that satisfies it', () => {
    // Same variant, but the deck runs Mox Amber — which satisfies "Permanent
    // Castable for {C}" and isn't one of the combo's own named pieces.
    const base = match();
    renderRow({
      match: {
        ...base,
        combo: {
          ...base.combo,
          id: '5534--46',
          templates: ['Permanent Castable for {C}'],
          templateQueries: ['mv<=1 (mana={0} or mana={1} or mana={C}) is:permanent'],
        },
      },
      deckCards: [
        { name: 'Mox Amber', mana_cost: '{0}', cmc: 0, type_line: 'Legendary Artifact' },
      ] as ScryfallCard[],
    });

    expect(screen.getByLabelText('Complete')).toBeTruthy();
    expect(screen.getByText('Completed by:')).toBeTruthy();
    expect(screen.getByText('Mox Amber')).toBeTruthy();
    expect(screen.queryByText('Also needs:')).toBeNull();
  });

  it('renders the missing piece and add CTA when one away', () => {
    const { onAddMissing } = renderRow({
      isOneAway: true,
      match: match({ presentOracleIds: ['o1'], missingOracleIds: ['o2'] }),
    });

    expect(screen.getByLabelText('One card away')).toBeTruthy();
    expect(screen.getByText('Missing:')).toBeTruthy();

    const cta = screen.getByRole('button', {
      name: 'Add Demonic Consultation to complete this combo',
    });
    fireEvent.click(cta);
    expect(onAddMissing).toHaveBeenCalledOnce();
  });

  it('flags a one-away piece the user does not own', () => {
    renderRow({
      isOneAway: true,
      match: match({ presentOracleIds: ['o1'], missingOracleIds: ['o2'] }),
      ownedOracleIds: new Set(['o1']),
    });

    expect(
      screen.getByRole('button', { name: 'Preview Demonic Consultation (not owned)' })
    ).toBeTruthy();
  });

  it('marks an in-deck combo completed only via a sideboard card', () => {
    renderRow({ sideboardCardNames: ['Demonic Consultation'] });
    expect(screen.getByText(/Uses sideboard: Demonic Consultation/)).toBeTruthy();
    expect(screen.getByText(/Not counted toward the bracket/)).toBeTruthy();
  });

  it('shows no sideboard note when every piece is on the mainboard', () => {
    renderRow();
    expect(screen.queryByText(/Uses sideboard/)).toBeNull();
  });
});

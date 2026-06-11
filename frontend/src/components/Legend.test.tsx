// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Legend, type LegendContext } from './Legend';

// DeckBadge/BinderBadge samples render a real Link/useNavigate, so the key
// needs a router in tests (the app always mounts it inside one).
function renderLegend(context: LegendContext) {
  return render(
    <MemoryRouter>
      <Legend context={context} />
    </MemoryRouter>
  );
}

function openKey() {
  fireEvent.click(screen.getByRole('button', { name: 'Show symbol key' }));
  return screen.getByRole('dialog', { name: 'Symbol key' });
}

describe('Legend (context-aware symbol key)', () => {
  it('opens on click and closes on Escape', () => {
    renderLegend('collection');
    expect(screen.queryByRole('dialog')).toBeNull();
    openKey();
    expect(screen.getByRole('dialog', { name: 'Symbol key' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains every supported type glyph with its word, using the real TypeIcon', () => {
    const { container } = renderLegend('collection');
    openKey();
    for (const word of [
      'Creature',
      'Planeswalker',
      'Instant',
      'Sorcery',
      'Enchantment',
      'Artifact',
      'Land',
      'Battle',
      'Other',
    ]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
    // Real mana-font glyphs, not hand-rolled stand-ins.
    expect(container.querySelector('.ms.ms-creature')).toBeTruthy();
    expect(container.querySelector('.ms.ms-planeswalker')).toBeTruthy();
  });

  it('shows one rarity-tinted set-symbol sample per tint, plus the foil pip', () => {
    const { container } = renderLegend('collection');
    openKey();
    expect(screen.getByText('Set symbol — tinted by rarity')).toBeTruthy();
    for (const tint of ['mythic', 'rare', 'uncommon', 'common']) {
      expect(container.querySelector(`.ss.ss-mh2.set-symbol--${tint}`)).toBeTruthy();
    }
    expect(container.querySelector('.foil-badge')).toBeTruthy();
    expect(screen.getByText('Foil printing')).toBeTruthy();
  });

  it('collection: includes deck/binder badges but no binder slots or deck roles', () => {
    const { container } = renderLegend('collection');
    openKey();
    expect(screen.getByText('In a deck')).toBeTruthy();
    expect(screen.getByText('In a binder')).toBeTruthy();
    expect(container.querySelector('.card-list-deck-badge')).toBeTruthy();
    expect(container.querySelector('.card-list-binder-badge')).toBeTruthy();
    expect(screen.queryByText('Empty slot')).toBeNull();
    expect(screen.queryByText('Mana Rock')).toBeNull();
  });

  it('binder: keeps the slot-border color entries on top of the shared sections', () => {
    const { container } = renderLegend('binder');
    openKey();
    expect(screen.getByText('Slot border')).toBeTruthy();
    for (const cls of ['mythic', 'rare', 'uncommon', 'common', 'land', 'empty']) {
      expect(container.querySelector(`.legend-swatch.slot.${cls}`)).toBeTruthy();
    }
    expect(screen.getByText('Empty slot')).toBeTruthy();
    // Shared + ownership sections still present.
    expect(screen.getByText('In a deck')).toBeTruthy();
    expect(screen.getByText('In a binder')).toBeTruthy();
    expect(screen.getAllByText('Mythic').length).toBe(2); // set tint + slot border
  });

  it('deck: shows role-badge samples with full names, synergy, allocation and EDHREC entries', () => {
    const { container } = renderLegend('deck');
    openKey();
    // Real two-letter badges with their canonical full names.
    for (const [abbr, word] of [
      ['RA', 'Ramp'],
      ['MR', 'Mana Rock'],
      ['SR', 'Spot Removal'],
      ['DR', 'Card Draw'],
    ]) {
      expect(screen.getByText(abbr)).toBeTruthy();
      expect(screen.getByText(word)).toBeTruthy();
    }
    expect(container.querySelector('.deck-row-role-badge.deck-row-role-mana-rock')).toBeTruthy();
    expect(screen.getByText('✦')).toBeTruthy();
    expect(screen.getByText('Synergizes with your commander')).toBeTruthy();
    expect(screen.getByText('unowned')).toBeTruthy();
    expect(screen.getByText('% of EDHREC decks with this commander run it')).toBeTruthy();
    // Deck context drops the collection/binder-only sections.
    expect(screen.queryByText('In a binder')).toBeNull();
    expect(screen.queryByText('Empty slot')).toBeNull();
  });

  it('marks the live badge samples inert so they cannot navigate or take focus', () => {
    const { container } = renderLegend('collection');
    openKey();
    const inertSamples = container.querySelectorAll('.legend-glyph[inert]');
    expect(inertSamples.length).toBe(2); // deck badge + binder badge
  });
});

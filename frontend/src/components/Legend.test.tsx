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
    renderLegend('collection');
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
    expect(document.querySelector('.ms.ms-creature')).toBeTruthy();
    expect(document.querySelector('.ms.ms-planeswalker')).toBeTruthy();
  });

  it('shows one rarity-tinted set-symbol sample per tint, plus the foil pip', () => {
    renderLegend('collection');
    openKey();
    expect(screen.getByText('Set symbol — tinted by rarity')).toBeTruthy();
    for (const tint of ['mythic', 'rare', 'uncommon', 'common']) {
      expect(document.querySelector(`.ss.ss-mh2.set-symbol--${tint}`)).toBeTruthy();
    }
    expect(document.querySelector('.foil-badge')).toBeTruthy();
    expect(screen.getByText('Foil printing')).toBeTruthy();
  });

  it('collection: includes deck/binder badges but no binder slots or deck roles', () => {
    renderLegend('collection');
    openKey();
    expect(screen.getByText('In a deck')).toBeTruthy();
    expect(screen.getByText('In a binder')).toBeTruthy();
    expect(document.querySelector('.card-list-deck-badge')).toBeTruthy();
    expect(document.querySelector('.card-list-binder-badge')).toBeTruthy();
    expect(screen.queryByText('Empty slot')).toBeNull();
    expect(screen.queryByText('Mana Rock')).toBeNull();
  });

  it('binder: keeps the slot-border color entries on top of the shared sections', () => {
    renderLegend('binder');
    openKey();
    expect(screen.getByText('Slot border')).toBeTruthy();
    for (const cls of ['mythic', 'rare', 'uncommon', 'common', 'land', 'empty']) {
      expect(document.querySelector(`.legend-swatch.slot.${cls}`)).toBeTruthy();
    }
    expect(screen.getByText('Empty slot')).toBeTruthy();
    // Shared + ownership sections still present.
    expect(screen.getByText('In a deck')).toBeTruthy();
    expect(screen.getByText('In a binder')).toBeTruthy();
    expect(screen.getAllByText('Mythic').length).toBe(2); // set tint + slot border
  });

  it('deck: shows role-badge samples with full names, synergy, allocation and EDHREC entries', () => {
    renderLegend('deck');
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
    expect(document.querySelector('.deck-row-role-badge.deck-row-role-mana-rock')).toBeTruthy();
    // "Your tags" — the real tag-chip sample plus the tags-vs-badges footnote.
    expect(document.querySelector('.deck-row-tag-chip')).toBeTruthy();
    expect(screen.getByText('Wincon')).toBeTruthy();
    expect(
      screen.getByText(/Role badges are detected automatically; tags are yours/)
    ).toBeTruthy();
    expect(screen.getByText('✦')).toBeTruthy();
    expect(screen.getByText('Synergizes with your commander')).toBeTruthy();
    expect(screen.getByText('unowned')).toBeTruthy();
    expect(screen.getByText('% of EDHREC decks with this commander run it')).toBeTruthy();
    // Deck context drops the collection/binder-only sections.
    expect(screen.queryByText('In a binder')).toBeNull();
    expect(screen.queryByText('Empty slot')).toBeNull();
  });

  it('marks the live badge samples inert so they cannot navigate or take focus', () => {
    renderLegend('collection');
    openKey();
    const inertSamples = document.querySelectorAll('.legend-glyph[inert]');
    expect(inertSamples.length).toBe(3); // deck badge + cube badge + binder badge
  });

  // Placement: the popover is PORTALED to <body> and positioned fixed from
  // the trigger rect (InfoTip's pattern) so container/clip hosts — e.g. the
  // deck bento's container-type — can't trap or cut it off (tablet bug).
  it('portals the popover to document.body with fixed inline coordinates', () => {
    renderLegend('deck');
    const pop = openKey();
    expect(pop.parentElement).toBe(document.body);
    // Clamped viewport coordinates arrive as inline styles.
    expect(pop.style.left).not.toBe('');
    expect(pop.style.width).not.toBe('');
    expect(pop.style.maxHeight).not.toBe('');
  });

  it('closes on outside pointerdown but not on pointerdown inside the popover', () => {
    renderLegend('collection');
    const pop = openKey();
    fireEvent.pointerDown(pop.querySelector('.legend-section-title')!);
    expect(screen.getByRole('dialog', { name: 'Symbol key' })).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on outside scroll but survives scrolling its own content', () => {
    renderLegend('collection');
    const pop = openKey();
    fireEvent.scroll(pop);
    expect(screen.getByRole('dialog', { name: 'Symbol key' })).toBeTruthy();
    fireEvent.scroll(window);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

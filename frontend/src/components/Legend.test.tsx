// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
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
    expect(screen.getByText('Set symbol · Tinted by rarity')).toBeTruthy();
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

  it('collection: explains the deviation abbreviations with the real chip — NM is unmarked', () => {
    renderLegend('collection');
    openKey();
    expect(screen.getByText('Condition · Near Mint unmarked')).toBeTruthy();
    for (const [abbr, word] of [
      ['LP', 'Lightly Played'],
      ['MP', 'Moderately Played'],
      ['HP', 'Heavily Played'],
      ['DMG', 'Damaged'],
    ]) {
      expect(screen.getByText(abbr)).toBeTruthy();
      expect(screen.getByText(word)).toBeTruthy();
    }
    // Rows never chip NM, so the Key doesn't list it either.
    expect(screen.queryByText('NM')).toBeNull();
    expect(document.querySelectorAll('.card-list-condition').length).toBe(4);
  });

  it('binder: has the Condition section (binder rows render the same chips)', () => {
    renderLegend('binder');
    openKey();
    expect(screen.getByText('Condition · Near Mint unmarked')).toBeTruthy();
    expect(document.querySelectorAll('.card-list-condition').length).toBe(4);
  });

  it('deck: no Condition section (deck rows are name-aggregated, no per-copy chips)', () => {
    renderLegend('deck');
    openKey();
    expect(screen.queryByText('Condition')).toBeNull();
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
      ['SR', 'Spot removal'],
      ['DR', 'Card draw'],
    ]) {
      expect(screen.getByText(abbr)).toBeTruthy();
      expect(screen.getByText(word)).toBeTruthy();
    }
    expect(document.querySelector('.deck-row-role-badge.deck-row-role-mana-rock')).toBeTruthy();
    // "Your tags" — the real tag-chip sample plus the tags-vs-badges footnote.
    expect(document.querySelector('.deck-row-tag-chip')).toBeTruthy();
    expect(screen.getByText('Wincon')).toBeTruthy();
    expect(screen.getByText(/Role badges are detected automatically; tags are yours/)).toBeTruthy();
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

  // Placement guards: the helper hands back `right` for a right-aligned trigger
  // (and `bottom` for a flipped one); the key must forward whichever coordinate
  // it gets. Dropping `right` once parked the binder Key at the far-left edge of
  // a wide screen, nowhere near its trigger.
  function mountAt(rect: { top: number; bottom: number; left: number; right: number }) {
    window.innerWidth = 2000;
    window.innerHeight = 1000;
    render(
      <MemoryRouter>
        <Legend context="binder" align="right" variant="pill" />
      </MemoryRouter>
    );
    const btn = screen.getByRole('button', { name: 'Show symbol key' });
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    });
    fireEvent.click(btn);
    return screen.getByRole('dialog', { name: 'Symbol key' });
  }

  it('anchors a right-aligned Key to its trigger, not the viewport edge', () => {
    const dialog = mountAt({ top: 300, bottom: 330, left: 1700, right: 1750 });
    expect(dialog.style.right).toBe('250px');
    expect(dialog.style.left).toBe('');
    expect(dialog.style.top).toBe('336px');
    expect(dialog.style.bottom).toBe('');
  });

  it('flips above a trigger near the bottom and caps its height to the room there', () => {
    const dialog = mountAt({ top: 900, bottom: 930, left: 1700, right: 1750 });
    expect(dialog.style.bottom).toBe('106px');
    expect(dialog.style.top).toBe('');
    expect(dialog.style.right).toBe('250px');
    expect(dialog.style.maxHeight).toBe('480px');
  });

  it('follows the trigger through a resize or rotation instead of closing', () => {
    const dialog = mountAt({ top: 300, bottom: 330, left: 1700, right: 1750 });
    const btn = screen.getByRole('button', { name: 'Show symbol key' });
    // Rotated to a 1000-wide viewport: the same pill now sits at its right end.
    window.innerWidth = 1000;
    vi.mocked(btn.getBoundingClientRect).mockReturnValue({
      top: 300,
      bottom: 330,
      left: 700,
      right: 750,
      width: 50,
      height: 30,
      x: 700,
      y: 300,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event('resize'));
    expect(screen.getByRole('dialog', { name: 'Symbol key' })).toBe(dialog);
    expect(dialog.style.right).toBe('250px');
  });
});

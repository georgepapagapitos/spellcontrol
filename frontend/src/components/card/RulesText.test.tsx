// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RulesTextParagraphs } from './RulesText';
import { useRulesReferenceStore } from '@/store/rules-reference';
import { KEYWORD_GLOSSARY_URL } from '@/lib/cards/keyword-glossary';

// Shaped like the generated glossary file, which tests never read.
const GLOSSARY = {
  meta: { effective: 'April 17, 2026' },
  keywords: [
    {
      name: 'Split Second',
      rule: '702.61',
      kind: 'ability',
      text: '“Split second” means “As long as this spell is on the stack, players can’t cast other spells or activate abilities that aren’t mana abilities.”',
    },
    {
      name: 'Scry',
      rule: '701.22',
      kind: 'action',
      text: 'To “scry N” means to look at the top N cards of your library.',
    },
  ],
};

// Samut, Tyrant of Naktamun, as Scryfall prints it.
const SAMUT =
  "Instant and sorcery spells you control have split second. (As long as a spell with split second is on the stack, players can't cast spells or activate abilities that aren't mana abilities.)";

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url) === KEYWORD_GLOSSARY_URL
        ? new Response(JSON.stringify(GLOSSARY))
        : new Response(null, { status: 404 })
    )
  );
  useRulesReferenceStore.setState({ isOpen: false, target: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderSamut(wrap?: (node: React.ReactNode) => React.ReactNode) {
  const node = <RulesTextParagraphs text={SAMUT} names={['Samut, Tyrant of Naktamun']} />;
  render(<>{wrap ? wrap(node) : node}</>);
  return screen.findByRole('button', { name: 'split second' });
}

describe('RulesTextParagraphs', () => {
  it('links the keyword where it sits in the sentence and keeps the reminder text as text', async () => {
    const term = await renderSamut();
    expect(term.getAttribute('aria-haspopup')).toBe('dialog');
    expect(term.getAttribute('aria-expanded')).toBe('false');
    expect(term.closest('p')?.textContent).toBe(SAMUT);
    // One link: the reminder's own "split second" is the explanation already.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(document.querySelector('.rules-text-reminder')?.textContent).toMatch(/^\(As long as/);
  });

  it('opens what the rule says, and moves focus into it', async () => {
    const term = await renderSamut();
    fireEvent.click(term);
    const pop = await screen.findByRole('dialog', { name: 'Split Second' });
    expect(term.getAttribute('aria-expanded')).toBe('true');
    expect(term.getAttribute('aria-controls')).toBe(pop.id);
    expect(pop.textContent).toContain('Keyword ability · 702.61');
    expect(pop.textContent).toContain('players can’t cast other spells');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Read the full rule' }));
  });

  it('closes on Escape and hands focus back to the keyword', async () => {
    const term = await renderSamut();
    fireEvent.click(term);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(term);
  });

  it('closes on a tap anywhere else, and on a second tap of the keyword', async () => {
    const term = await renderSamut((n) => (
      <>
        {n}
        <p>elsewhere</p>
      </>
    ));
    fireEvent.click(term);
    await screen.findByRole('dialog');
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(term);
    await screen.findByRole('dialog');
    fireEvent.pointerDown(term);
    fireEvent.click(term);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the rules reference on that keyword, expanded, and closes itself', async () => {
    const term = await renderSamut();
    fireEvent.click(term);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Read the full rule' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useRulesReferenceStore.getState()).toMatchObject({
      isOpen: true,
      target: { tab: 'keywords', query: 'Split Second', expand: 'Split Second' },
    });
    // Focus sits on the keyword, so the sheet hands it back there on close.
    expect(document.activeElement).toBe(term);
  });

  it('keeps a touch or click in the popover away from what hosts the text', async () => {
    // The card preview listens for swipes and empty-space clicks on its sheet;
    // React bubbles the portaled popover's events up to it all the same.
    const onTouchStart = vi.fn();
    const onClick = vi.fn();
    const term = await renderSamut((n) => (
      <div role="presentation" onTouchStart={onTouchStart} onClick={onClick}>
        {n}
      </div>
    ));
    fireEvent.click(term);
    onClick.mockClear();
    const pop = await screen.findByRole('dialog');
    fireEvent.touchStart(pop);
    fireEvent.click(pop);
    expect(onTouchStart).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders plain text until the glossary arrives, and stays plain if it never does', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    );
    const fresh = await import('./RulesText');
    render(<fresh.RulesTextParagraphs text="Scry 2." />);
    await act(async () => {});
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText('Scry 2.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

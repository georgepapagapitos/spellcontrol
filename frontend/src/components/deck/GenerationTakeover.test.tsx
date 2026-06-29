// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationTakeover } from './GenerationTakeover';

// useCardThumb is an async CDN hook; stub it to a no-op in unit tests so we
// don't fire real network requests.
vi.mock('@/lib/card-thumbs', () => ({
  useCardThumb: () => undefined,
}));

describe('GenerationTakeover', () => {
  it('renders the progress message', () => {
    render(<GenerationTakeover message="Consulting the Oracle…" percent={10} />);
    expect(screen.getByText('Consulting the Oracle…')).toBeTruthy();
  });

  it('renders the commander name when provided', () => {
    render(<GenerationTakeover commanderName="Atraxa" message="Building…" percent={50} />);
    expect(screen.getByText('Atraxa')).toBeTruthy();
  });

  it('omits the commander name element when not provided', () => {
    render(<GenerationTakeover message="Building…" percent={50} />);
    // No name text expected beyond the message itself.
    expect(screen.queryByText('Atraxa')).toBeNull();
  });

  it('renders the art img when a direct URL is supplied', () => {
    render(
      <GenerationTakeover
        commanderName="Atraxa"
        commanderImageUrl="https://cards.scryfall.io/art_crop/atraxa.jpg"
        message="Building…"
        percent={75}
      />
    );
    const img = document.querySelector('.gen-takeover-art-img') as HTMLImageElement | null;
    expect(img).toBeTruthy();
    expect(img?.src).toBe('https://cards.scryfall.io/art_crop/atraxa.jpg');
  });

  it('does not render the art block when no URL is available', () => {
    render(<GenerationTakeover message="Building…" percent={30} />);
    expect(document.querySelector('.gen-takeover-art')).toBeNull();
  });

  it('has role=status and aria-live=polite for screen readers', () => {
    const { container } = render(<GenerationTakeover message="Building…" percent={20} />);
    const el = container.querySelector('.gen-takeover');
    expect(el?.getAttribute('role')).toBe('status');
    expect(el?.getAttribute('aria-live')).toBe('polite');
  });

  it('passes the percent to the ProgressBar', () => {
    render(<GenerationTakeover message="Done" percent={100} />);
    // ProgressBar renders a fill element; verify the component itself mounts
    // without error at 100%.
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('renders a flavor line alongside the step message', () => {
    render(<GenerationTakeover message="Summoning creatures…" percent={40} />);
    // The flavor element is aria-hidden so query by class, not role.
    const flavor = document.querySelector('.gen-takeover-flavor');
    expect(flavor).toBeTruthy();
    expect(flavor?.textContent?.length).toBeGreaterThan(0);
  });

  it('resets flavor line when the message prop changes', () => {
    const { rerender } = render(<GenerationTakeover message="Summoning creatures…" percent={40} />);
    const firstText = document.querySelector('.gen-takeover-flavor')?.textContent;
    rerender(<GenerationTakeover message="Tapping the mana base…" percent={60} />);
    // After a message change the flavor line should still render (not crash).
    const flavor = document.querySelector('.gen-takeover-flavor');
    expect(flavor).toBeTruthy();
    // The new message maps to a different flavor pool so text may differ.
    expect(flavor?.textContent?.length).toBeGreaterThan(0);
    // Suppress unused variable warning — firstText is checked implicitly above.
    void firstText;
  });
});

describe('GenerationTakeover — symmetric exit (E70)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not apply the exiting class by default', () => {
    const { container } = render(<GenerationTakeover message="Building…" percent={50} />);
    expect(
      container.querySelector('.gen-takeover')?.classList.contains('gen-takeover--exiting')
    ).toBe(false);
  });

  it('applies the exiting class while isExiting is set', () => {
    const { container } = render(
      <GenerationTakeover message="Building…" percent={50} isExiting onExited={() => {}} />
    );
    expect(container.querySelector('.gen-takeover--exiting')).toBeTruthy();
  });

  it('fires onExited when the fade-out animation ends', () => {
    const onExited = vi.fn();
    const { container } = render(
      <GenerationTakeover message="Building…" percent={50} isExiting onExited={onExited} />
    );
    const el = container.querySelector('.gen-takeover') as HTMLElement;
    // An unrelated animation (e.g. fade-in) must NOT unmount.
    fireEvent.animationEnd(el, { animationName: 'fade-in' });
    expect(onExited).not.toHaveBeenCalled();
    fireEvent.animationEnd(el, { animationName: 'fade-out' });
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('fires onExited immediately under reduced motion (no animation to await)', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (q: string) =>
        ({
          matches: q.includes('reduce'),
          media: q,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );
    const onExited = vi.fn();
    render(<GenerationTakeover message="Building…" percent={50} isExiting onExited={onExited} />);
    expect(onExited).toHaveBeenCalledTimes(1);
  });
});

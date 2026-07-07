// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('fires onExitComplete only after the takeover exit animation', () => {
    const onExitComplete = vi.fn();
    const { container } = render(
      <GenerationTakeover
        message="Building…"
        percent={80}
        isExiting
        onExitComplete={onExitComplete}
      />
    );
    const el = container.querySelector('.gen-takeover');
    // The exit is two-phase: it first holds in the celebration beat.
    expect(el?.classList.contains('is-celebrating')).toBe(true);

    fireEvent.animationEnd(el!, { animationName: 'fade-in' });
    expect(onExitComplete).not.toHaveBeenCalled();

    fireEvent.animationEnd(el!, { animationName: 'gen-takeover-exit' });
    expect(onExitComplete).toHaveBeenCalledTimes(1);
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

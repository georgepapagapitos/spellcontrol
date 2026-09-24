// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeCard } from './HomeCard';
import { readHomeShape } from '../../lib/home-shape';

type Props = Partial<Parameters<typeof HomeCard>[0]>;

function renderCard(props: Props) {
  return render(
    <MemoryRouter>
      <HomeCard title="Price movers" loading={false} {...props}>
        <p>content</p>
      </HomeCard>
    </MemoryRouter>
  );
}

// Written from an effect that can land after a test's last await — cleared
// at the START of each test (same discipline as TrendingRail.test.tsx).
beforeEach(() => localStorage.removeItem('sc-home-shape'));

describe('HomeCard', () => {
  it('renders the title, meta, door and content once resolved', () => {
    renderCard({ meta: 'today', viewAllHref: '/collection', viewAllLabel: 'View trend' });
    expect(screen.getByRole('region', { name: 'Price movers' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Price movers' })).toBeTruthy();
    expect(screen.getByText('today')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View trend' }).getAttribute('href')).toBe(
      '/collection'
    );
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('hides the door while loading', () => {
    renderCard({ loading: true, viewAllHref: '/collection' });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });

  it('shows the error with a Retry that calls back', () => {
    const onRetry = vi.fn();
    renderCard({ error: "Couldn't load.", onRetry });
    expect(screen.getByRole('alert').textContent).toContain("Couldn't load.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading Price movers' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  // STYLE_GUIDE § Home: an empty card renders nothing. The old collapsed
  // 44px row still took a grid cell and left a hole beside its tall
  // neighbour; four of them made a quarter of the page say "nothing here".
  it('renders nothing at all when empty', () => {
    const { container } = renderCard({ empty: true, viewAllHref: '/x' });
    expect(container.innerHTML).toBe('');
  });
});

/**
 * E277 guard: a card's loading skeleton takes the footprint it resolved to
 * last time, so a returning visitor's page resolves in place. Measured
 * 2026-09-09: without this, /home reflowed to CLS 0.43 desktop / 0.21 phone.
 */
describe('HomeCard remembered footprint', () => {
  it('a first visit skeletons as the full shell and reserves nothing', () => {
    const { container } = renderCard({ loading: true });
    expect(container.querySelector('.home-card-skeleton')).toBeTruthy();
    expect((container.querySelector('.home-card') as HTMLElement).style.minHeight).toBe('');
  });

  it('remembers an empty resolve and stays absent while loading next time', () => {
    const { unmount } = renderCard({ empty: true });
    expect(readHomeShape()['Price movers']).toBe(0);
    unmount();

    const { container } = renderCard({ loading: true });
    expect(container.innerHTML).toBe('');
  });

  it('reserves the last content height while loading', () => {
    localStorage.setItem('sc-home-shape', JSON.stringify({ 'Price movers': 320 }));
    const { container } = renderCard({ loading: true });
    expect((container.querySelector('.home-card') as HTMLElement).style.minHeight).toBe('320px');
    expect(container.querySelector('.home-card-skeleton')).toBeTruthy();
  });

  it('a resolved content card drops the reservation and records its footprint', () => {
    localStorage.setItem('sc-home-shape', JSON.stringify({ 'Price movers': 320 }));
    const { container } = renderCard({ loading: false });
    expect((container.querySelector('.home-card') as HTMLElement).style.minHeight).toBe('');
    expect(screen.getByText('content')).toBeTruthy();
    expect(readHomeShape()['Price movers']).toBeGreaterThan(0);
  });

  it('a remembered empty card that resolves with content renders the full shell', () => {
    localStorage.setItem('sc-home-shape', JSON.stringify({ 'Price movers': 0 }));
    renderCard({ loading: false, empty: false });
    expect(screen.getByText('content')).toBeTruthy();
  });

  it('an error never writes the shape', () => {
    renderCard({ error: 'boom' });
    expect(readHomeShape()['Price movers']).toBeUndefined();
  });
});

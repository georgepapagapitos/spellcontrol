// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommanderPopularityStat } from './CommanderPopularityStat';

describe('CommanderPopularityStat', () => {
  it('renders nothing while loading, regardless of the numbers', () => {
    const { container } = render(
      <CommanderPopularityStat edhrecNumDecks={12000} ownCount={156} loading variant="card" />
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing when both EDHREC and platform data are absent (never "0 decks")', () => {
    const { container } = render(
      <CommanderPopularityStat edhrecNumDecks={0} ownCount={null} loading={false} variant="card" />
    );
    expect(container.textContent).toBe('');
  });

  it('renders EDHREC-only text when ownCount is null (below threshold)', () => {
    render(
      <CommanderPopularityStat
        edhrecNumDecks={12400}
        ownCount={null}
        loading={false}
        variant="card"
      />
    );
    expect(screen.getByText('12,400 decks on EDHREC')).toBeTruthy();
  });

  it('renders the blended text once ownCount clears the threshold', () => {
    const { container } = render(
      <CommanderPopularityStat
        edhrecNumDecks={12400}
        ownCount={156}
        loading={false}
        variant="card"
      />
    );
    expect(container.textContent).toContain('156 on SpellControl');
    expect(container.textContent).toContain('12,400 on EDHREC');
  });

  it('mounts an InfoTip trigger only on variant="card"', () => {
    render(
      <CommanderPopularityStat
        edhrecNumDecks={12400}
        ownCount={156}
        loading={false}
        variant="card"
      />
    );
    expect(screen.getByRole('button', { name: /platform decks/i })).toBeTruthy();
  });

  it('omits the InfoTip trigger on variant="inline"', () => {
    render(
      <CommanderPopularityStat
        edhrecNumDecks={12400}
        ownCount={156}
        loading={false}
        variant="inline"
      />
    );
    expect(screen.queryByRole('button', { name: /platform decks/i })).toBeNull();
    expect(screen.getByText(/156 on SpellControl/)).toBeTruthy();
  });
});

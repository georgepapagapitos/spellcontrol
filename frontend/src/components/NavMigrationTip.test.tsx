// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as firstRun from '../lib/first-run';
import { NavMigrationTip } from './NavMigrationTip';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('NavMigrationTip', () => {
  it('renders the migration copy for a returning user who has not seen it', () => {
    vi.spyOn(firstRun, 'hasEverVisited').mockReturnValue(true);
    render(<NavMigrationTip />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(
      'Settings and Friends now live under You. Rules moved into Play.'
    );
  });

  it('renders nothing for a brand-new signup (hasEverVisited false at mount)', () => {
    vi.spyOn(firstRun, 'hasEverVisited').mockReturnValue(false);
    const { container } = render(<NavMigrationTip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when already dismissed on a prior visit', () => {
    vi.spyOn(firstRun, 'hasEverVisited').mockReturnValue(true);
    localStorage.setItem('sc-seen-nav-v2-tip', '1');
    const { container } = render(<NavMigrationTip />);
    expect(container.firstChild).toBeNull();
  });

  it('dismiss hides it immediately, persists the flag, and stays hidden across a re-render', () => {
    vi.spyOn(firstRun, 'hasEverVisited').mockReturnValue(true);
    const { rerender, container } = render(<NavMigrationTip />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(container.firstChild).toBeNull();
    expect(localStorage.getItem('sc-seen-nav-v2-tip')).toBe('1');

    rerender(<NavMigrationTip />);
    expect(container.firstChild).toBeNull();
  });
});

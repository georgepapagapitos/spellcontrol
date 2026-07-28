// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WedgeHintStrip } from './WedgeHintStrip';

describe('WedgeHintStrip', () => {
  it('renders the headline, detail, and an aria-live status role', () => {
    render(
      <WedgeHintStrip
        icon={<span />}
        headline="Cards show where they live"
        detail="The badge next to an owned card links straight to its binder."
        onDismiss={vi.fn()}
      />
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Cards show where they live')).toBeTruthy();
    expect(
      screen.getByText('The badge next to an owned card links straight to its binder.')
    ).toBeTruthy();
  });

  it('omits the action button when actionLabel/onAction are absent', () => {
    render(<WedgeHintStrip icon={<span />} headline="H" detail="D" onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /resync/i })).toBeNull();
    // Still has exactly one interactive control: the dismiss button.
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders the action button and fires onAction on click', () => {
    const onAction = vi.fn();
    render(
      <WedgeHintStrip
        icon={<span />}
        headline="H"
        detail="D"
        actionLabel="Resync"
        onAction={onAction}
        onDismiss={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resync' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<WedgeHintStrip icon={<span />} headline="H" detail="D" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss hint' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss on Escape without requiring focus on the strip', () => {
    const onDismiss = vi.fn();
    render(<WedgeHintStrip icon={<span />} headline="H" detail="D" onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

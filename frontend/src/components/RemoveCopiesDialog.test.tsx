// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// Modal brings createPortal + a focus trap; the defaults under test live
// entirely in this component, so render children passthrough.
vi.mock('./Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { RemoveCopiesDialog } from './RemoveCopiesDialog';

describe('RemoveCopiesDialog safe defaults', () => {
  // The dialog only appears for a stacked row, i.e. precisely when the user
  // might want to remove *some* copies. Defaulting the qty to `total` and
  // autofocusing the danger button put "delete every copy of this printing"
  // one Enter press away, with the destructive amount pre-selected.
  it('defaults to removing a single copy, not the whole stack', () => {
    render(
      <RemoveCopiesDialog cardName="Sol Ring" total={4} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect((screen.getByLabelText('Copies to remove') as HTMLInputElement).value).toBe('1');
    expect(screen.queryByRole('button', { name: 'Remove 1' })).not.toBeNull();
    // The "this removes everything" warning belongs to the qty=total case only.
    expect(screen.queryByText(/removes every copy/i)).toBeNull();
  });

  it('focuses Cancel rather than the danger button', () => {
    render(
      <RemoveCopiesDialog cardName="Sol Ring" total={4} onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('still lets the user raise the count up to the full stack', () => {
    const onConfirm = vi.fn();
    render(
      <RemoveCopiesDialog cardName="Sol Ring" total={3} onConfirm={onConfirm} onCancel={() => {}} />
    );
    const increase = screen.getByRole('button', { name: 'Increase' });
    fireEvent.click(increase);
    fireEvent.click(increase);
    expect(screen.queryByText(/removes every copy/i)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove 3' }));
    expect(onConfirm).toHaveBeenCalledWith(3);
  });

  // Regression for the clamp-on-every-keystroke bug: clearing the field to
  // type a new number used to snap straight back to the minimum because
  // Number('') is 0 and Number.isFinite(0) is true. The clamp should only
  // apply at commit (blur), not on every change.
  it('lets the field go blank while editing, then clamps to the minimum on blur', () => {
    render(
      <RemoveCopiesDialog cardName="Sol Ring" total={4} onConfirm={() => {}} onCancel={() => {}} />
    );
    const input = screen.getByLabelText('Copies to remove') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.blur(input);
    expect(input.value).toBe('1');
  });
});

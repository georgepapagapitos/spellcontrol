// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisibilityChoice } from './VisibilityChoice';

describe('VisibilityChoice', () => {
  it('is a native radio group, one option per value, with its hint always visible', () => {
    const onChange = vi.fn();
    render(
      <VisibilityChoice
        ariaLabel="Who can see it"
        value="private"
        options={[
          { value: 'public', label: 'Public', hint: 'Anyone can find it.' },
          { value: 'friends', label: 'Friends', hint: 'Only friends can find it.' },
          { value: 'private', label: 'Private', hint: 'Only you can see it.' },
        ]}
        onChange={onChange}
      />
    );
    expect(screen.getByText('Anyone can find it.')).toBeTruthy();
    expect(screen.getByText('Only friends can find it.')).toBeTruthy();
    expect(screen.getByText('Only you can see it.')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /^Public/ }));
    expect(onChange).toHaveBeenCalledWith('public');
  });

  it('shows "Saving…" on the busy option and marks the group busy + disabled', () => {
    const { container } = render(
      <VisibilityChoice
        value="private"
        busyValue="public"
        disabled
        options={[
          { value: 'public', label: 'Public', hint: 'x' },
          { value: 'private', label: 'Private', hint: 'y' },
        ]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText('Saving…')).toBeTruthy();
    const outer = container.querySelector('fieldset[aria-busy="true"]') as HTMLFieldSetElement;
    expect(outer).toBeTruthy();
    expect(outer.disabled).toBe(true);
  });
});

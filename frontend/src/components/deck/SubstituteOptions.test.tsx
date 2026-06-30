// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SubstituteOptions } from './SubstituteOptions';
import type { Change } from '@/lib/deck-change';

// Stub the thumbnail network leaf so the nested DeckCardRows don't reach out
// (avoids the post-teardown fetch flake).
vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const alt = (name: string): Change => ({
  id: `collection:Cultivate:${name}`,
  type: 'add',
  lane: 'collection',
  name,
  ownership: 'owned',
  reason: `${name} owned`,
});

describe('SubstituteOptions', () => {
  it('renders nothing with no alternatives', () => {
    const { container } = render(
      <SubstituteOptions
        alternatives={[]}
        onPreview={vi.fn()}
        onAct={vi.fn()}
        acting={() => false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default and toggles the ranked alternatives', () => {
    const onAct = vi.fn();
    render(
      <SubstituteOptions
        alternatives={[alt('Fellwar Stone'), alt('Coldsteel Heart')]}
        onPreview={vi.fn()}
        onAct={onAct}
        acting={() => false}
      />
    );
    const toggle = screen.getByRole('button', { name: '2 other owned options' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Fellwar Stone')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Fellwar Stone')).toBeTruthy();
    expect(screen.getByText('Coldsteel Heart')).toBeTruthy();

    // The Add action on an alternative routes through onAct with that Change.
    fireEvent.click(screen.getByRole('button', { name: 'Add Fellwar Stone' }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(onAct.mock.calls[0][0].name).toBe('Fellwar Stone');
  });

  it('singularizes the toggle label for one alternative', () => {
    render(
      <SubstituteOptions
        alternatives={[alt('Fellwar Stone')]}
        onPreview={vi.fn()}
        onAct={vi.fn()}
        acting={() => false}
      />
    );
    expect(screen.getByRole('button', { name: '1 other owned option' })).toBeTruthy();
  });
});

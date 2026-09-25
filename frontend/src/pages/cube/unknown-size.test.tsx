// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CubeSizePicker } from './shared';
import type { CubeSize } from '../../lib/cube/targets';

/**
 * E353: a saved cube's `size` is persisted and synced, so a row can carry a
 * number this build doesn't offer. The size picker read `SIZE_INFO[size].note`
 * blind, which threw on the undefined entry and took the whole /decks/cube
 * page down through the ErrorBoundary — and cube deletion lives only on that
 * page, so there was no in-app way out of it.
 */
describe('the cube workshop survives a size it does not offer', () => {
  it('renders the size picker for an out-of-range saved size', () => {
    render(
      <CubeSizePicker
        size={12 as CubeSize}
        onSize={() => {}}
        format="limited"
        onFormat={() => {}}
      />
    );
    // The note reads the size's fallback info, and the picker's own trigger
    // states the unfamiliar value instead of going blank.
    expect(screen.getAllByText('12 cards').length).toBeGreaterThan(0);
    // The six sizes we do offer still read from the table, once opened.
    const trigger = screen.getByRole('button', { name: /Cube size/ });
    fireEvent.click(trigger);
    expect(screen.getAllByText(/8 players/).length).toBeGreaterThan(0);
  });

  it('still renders a known size the normal way', () => {
    render(<CubeSizePicker size={360} onSize={() => {}} format="limited" onFormat={() => {}} />);
    expect(screen.getByText(/An 8-player draft sees the whole cube/)).toBeTruthy();
  });
});

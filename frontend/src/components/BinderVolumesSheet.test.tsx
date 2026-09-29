// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinderVolumesSheet } from './BinderVolumesSheet';
import type { Volume } from '../types';

vi.mock('@/lib/overlays/use-lock-body-scroll', () => ({ useLockBodyScroll: () => {} }));

const VOLUMES: Volume[] = [
  { index: 1, pageStart: 1, pageEnd: 21, cardCount: 188, firstLabel: 'White', lastLabel: 'White' },
  { index: 2, pageStart: 22, pageEnd: 44, cardCount: 204, firstLabel: 'Blue', lastLabel: 'Blue' },
  {
    index: 3,
    pageStart: 45,
    pageEnd: 63,
    cardCount: 176,
    firstLabel: 'Black',
    lastLabel: 'Red',
  },
];

function renderSheet(overrides: Partial<Parameters<typeof BinderVolumesSheet>[0]> = {}) {
  const onApplyFit = vi.fn();
  const onOpenRules = vi.fn();
  const onClose = vi.fn();
  render(
    <BinderVolumesSheet
      binderName="Everything"
      volumes={VOLUMES}
      fixedCapacity={360}
      pocketSize={9}
      totalPages={63}
      onApplyFit={onApplyFit}
      onOpenRules={onOpenRules}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onApplyFit, onOpenRules, onClose };
}

describe('BinderVolumesSheet', () => {
  it('names the binder and how many books it fills', () => {
    renderSheet();
    expect(screen.getByText('Everything fills 3 binders of 360 cards.')).toBeTruthy();
  });

  it('lists every volume with its page range, spine and count', () => {
    renderSheet();
    expect(screen.getByText('pp. 1–21')).toBeTruthy();
    expect(screen.getByText('White')).toBeTruthy();
    // A volume whose books span two different sections joins them with an arrow.
    expect(screen.getByText('Black → Red')).toBeTruthy();
  });

  it('offers the smallest PAGE-fitting size, not a card-count match', () => {
    // 63 pages at 9 pockets needs a size whose own page depth (floor(size/9))
    // is >= 63: 360 (40 pages) and 480 (53 pages) both fall short; 640 (71
    // pages) is the first that actually fits.
    renderSheet({ totalPages: 63 });
    expect(screen.getByRole('button', { name: 'Use a 640-card binder' })).toBeTruthy();
  });

  it('never offers a size whose page depth falls short, even if cards would fit', () => {
    // 45 pages worth of binder — more pages than a 360 (40-page) binder
    // holds, even though the card totals here (568) look "under 640".
    renderSheet({ totalPages: 45 });
    expect(screen.queryByRole('button', { name: 'Use a 360-card binder' })).toBeFalsy();
    expect(screen.getByRole('button', { name: 'Use a 480-card binder' })).toBeTruthy();
  });

  it('says a split is the only fit when nothing in the catalogue holds every page', () => {
    renderSheet({ totalPages: 5000 });
    expect(
      screen.getByText('No standard size holds it in one book, so it stays in 3 volumes.')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Use a .*-card binder/ })).toBeFalsy();
  });

  it('calls onApplyFit with the fitting size', () => {
    const { onApplyFit } = renderSheet({ totalPages: 30 });
    fireEvent.click(screen.getByRole('button', { name: 'Use a 360-card binder' }));
    expect(onApplyFit).toHaveBeenCalledWith(360);
  });

  it('opens Binder rules', () => {
    const { onOpenRules } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Binder rules' }));
    expect(onOpenRules).toHaveBeenCalledTimes(1);
  });

  it('closes via its own close button', () => {
    const { onClose } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

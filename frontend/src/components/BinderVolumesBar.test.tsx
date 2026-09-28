// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BinderVolumesBar } from './BinderVolumesBar';
import type { Volume } from '../types';

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

describe('BinderVolumesBar', () => {
  it('summarizes the volume count and capacity while collapsed', () => {
    render(
      <BinderVolumesBar
        volumes={VOLUMES}
        fixedCapacity={360}
        pocketSize={9}
        totalCards={568}
        onOpenRules={() => {}}
      />
    );
    expect(screen.getByText('Fills 3 binders of 360')).toBeTruthy();
    // Volume rows are hidden until the disclosure opens.
    expect(screen.queryByText('pp. 1–21')).toBeFalsy();
  });

  it('lists every volume with its page range and spine once opened', () => {
    render(
      <BinderVolumesBar
        volumes={VOLUMES}
        fixedCapacity={360}
        pocketSize={9}
        totalCards={568}
        onOpenRules={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /volumes/i }));
    expect(screen.getByText('pp. 1–21')).toBeTruthy();
    expect(screen.getByText('White')).toBeTruthy();
    // A volume whose books span two different sections joins them with an arrow.
    expect(screen.getByText('Black → Red')).toBeTruthy();
  });

  it('names the smallest standard size that would hold everything', () => {
    render(
      <BinderVolumesBar
        volumes={VOLUMES}
        fixedCapacity={360}
        pocketSize={9}
        totalCards={568}
        onOpenRules={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /volumes/i }));
    expect(screen.getByText(/A single 639-card binder would hold everything/)).toBeTruthy();
  });

  it('opens Binder rules from the fit hint', () => {
    const onOpenRules = vi.fn();
    render(
      <BinderVolumesBar
        volumes={VOLUMES}
        fixedCapacity={360}
        pocketSize={9}
        totalCards={568}
        onOpenRules={onOpenRules}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /volumes/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Binder rules' }));
    expect(onOpenRules).toHaveBeenCalledTimes(1);
  });

  it('says a split is the only fit when nothing in the catalogue holds everything', () => {
    render(
      <BinderVolumesBar
        volumes={VOLUMES}
        fixedCapacity={360}
        pocketSize={9}
        totalCards={10000}
        onOpenRules={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /volumes/i }));
    expect(screen.getByText(/No standard binder size holds everything/)).toBeTruthy();
  });
});

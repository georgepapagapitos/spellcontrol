// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CollectionExportDialog } from './CollectionExportDialog';
import type { EnrichedCard } from '../types';

const downloadText = vi.fn();
vi.mock('../lib/collection-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/collection-export')>()),
  downloadText: (...args: unknown[]) => downloadText(...args),
}));

function card(overrides: Partial<EnrichedCard> = {}): EnrichedCard {
  return {
    copyId: 'c',
    name: 'Sol Ring',
    setCode: 'CMR',
    setName: 'Commander Legends',
    collectorNumber: '1',
    rarity: 'uncommon',
    scryfallId: 'sf-a',
    purchasePrice: 4,
    sourceCategory: '',
    sourceFormat: 'manabox',
    finish: 'nonfoil',
    foil: false,
    ...overrides,
  };
}

describe('CollectionExportDialog', () => {
  beforeEach(() => {
    downloadText.mockClear();
    window.localStorage.clear();
  });

  it('counts every copy as its own row and downloads the SpellControl CSV by default', () => {
    const onClose = vi.fn();
    render(
      <CollectionExportDialog
        cards={[card({ copyId: 'a' }), card({ copyId: 'b' })]}
        onClose={onClose}
      />
    );
    expect(screen.getByText('2 cards · 2 rows')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    expect(downloadText).toHaveBeenCalledTimes(1);
    const [text, fileName] = downloadText.mock.calls[0] as [string, string];
    expect(fileName).toMatch(/^spellcontrol-collection-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(text.split('\n')).toHaveLength(3);
    expect(onClose).toHaveBeenCalled();
  });

  it('remembers the chosen format and names a binder file after the binder', () => {
    window.localStorage.setItem('sc-collection-export-format', 'moxfield');
    render(<CollectionExportDialog cards={[card()]} binderName="Staples" onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Export binder: Staples' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Download/ }));
    const [text, fileName] = downloadText.mock.calls[0] as [string, string];
    expect(fileName).toMatch(/^spellcontrol-binder-staples-moxfield-/);
    expect(text.startsWith('Count,Tradelist Count,Name,Edition')).toBe(true);
  });
});

// @vitest-environment happy-dom
/**
 * The Decks page's "Add a product" dialog hosts the same {@link
 * ProductSearchPanel} as the Add-cards sheet's Products tab, but deck-first
 * (T153) — covers the wiring only; the panel's own behavior per context is
 * covered by ProductSearchPanel.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

interface SeenProps {
  onClose: () => void;
  context?: 'collection' | 'deck';
}
const propsSeen: SeenProps[] = [];
vi.mock('./ProductSearchPanel', () => ({
  ProductSearchPanel: (props: SeenProps) => {
    propsSeen.push(props);
    return <div data-testid="product-search-panel" />;
  },
}));

import { ProductSearchDialog } from './ProductSearchDialog';

describe('ProductSearchDialog', () => {
  it('hosts ProductSearchPanel deck-first', () => {
    propsSeen.length = 0;
    render(<ProductSearchDialog onClose={vi.fn()} />);

    expect(screen.getByTestId('product-search-panel')).toBeTruthy();
    expect(propsSeen).toHaveLength(1);
    expect(propsSeen[0].context).toBe('deck');
  });
});

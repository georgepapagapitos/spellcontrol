// @vitest-environment happy-dom
/** The old idea page's address opens the generator with the idea applied (E1113). */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DeckIdeaRedirect } from './DeckIdeaRedirect';

function Generator() {
  const loc = useLocation();
  return <p data-testid="at">{loc.pathname + loc.search}</p>;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/decks/new/generate/idea/:slug" element={<DeckIdeaRedirect />} />
        <Route path="/decks/new/generate" element={<Generator />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('DeckIdeaRedirect', () => {
  it('forwards the slug and the format', () => {
    renderAt('/decks/new/generate/idea/angels?format=commander');
    expect(screen.getByTestId('at').textContent).toBe(
      '/decks/new/generate?idea=angels&format=commander'
    );
  });

  it('forwards a slug with no format', () => {
    renderAt('/decks/new/generate/idea/plus-1-plus-1-counters');
    expect(screen.getByTestId('at').textContent).toBe(
      '/decks/new/generate?idea=plus-1-plus-1-counters'
    );
  });
});

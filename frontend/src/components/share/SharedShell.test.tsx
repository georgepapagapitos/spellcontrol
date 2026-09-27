// @vitest-environment happy-dom
/**
 * E344: the dead-end states of the public surfaces used to keep the tab title
 * the server shell arrives with — the homepage card. A stranger following a
 * revoked link got a page headed "Deck not found" in a tab that said
 * "SpellControl — Organize MTG binders, build decks & track games", and that is
 * what a bookmark of it kept. The titles live in these two shared views so every
 * caller gets one, so they are tested here.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorView, NotFoundView } from './SharedShell';

const SHELL_TITLE = 'SpellControl — Organize MTG binders, build decks & track games';

beforeEach(() => {
  document.title = SHELL_TITLE;
});
afterEach(() => {
  document.title = SHELL_TITLE;
});

const renderIn = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

describe('public dead-end states name themselves in the tab', () => {
  it('titles the default share dead end', () => {
    renderIn(<NotFoundView />);
    expect(document.title).toBe('Link not found · SpellControl');
  });

  it('titles a caller-supplied dead end', () => {
    renderIn(<NotFoundView title="Deck not found" message="This deck isn't public anymore." />);
    expect(document.title).toBe('Deck not found · SpellControl');
  });

  it('titles the error state', () => {
    renderIn(<ErrorView message="The network dropped." onRetry={() => {}} />);
    expect(document.title).toBe('Something went wrong · SpellControl');
  });

  it('puts the shell title back when the dead end unmounts', () => {
    const { unmount } = renderIn(<NotFoundView title="Profile not found" />);
    expect(document.title).toBe('Profile not found · SpellControl');
    unmount();
    expect(document.title).toBe(SHELL_TITLE);
  });
});

describe('the public error state offers a way to ask again', () => {
  it('Retry calls back, and the way out stays', () => {
    const onRetry = vi.fn();
    renderIn(<ErrorView message="The network dropped." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Go to SpellControl' })).toBeTruthy();
  });
});

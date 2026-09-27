// @vitest-environment happy-dom
/**
 * The app shell sets a hub title ("Decks") and a page may set its own (the
 * deck's name). React runs the page's effect before the shell's, so when both
 * change in one commit (arriving at a deck from Home with its chunk already
 * loaded) a "restore what was there" hook let the shell's hub title win and
 * the tab said "Decks" over a deck.
 */
import { act, render } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { useDocumentTitle } from './use-document-title';

const HUB: Record<string, string> = { home: 'Home', decks: 'Decks' };
function Shell() {
  const { pathname } = useLocation();
  useDocumentTitle(HUB[pathname.split('/')[1] ?? ''], { hub: true });
  return <Outlet />;
}

function Deck() {
  useDocumentTitle('Krenko');
  return <p>deck</p>;
}

function renderApp(path: string) {
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          { path: '/home', element: <p>home</p> },
          { path: '/decks', element: <p>decks</p> },
          { path: '/decks/:id', element: <Deck /> },
        ],
      },
    ],
    { initialEntries: [path] }
  );
  const view = render(<RouterProvider router={router} />);
  const go = (to: string) => act(() => void router.navigate(to));
  return { ...view, go };
}

beforeEach(() => {
  document.title = 'SpellControl';
});

it('a page title beats the hub title when both arrive in one navigation', () => {
  const { unmount, go } = renderApp('/home');
  expect(document.title).toBe('Home · SpellControl');
  go('/decks/a');
  expect(document.title).toBe('Krenko · SpellControl');
  go('/home');
  expect(document.title).toBe('Home · SpellControl');
  unmount();
  expect(document.title).toBe('SpellControl');
});

it('leaving a page within its hub falls back to the hub title', () => {
  const { unmount, go } = renderApp('/decks/a');
  expect(document.title).toBe('Krenko · SpellControl');
  go('/decks');
  expect(document.title).toBe('Decks · SpellControl');
  unmount();
});

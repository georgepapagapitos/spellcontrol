// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Download, Plus, Share2, Trash2, Play } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageHeader, type PageHeaderAction } from './PageHeader';

function setPhone(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query.includes('max-width: 600px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const onAdd = vi.fn();
const onExport = vi.fn();
const onDelete = vi.fn();
const ACTIONS: PageHeaderAction[] = [
  { label: 'Add cards', icon: Plus, primary: true, onClick: onAdd },
  { label: 'Export', icon: Download, onClick: onExport },
  { label: 'Share', icon: Share2, onClick: () => {} },
  { label: 'Goldfish a list', icon: Play, to: '/goldfish' },
  { label: 'Delete', icon: Trash2, danger: true, menuOnly: true, onClick: onDelete },
];

function renderHeader(actions = ACTIONS) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<PageHeader title="Collection" meta="50 cards" actions={actions} />}
        />
        <Route path="/goldfish" element={<p>goldfish page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

const header = () => screen.getByRole('banner');
const inlineLabels = () =>
  within(header())
    .queryAllByRole('button')
    .map((b) => b.textContent || b.getAttribute('aria-label'));
function menuLabels() {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  return screen.getAllByRole('menuitem').map((m) => m.textContent);
}

afterEach(() => vi.unstubAllGlobals());

describe('PageHeader action rule', () => {
  it('wider than a phone: primary + first secondary inline, the rest in ⋮', () => {
    setPhone(false);
    renderHeader();
    expect(inlineLabels()).toEqual(['Export', 'Add cards', 'More actions']);
    expect(menuLabels()).toEqual(['Share', 'Goldfish a list', 'Delete']);
  });

  it('on a phone: only the primary inline, every other action in ⋮', () => {
    setPhone(true);
    renderHeader();
    expect(inlineLabels()).toEqual(['Add cards', 'More actions']);
    expect(menuLabels()).toEqual(['Export', 'Share', 'Goldfish a list', 'Delete']);
  });

  it('renders no ⋮ when every action is already visible', () => {
    setPhone(false);
    renderHeader(ACTIONS.slice(0, 2));
    expect(inlineLabels()).toEqual(['Export', 'Add cards']);
  });

  it('a menu item with `to` navigates, one with onClick calls it', () => {
    setPhone(true);
    renderHeader();
    menuLabels();
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(onDelete).toHaveBeenCalledOnce();
    menuLabels();
    fireEvent.click(screen.getByRole('menuitem', { name: /Goldfish a list/ }));
    expect(screen.getByText('goldfish page')).toBeTruthy();
  });

  it('renders the title as the page h1 with its meta line', () => {
    setPhone(false);
    renderHeader([]);
    expect(screen.getByRole('heading', { level: 1, name: 'Collection' })).toBeTruthy();
    expect(screen.getByText('50 cards')).toBeTruthy();
  });
});

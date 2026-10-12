// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SORT_DEFAULT_DIR, GROUP_BY_STORAGE_KEY, VIEW_MODE_STORAGE_KEY } from './deck-display-rows';
import { useDeckViewPrefs } from './use-deck-view-prefs';

beforeEach(() => localStorage.clear());

describe('useDeckViewPrefs', () => {
  it('the active sort flips direction; a new sort takes its own default direction', () => {
    const { result } = renderHook(() => useDeckViewPrefs());
    expect(result.current.sort).toBe('name');
    act(() => result.current.onToggleSort('name'));
    expect(result.current.sortDir).toBe('desc');
    act(() => result.current.onToggleSort('cmc'));
    expect(result.current.sort).toBe('cmc');
    expect(result.current.sortDir).toBe(SORT_DEFAULT_DIR.cmc);
  });

  it('persists the view mode and the grouping lens', () => {
    const { result } = renderHook(() => useDeckViewPrefs());
    act(() => result.current.handleViewModeChange('grid'));
    act(() => result.current.handleGroupByChange('category'));
    expect(localStorage.getItem(VIEW_MODE_STORAGE_KEY)).toBe('grid');
    expect(localStorage.getItem(GROUP_BY_STORAGE_KEY)).toBe('category');
    expect(renderHook(() => useDeckViewPrefs()).result.current.viewMode).toBe('grid');
  });

  it('folds the same section title independently per lens, and outzone piles under every lens', () => {
    const { result } = renderHook(() => useDeckViewPrefs());
    act(() => result.current.toggleSection('Creatures'));
    expect(result.current.isSectionCollapsed('Creatures')).toBe(true);
    expect([...result.current.collapsedTitlesForLens]).toEqual(['Creatures']);
    act(() => result.current.handleGroupByChange('category'));
    expect(result.current.isSectionCollapsed('Creatures')).toBe(false);
    act(() => result.current.toggleOutzoneSection('Sideboard'));
    expect(result.current.collapsedOutzoneTitles.has('Sideboard')).toBe(true);
    act(() => result.current.handleGroupByChange('type'));
    expect(result.current.collapsedOutzoneTitles.has('Sideboard')).toBe(true);
  });
});

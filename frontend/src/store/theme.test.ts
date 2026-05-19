// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, bootstrapTheme } from './theme';
import { DEFAULT_THEME } from '../lib/themes';

const VALID = 'boros';
const INVALID = 'not-a-real-theme';
const KEY = 'spellcontrol-theme';

function dataTheme() {
  return document.documentElement.getAttribute('data-theme');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  useThemeStore.setState({ theme: DEFAULT_THEME });
});

describe('useThemeStore.setTheme', () => {
  it('defaults to DEFAULT_THEME', () => {
    expect(useThemeStore.getState().theme).toBe(DEFAULT_THEME);
  });

  it('applies a valid theme to state and the document', () => {
    useThemeStore.getState().setTheme(VALID);
    expect(useThemeStore.getState().theme).toBe(VALID);
    expect(dataTheme()).toBe(VALID);
  });

  it('ignores an invalid theme', () => {
    useThemeStore.getState().setTheme(VALID);
    useThemeStore.getState().setTheme(INVALID);
    expect(useThemeStore.getState().theme).toBe(VALID);
    expect(dataTheme()).toBe(VALID);
  });
});

describe('bootstrapTheme', () => {
  it('uses DEFAULT_THEME when nothing is persisted', () => {
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);
  });

  it('applies a valid persisted theme', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(VALID);
  });

  it('falls back to DEFAULT_THEME for an invalid persisted theme', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: INVALID }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);
  });

  it('falls back to DEFAULT_THEME on malformed JSON', () => {
    localStorage.setItem(KEY, '{ not json');
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);
  });
});

describe('onRehydrateStorage', () => {
  it('applies the persisted theme on rehydrate', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(dataTheme()).toBe(VALID);
  });

  it('applies DEFAULT_THEME when the rehydrated theme is invalid', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: INVALID }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(dataTheme()).toBe(DEFAULT_THEME);
  });
});

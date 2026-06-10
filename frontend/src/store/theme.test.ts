// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore, bootstrapTheme } from './theme';
import { DEFAULT_THEME, DEFAULT_DARK_THEME } from '../lib/themes';

const VALID = 'boros';
const VALID_DARK = 'rakdos';
const INVALID = 'not-a-real-theme';
const KEY = 'spellcontrol-theme';

function dataTheme() {
  return document.documentElement.getAttribute('data-theme');
}

function dataScheme() {
  return document.documentElement.getAttribute('data-scheme');
}

/** Stub matchMedia so tests control what the OS color scheme reports. */
function mockPrefersColorScheme(prefersDark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query === '(prefers-color-scheme: dark)' && prefersDark,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  // Reset the store BEFORE clearing storage — persist writes to localStorage
  // on every set, so the reverse order would leave a "stored" theme behind
  // and silently break the first-run (nothing persisted) tests.
  useThemeStore.setState({ theme: DEFAULT_THEME });
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-scheme');
  mockPrefersColorScheme(false);
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

  it('sets data-scheme="light" for a light theme', () => {
    useThemeStore.getState().setTheme(VALID);
    expect(dataScheme()).toBe('light');
  });

  it('sets data-scheme="dark" for a dark theme', () => {
    useThemeStore.getState().setTheme(VALID_DARK);
    expect(dataScheme()).toBe('dark');
  });
});

describe('bootstrapTheme', () => {
  it('uses DEFAULT_THEME when nothing is persisted and the OS is light', () => {
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);
    expect(dataScheme()).toBe('light');
  });

  it('uses DEFAULT_DARK_THEME when nothing is persisted and the OS prefers dark', () => {
    mockPrefersColorScheme(true);
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_DARK_THEME);
    expect(dataScheme()).toBe('dark');
  });

  it('a stored theme wins over the OS color scheme', () => {
    mockPrefersColorScheme(true);
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(VALID);
    expect(dataScheme()).toBe('light');
  });

  it('applies a valid persisted theme', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(VALID);
  });

  it('applies data-scheme for a persisted dark theme', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID_DARK }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(VALID_DARK);
    expect(dataScheme()).toBe('dark');
  });

  it('falls back to the OS-derived default for an invalid persisted theme', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: INVALID }, version: 0 }));
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);

    mockPrefersColorScheme(true);
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_DARK_THEME);
  });

  it('falls back to the OS-derived default on malformed JSON', () => {
    localStorage.setItem(KEY, '{ not json');
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);

    mockPrefersColorScheme(true);
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_DARK_THEME);
  });

  it('still resolves a default when matchMedia is unavailable', () => {
    // @ts-expect-error simulate an environment without matchMedia
    window.matchMedia = undefined;
    bootstrapTheme();
    expect(dataTheme()).toBe(DEFAULT_THEME);
    expect(dataScheme()).toBe('light');
  });
});

describe('onRehydrateStorage', () => {
  it('applies the persisted theme on rehydrate', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(dataTheme()).toBe(VALID);
    expect(dataScheme()).toBe('light');
  });

  it('applies a persisted dark theme with data-scheme="dark"', async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: VALID_DARK }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(dataTheme()).toBe(VALID_DARK);
    expect(dataScheme()).toBe('dark');
  });

  it('applies the OS-derived default when the rehydrated theme is invalid', async () => {
    mockPrefersColorScheme(true);
    localStorage.setItem(KEY, JSON.stringify({ state: { theme: INVALID }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(dataTheme()).toBe(DEFAULT_DARK_THEME);
    expect(dataScheme()).toBe('dark');
  });
});

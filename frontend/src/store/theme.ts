import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_DARK_THEME, DEFAULT_THEME, isValidTheme, themeScheme } from '../lib/themes';

interface ThemeState {
  theme: string;
  setTheme: (id: string) => void;
}

/** Set both theme attributes on <html>: the theme id and its light/dark scheme. */
function applyTheme(id: string): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', id);
  root.setAttribute('data-scheme', themeScheme(id));
}

/**
 * First-run default: follow the OS color scheme. Read synchronously (no
 * listener) — once the user picks a theme it persists and always wins;
 * we never live-switch on later OS changes.
 */
function resolveDefaultTheme(): string {
  try {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return DEFAULT_DARK_THEME;
    }
  } catch {
    // fall through to the light default
  }
  return DEFAULT_THEME;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      // Must match what bootstrapTheme() resolved pre-paint: with nothing
      // persisted, onRehydrateStorage re-applies this initial value, so an
      // azorius constant here would clobber a dark-OS dimir bootstrap.
      theme: resolveDefaultTheme(),
      setTheme: (id) => {
        if (!isValidTheme(id)) return;
        applyTheme(id);
        set({ theme: id });
      },
    }),
    {
      name: 'spellcontrol-theme',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        const id = state && isValidTheme(state.theme) ? state.theme : resolveDefaultTheme();
        applyTheme(id);
      },
    }
  )
);

/**
 * Apply the persisted theme attribute as early as possible to avoid a flash
 * of the default theme before the store rehydrates. Call from main.tsx
 * before React renders. With no stored theme (first run) the default
 * follows the OS color scheme via a synchronous matchMedia check, still
 * pre-paint.
 */
export function bootstrapTheme(): void {
  try {
    const raw = localStorage.getItem('spellcontrol-theme');
    if (!raw) {
      applyTheme(resolveDefaultTheme());
      return;
    }
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    const id = parsed?.state?.theme;
    applyTheme(id && isValidTheme(id) ? id : resolveDefaultTheme());
  } catch {
    applyTheme(resolveDefaultTheme());
  }
}

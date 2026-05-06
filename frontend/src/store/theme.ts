import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { DEFAULT_THEME, isValidTheme } from '../lib/themes';

interface ThemeState {
  theme: string;
  setTheme: (id: string) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      setTheme: (id) => {
        if (!isValidTheme(id)) return;
        document.documentElement.setAttribute('data-theme', id);
        set({ theme: id });
      },
    }),
    {
      name: 'mtg-binder-theme',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        const id = state && isValidTheme(state.theme) ? state.theme : DEFAULT_THEME;
        document.documentElement.setAttribute('data-theme', id);
      },
    }
  )
);

/**
 * Apply the persisted theme attribute as early as possible to avoid a flash
 * of the default theme before the store rehydrates. Call from main.tsx
 * before React renders.
 */
export function bootstrapTheme(): void {
  try {
    const raw = localStorage.getItem('mtg-binder-theme');
    if (!raw) {
      document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
      return;
    }
    const parsed = JSON.parse(raw) as { state?: { theme?: string } };
    const id = parsed?.state?.theme;
    document.documentElement.setAttribute(
      'data-theme',
      id && isValidTheme(id) ? id : DEFAULT_THEME
    );
  } catch {
    document.documentElement.setAttribute('data-theme', DEFAULT_THEME);
  }
}

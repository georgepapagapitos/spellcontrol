import { createContext, useContext } from 'react';

// The app shell is a fixed-height, non-scrolling flex column; .app-main is
// the single scroll container. This exposes that element so descendants
// (notably the virtualized card table) can scope scroll behavior to it
// instead of the window. Value is null until <main> mounts.
export const ScrollContainerContext = createContext<HTMLElement | null>(null);

export function useScrollContainer(): HTMLElement | null {
  return useContext(ScrollContainerContext);
}

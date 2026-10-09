/// <reference types="vite/client" />

// Build identifier injected via Vite's `define` (see vite.config.ts). Used
// by lib/util/register-pwa.ts to detect a new native bundle without thrashing
// the offline cache on every boot.
declare const __BUILD_ID__: string;

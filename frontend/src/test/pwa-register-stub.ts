/**
 * Stub for vite-plugin-pwa's `virtual:pwa-register` module under Vitest.
 *
 * The PWA plugin doesn't run in the test config, so the virtual module
 * doesn't exist and Vite's import-analysis errors on the (dynamic) import
 * in `lib/register-pwa.ts`. `vitest.config.ts` aliases the specifier here.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}

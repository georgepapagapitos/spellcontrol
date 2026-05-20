// Absolute base URL for backend API calls. Empty in the browser build (paths
// stay relative; the Vite proxy in dev / the same-origin deploy in prod
// handle them). Non-empty for native builds (Capacitor), where the WebView's
// origin is not the backend.
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export function apiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  return path.startsWith('/') ? API_BASE_URL + path : `${API_BASE_URL}/${path}`;
}

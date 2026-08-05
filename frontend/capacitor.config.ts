import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.spellcontrol.app',
  appName: 'SpellControl',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  plugins: {
    // Route window.fetch through the native HTTP layer so requests escape
    // the WebView's CORS / mixed-content restrictions. The bundled app then
    // talks to the backend exactly like a normal HTTP client would, with
    // cookies handled natively.
    CapacitorHttp: {
      enabled: true,
    },
    Keyboard: {
      // iOS-only: resize the WebView (not just the body) so dvh-based layouts
      // settle naturally above the keyboard. Android ignores `resize`.
      resize: 'native',
      // Android-only: the StatusBar plugin runs the app in overlay/full-screen
      // mode, which normally suppresses the system keyboard-resize callback.
      // This flag re-enables it so focused inputs aren't covered.
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      // Brand night-ink background matches the icon background and the
      // theme-color meta in index.html.
      //
      // The splash is dismissed by `hideSplashWhenReady()` (lib/platform.ts) on
      // the first painted frame, so this duration is NOT the normal exit path —
      // it's the backstop for a boot that throws before that call is reached.
      // Keep it comfortably longer than a cold start: the old 600ms fired on a
      // fixed timer, often before React had hydrated + painted, leaving a gap
      // between the splash and the first real frame.
      launchShowDuration: 3000,
      launchAutoHide: true,
      backgroundColor: '#111830',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
  android: {
    // Android's WebView ships pinch-to-zoom OFF (Capacitor defaults
    // `zoomEnabled` to false), so on device the browser zoom every other
    // platform gives you for free simply does not exist. The card preview
    // has no zoom control of its own — reading a card's fine print IS the
    // native gesture — so turn it on. Capacitor already calls
    // `setDisplayZoomControls(false)`, so this adds the gesture without the
    // legacy on-screen ± widget.
    zoomEnabled: true,
    // Transparent WebView background so the camera-preview plugin's native
    // preview (rendered behind the WebView via toBack:true) can show
    // through when the scanner is active. The HTML body still paints its
    // own opaque background everywhere except the scanner overlay, so the
    // rest of the app is unaffected.
    backgroundColor: '#00000000',
  },
};

export default config;

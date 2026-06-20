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
      // Brand charcoal background matches the icon background and the
      // theme-color meta in index.html. Auto-hide quickly: the React boot is
      // fast enough that a longer splash just feels sluggish.
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#1f1b18',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
  android: {
    // Transparent WebView background so the camera-preview plugin's native
    // preview (rendered behind the WebView via toBack:true) can show
    // through when the scanner is active. The HTML body still paints its
    // own opaque background everywhere except the scanner overlay, so the
    // rest of the app is unaffected.
    backgroundColor: '#00000000',
  },
};

export default config;

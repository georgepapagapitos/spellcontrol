// Touch-capable device (phone/tablet browser, or touchscreen laptop).
// Used to enable touch-only affordances (e.g. pull-to-refresh). Harmless
// if a touchscreen-laptop user is on a mouse — the gesture just never fires.
export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0;
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRegisterShortcuts } from '@/components/app-shell/shortcut-registry';
import { FIXED_SHORTCUTS } from '../../lib/board-support';
import {
  SHORTCUTS,
  formatChord,
  loadOverrides,
  resolveBindings,
  saveOverrides,
  type ShortcutId,
  type ShortcutOverrides,
} from '../../lib/shortcuts';
import { applyTableSkin, readFelt } from '../../lib/table-skin';
import { readSnap, readTurnAlert } from '../../lib/table-prefs';

/**
 * This device's table preferences: rebindable keys, the felt skin (E347),
 * grid snapping, the turn alert, and the browser's fullscreen state. All
 * per-device, like card size — none of it leaves the device.
 */
export function useBoardPrefs() {
  // Rebindable keys, persisted per device (lib/shortcuts). Every place that
  // prints a key — the corner buttons, the table menu, the sheet — reads the
  // same table, so a rebound key never lies on screen.
  const [shortcutOverrides, setShortcutOverrides] = useState<ShortcutOverrides>(() =>
    loadOverrides()
  );
  const bindings = useMemo(() => resolveBindings(shortcutOverrides), [shortcutOverrides]);
  const keyFor = (id: ShortcutId) => (bindings[id] ? formatChord(bindings[id]) : undefined);
  const changeShortcuts = useCallback((next: ShortcutOverrides) => {
    setShortcutOverrides(next);
    saveOverrides(next);
  }, []);
  // The app-wide `?` overlay, where one is mounted, reads the live bindings so
  // a rebound key is what it prints.
  const registeredShortcuts = useMemo(
    () => [
      ...SHORTCUTS.filter((d) => bindings[d.id]).map((d) => ({
        keys: [formatChord(bindings[d.id])],
        description: d.label,
      })),
      ...FIXED_SHORTCUTS,
    ],
    [bindings]
  );
  useRegisterShortcuts('Playtest', registeredShortcuts);
  // Fullscreen is the browser's state, not ours; mirror it for the menu label.
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && document.fullscreenElement !== null
  );
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  // How this device's table looks (E347): a per-device preference, like card
  // size — it never leaves the device and nothing about it is published.
  const [felt, setFelt] = useState(readFelt);
  useEffect(() => applyTableSkin(felt), [felt]);
  const [snap, setSnap] = useState(readSnap);
  const [turnAlert, setTurnAlert] = useState(readTurnAlert);

  return {
    shortcutOverrides,
    bindings,
    keyFor,
    changeShortcuts,
    isFullscreen,
    felt,
    setFelt,
    snap,
    setSnap,
    turnAlert,
    setTurnAlert,
  };
}

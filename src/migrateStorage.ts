// Before the rename the UI kept its preferences under other keys (LEGACY.storagePrefix): they move to "mtwin.*" once,
// before anything reads them (main.tsx imports this first). A key already under the new name wins.
import { LEGACY } from "./legacy";

try {
  const old: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(LEGACY.storagePrefix)) old.push(k);
  }
  for (const k of old) {
    const to = `mtwin.${k.slice(LEGACY.storagePrefix.length)}`;
    const v = localStorage.getItem(k);
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v);
    localStorage.removeItem(k);
  }
} catch {
  // No storage (a private window, blocked site data): nothing to move.
}

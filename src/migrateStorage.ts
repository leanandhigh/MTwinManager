// Before the rename the UI kept its preferences under "roalt.*" keys: they move to "mtwin.*" once,
// before anything reads them (main.tsx imports this first). A key already under the new name wins.
try {
  const old: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith("roalt.")) old.push(k);
  }
  for (const k of old) {
    const to = `mtwin.${k.slice("roalt.".length)}`;
    const v = localStorage.getItem(k);
    if (v !== null && localStorage.getItem(to) === null) localStorage.setItem(to, v);
    localStorage.removeItem(k);
  }
} catch {
  // No storage (a private window, blocked site data): nothing to move.
}

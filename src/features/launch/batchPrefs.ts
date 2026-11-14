import { useSyncExternalStore } from "react";
import type { SameServer } from "../../api";
import { readStored, writeStored } from "../../ui/stored";

// How a launch of several accounts picks servers (Settings > Launching > Play page launches), kept on
// this PC and shared by Play and Settings.
const KEY = "mtwin.sameServer";
const VALID: readonly SameServer[] = ["off", "pickFirst", "followFirst", "ownPrivate", "randomPublic", "closest", "mostFull", "mostEmpty"];
let value: SameServer = VALID.find((v) => v === readStored(KEY)) ?? "off";
const subs = new Set<() => void>();

export function setSameServer(next: SameServer) {
  value = next;
  writeStored(KEY, next);
  subs.forEach((f) => f());
}

export function useSameServer(): [SameServer, (v: SameServer) => void] {
  const v = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => value,
  );
  return [v, setSameServer];
}

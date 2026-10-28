// A sentence the Inbox list shows after the open conversation went away from this person (#376: a Sales/Support transfer, after
// which they may no longer read it). Kept in memory for the tab, read by the list with useSyncExternalStore; never stored.
import { useSyncExternalStore } from 'react';

let current: string | null = null;
const listeners = new Set<() => void>();

export function setNotice(text: string | null) {
  current = text;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

export const useNotice = () =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );

// The client a renderer reads: from the argument, else from the provider.
// React only, with nothing that needs a DOM, so the plan and card hooks
// work under any renderer (React Native included).
import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { ClientSnapshot, WaypointClient } from "../core/client";
import type { Message } from "../protocol/generated";

/** The provider's client; set by `WaypointProvider` (internal). */
export const ClientContext = createContext<WaypointClient | null>(null);

/** The client from the argument or the provider (internal). */
export function clientOf(client?: WaypointClient): WaypointClient {
  const inherited = useContext(ClientContext);
  const store = client ?? inherited;
  if (!store) throw new Error("A client is required");
  return store;
}

export function useWaypointSnapshot(client?: WaypointClient): ClientSnapshot {
  const store = clientOf(client);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
}

/**
 * Part of the client's snapshot: the component renders again only when the
 * selected value changes, by `isEqual` (`Object.is` unless given), not on
 * every change to the snapshot, such as each delta of a reply.
 */
export function useWaypointSelector<T>(
  selector: (snapshot: ClientSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  client?: WaypointClient,
): T {
  const store = clientOf(client);
  const kept = useRef<{
    snapshot: ClientSnapshot;
    selector: (snapshot: ClientSnapshot) => T;
    value: T;
  }>(undefined);
  const select = () => {
    const snapshot = store.getSnapshot();
    const was = kept.current;
    if (was && was.snapshot === snapshot && was.selector === selector)
      return was.value;
    const value = selector(snapshot);
    // An equal value keeps its identity, so nothing renders for it.
    if (was && isEqual(was.value, value)) {
      kept.current = { snapshot, selector, value: was.value };
      return was.value;
    }
    kept.current = { snapshot, selector, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, select, select);
}

// Each list of messages indexed by id once, however many components look
// a message up in it.
const indexes = new WeakMap<readonly Message[], Map<string, Message>>();
function messageIn(messages: readonly Message[], id: string) {
  let index = indexes.get(messages);
  if (!index) {
    index = new Map(messages.map((message) => [message.id, message]));
    indexes.set(messages, index);
  }
  return index.get(id);
}

/**
 * One message of the conversation shown: the component renders again only
 * when that message changes (a delta into it, a new status), so a list can
 * give each row its own subscription.
 */
export function useWaypointMessage(
  messageId: string,
  client?: WaypointClient,
): Message | undefined {
  return useWaypointSelector(
    (snapshot) =>
      snapshot.conversation
        ? messageIn(snapshot.conversation.messages, messageId)
        : undefined,
    Object.is,
    client,
  );
}

/** Whether two objects hold the same values, key by key (internal). */
export function shallowEqual<T extends object>(a: T, b: T): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

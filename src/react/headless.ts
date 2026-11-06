// The client a renderer reads: from the argument, else from the provider.
// React only, with nothing that needs a DOM, so the plan and card hooks
// work under any renderer (React Native included).
import { createContext, useContext, useSyncExternalStore } from "react";
import type { ClientSnapshot, WaypointClient } from "../core/client";

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

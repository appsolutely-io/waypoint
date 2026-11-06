// Test runtime setup: Web Locks where the runtime has none (Node 22 and
// jsdom), as the browsers the library targets have them. Tests of the
// no-locks path remove `navigator.locks` themselves.
import { webLocks } from "./web-locks";

const host = globalThis as { navigator?: { locks?: unknown } };
if (host.navigator && !host.navigator.locks)
  Object.defineProperty(host.navigator, "locks", {
    value: webLocks(),
    configurable: true,
    writable: true,
  });

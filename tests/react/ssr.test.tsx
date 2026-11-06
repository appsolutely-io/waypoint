import { it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import {
  createScriptedTransport,
  createTestPlatform,
} from "../../src/testing/transport";
it("renders the real fixture client shell without touching browser globals", async () => {
  const fixture = createScriptedTransport();
  const client = createWaypointClient({
    accountId: "fixture-account",
    conversationId: "fixture-conversation",
    platform: createTestPlatform(),
    transport: fixture.transport,
  });
  await client.ready;
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  try {
    for (const name of ["window", "document", "navigator"]) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error(`DOM access: ${name}`);
        },
      });
    }
    const html = renderToString(<WaypointChat client={client} />);
    for (const part of ["rail", "transcript", "composer"])
      expect(html).toContain(`data-part="${part}"`);
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    client.dispose();
  }
});

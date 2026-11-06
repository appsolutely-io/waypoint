import { it, expect, vi } from "vitest";
const loading = vi.hoisted(() => ({ count: 0 }));
vi.mock("js-yaml", async (original) => {
  loading.count++;
  return await original();
});
import { parseFlow, createWaypointClient } from "../../src/index";
import { config } from "../support/client";
import type { Flow } from "../../src/protocol/generated";
it("core import and parsed FlowSource documents do not load YAML; parseFlow does", async () => {
  expect(loading.count).toBe(0);
  const document: Flow = {
    format: "1.0",
    id: "fixture/rename",
    title: "Rename",
    kind: "structured",
    parameters: [],
    tags: [],
    body: "Rename",
    steps: [{ operation: "items.update", arguments: { title: "After" } }],
  };
  let received: Flow | undefined;
  const client = createWaypointClient({
    ...config(),
    flowOperations: ["items.update"],
    flowSource: {
      list: () => [],
      setFavourite: () => {},
      load: () => document,
      run: (_id, _values, flow) => {
        received = flow;
        return { conversationId: "conversation-a" };
      },
    },
  });
  await client.ready;
  await client.runFlow(document.id, {});
  expect(received).toEqual(document);
  expect(loading.count).toBe(0);
  client.dispose();
  await parseFlow(
    '---\nformat: "1.0"\nid: fixture/a\ntitle: Prompt\nkind: prompt\nparameters: []\ntags: []\n---\nPrompt',
    [],
  );
  expect(loading.count).toBe(1);
});

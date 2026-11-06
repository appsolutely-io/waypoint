import { it, expect } from "vitest";
import { createWaypointClient, type FlowTab } from "../../src/core/client";
import { config } from "../support/client";
it("FlowSource uses the four default tabs in order and the first nonempty result", async () => {
  const requested: FlowTab[] = [];
  const client = createWaypointClient({
    ...config(),
    flowSource: {
      list: (tab) => {
        requested.push(tab);
        return tab === "recent" ? [{ id: "recent-a", title: "Recent" }] : [];
      },
      setFavourite: () => {},
      run: () => ({ conversationId: "conversation-a" }),
    },
  });
  await client.ready;
  await client.loadFlows();
  expect(requested).toEqual(["favourites", "most-used", "recent", "presets"]);
  expect(client.getSnapshot().flowTab).toBe("recent");
  client.selectFlowTab("presets");
  await client.loadFlows();
  expect(client.getSnapshot().flowTab).toBe("presets");
  client.dispose();
});
it("a configured tab list and all FlowSource actions reach the host", async () => {
  const calls: unknown[] = [];
  const client = createWaypointClient({
    ...config(),
    tabs: ["presets", "favourites"],
    flowSource: {
      list: (tab) => {
        calls.push(tab);
        return [{ id: "flow-a", title: "Example" }];
      },
      setFavourite: (id, favourite) => {
        calls.push([id, favourite]);
      },
      run: (id, values) => {
        calls.push([id, values]);
        return { conversationId: "conversation-a" };
      },
    },
  });
  await client.ready;
  await client.loadFlows();
  expect(Object.keys(client.getSnapshot().flows)).toEqual([
    "presets",
    "favourites",
  ]);
  await client.setFavourite("flow-a", true);
  await client.runFlow("flow-a", { title: "After" });
  expect(calls).toContainEqual(["flow-a", true]);
  expect(calls).toContainEqual(["flow-a", { title: "After" }]);
  client.dispose();
});
it("supports host-defined tab descriptors alongside the exported defaults", async () => {
  const { DEFAULT_FLOW_TABS } = await import("../../src/core/client");
  expect(DEFAULT_FLOW_TABS).toEqual([
    "favourites",
    "most-used",
    "recent",
    "presets",
  ]);
  const tab = { id: "team", labelKey: "host.team" };
  const requested: unknown[] = [];
  const client = createWaypointClient({
    ...config(),
    tabs: [tab],
    flowSource: {
      list: (value) => {
        requested.push(value);
        return [{ id: "team-a", title: "Team flow" }];
      },
      setFavourite: () => {},
      run: () => ({ conversationId: "conversation-a" }),
    },
  });
  await client.ready;
  await client.loadFlows();
  client.selectFlowTab(tab);
  expect(client.getSnapshot().flowTab).toBe("team");
  expect(client.getSnapshot().flows.team).toHaveLength(1);
  expect(requested).toEqual([tab]);
  client.dispose();
});
it("rejects reserved and duplicate host tab ids during construction", () => {
  for (const tabs of [
    [{ id: "favourites", labelKey: "host.label" }],
    [
      { id: "team", labelKey: "host.first" },
      { id: "team", labelKey: "host.second" },
    ],
    ["recent", { id: "recent", labelKey: "host.recent" }],
  ] as const)
    expect(() => createWaypointClient({ ...config(), tabs })).toThrow(
      "Invalid flow tab id",
    );
});

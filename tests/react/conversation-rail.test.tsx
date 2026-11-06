// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WaypointChat } from "../../src/react/ui";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);
it("groups topics, folds subthreads, marks forms and filters without fetching reference links", async () => {
  const c = createWaypointClient(config());
  await c.ready;
  const subject = {
    key: "draft-a",
    resource: "items",
    label: "<Item>",
    route: "/en/items/new",
    state: "pending" as const,
  };
  render(
    <WaypointChat
      client={c}
      conversations={[
        { id: "root", title: "Form chat", mode: "form-fill", subject },
        {
          id: "child",
          title: "Regenerated title",
          mode: "form-fill",
          subject,
          parentConversationId: "root",
        },
        {
          id: "other",
          title: "Other",
          subject: {
            ...subject,
            key: "draft-b",
            label: "Other topic",
            route: "//example.test",
          },
        },
      ]}
    />,
  );
  expect(screen.getByText("Form chat")).toBeDefined();
  expect(screen.getAllByText("Form").length).toBeGreaterThan(0);
  const child = screen.getByText("Regenerated title");
  expect(child.closest("details")?.open).toBe(false);
  fireEvent.click(screen.getByText("Sub-threads"));
  expect(child.closest("details")?.open).toBe(true);
  expect(
    screen
      .getAllByRole("link", { name: "Back to form or record" })[0]!
      .getAttribute("href"),
  ).toBe("/en/items/new");
  fireEvent.change(screen.getByRole("combobox", { name: "Filter by topic" }), {
    target: { value: "draft-a" },
  });
  expect(screen.queryByText("Other")).toBeNull();
  expect(screen.getAllByText("<Item>").length).toBeDefined();
  c.dispose();
});
it("folds nested descendants and retains cyclic or orphaned conversations", async () => {
  const c = createWaypointClient(config());
  await c.ready;
  render(
    <WaypointChat
      client={c}
      conversations={[
        { id: "root", title: "Root" },
        { id: "child", title: "Child", parentConversationId: "root" },
        {
          id: "grandchild",
          title: "Grandchild",
          parentConversationId: "child",
        },
        { id: "a", title: "Cycle A", parentConversationId: "b" },
        { id: "b", title: "Cycle B", parentConversationId: "a" },
        { id: "orphan", title: "Orphan", parentConversationId: "missing" },
      ]}
    />,
  );
  expect(
    screen
      .getByText("Grandchild")
      .closest("details")
      ?.parentElement?.closest("details"),
  ).toBeTruthy();
  expect(screen.getByText("Cycle A")).toBeDefined();
  expect(screen.getByText("Cycle B")).toBeDefined();
  expect(screen.getByText("Orphan")).toBeDefined();
  c.dispose();
});
it("a conversation list that could not be loaded says so, with a Retry that lists again", async () => {
  const { ConversationRail } =
    await import("../../src/react/conversation-rail");
  const { WaypointProvider } = await import("../../src/react/ui");
  const c = createWaypointClient(config());
  await c.ready;
  let fail = true;
  render(
    <WaypointProvider client={c}>
      <ConversationRail
        conversations={[]}
        source={{
          list: async () => {
            if (fail) throw new Error("offline");
            return [{ id: "a", title: "Listed" }];
          },
          create: async () => {
            throw new Error("Not created here");
          },
        }}
      />
    </WaypointProvider>,
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(
    "Your conversations could not be loaded. Retry",
  );
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Listed")).toBeDefined();
  expect(screen.queryByRole("alert")).toBeNull();
  c.dispose();
});

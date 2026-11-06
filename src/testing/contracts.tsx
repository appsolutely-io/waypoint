import { createFormSession } from "../core/form-session";
import { FormFillFields } from "../react/form-fill";
import { createElement, type ReactElement } from "react";
import {
  render,
  fireEvent,
  act,
  cleanup,
  waitFor,
  type RenderResult,
} from "@testing-library/react";
import {
  WaypointChat,
  WaypointProvider,
  Widget,
  type WaypointProviderProps,
} from "../react/ui";
import type { Block } from "../protocol/generated";
import { createWaypointClient, type WaypointClient } from "../core/client";
import { createScriptedTransport, createTestPlatform } from "./transport";
export type Skin = Partial<Omit<WaypointProviderProps, "client" | "children">>;
export function renderWithWaypoint(
  element: ReactElement,
  options: { client: WaypointClient; skin?: Skin },
): RenderResult {
  return render(
    createElement(
      WaypointProvider,
      { client: options.client, ...options.skin },
      element,
    ),
  );
}
export interface ContractAssertions {
  equal(actual: unknown, expected: unknown): void;
  ok(value: unknown): void;
}
export interface ContractSuite {
  test(name: string, run: () => Promise<void>): void;
  assert: ContractAssertions;
}
export function defineSkinContract(
  suite: ContractSuite,
  skin: Skin = {},
): void {
  suite.test("composer, keyboard and accessibility contract", async () => {
    const fixture = createScriptedTransport();
    const client = createWaypointClient({
      accountId: "test-account",
      conversationId: "test-conversation",
      platform: createTestPlatform(),
      transport: fixture.transport,
    });
    await client.ready;
    try {
      const view = render(createElement(WaypointChat, { client, ...skin }));
      const field = view.getByRole("textbox", { name: "Message" });
      await act(async () => {
        fireEvent.change(field, { target: { value: "Keep" } });
      });
      fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
      suite.assert.equal(client.getSnapshot().draft, "Keep");
      await act(async () => {
        fireEvent.keyDown(field, { key: "Enter" });
      });
      suite.assert.equal(client.getSnapshot().draft, "");
      suite.assert.ok(view.getByRole("alert"));
    } finally {
      cleanup();
      client.dispose();
    }
  });
}
export function defineOverrideContract(
  suite: ContractSuite,
  skin: Skin = {},
): void {
  suite.test("slot, provider and widget isolation contract", async () => {
    const fixture = createScriptedTransport();
    fixture.enqueue({
      content: "Fixture",
      blocks: [
        {
          type: "markdown",
          id: "widget-a",
          fallback: "Readable",
          body: { text: "Widget" },
        },
      ],
    });
    const client = createWaypointClient({
      accountId: "test-account",
      conversationId: "test-conversation",
      platform: createTestPlatform(),
      transport: fixture.transport,
    });
    await client.ready;
    await client.setDraft("Start");
    await client.send();
    try {
      const view = render(createElement(WaypointChat, { client, ...skin }));
      await waitFor(() => {
        if (
          !view.container.querySelector(
            '[data-part="widgetFrame"] .wp-markdown',
          )
        )
          throw new Error("Markdown is not ready");
      });
      const snapshot = () => {
        const parts = new Map<string, string[]>();
        for (const part of view.container.querySelectorAll("[data-part]")) {
          const name = part.getAttribute("data-part")!;
          if (
            [
              "composer",
              "widgetFrame",
              "messageActions",
              "extraPanels",
            ].includes(name)
          )
            continue;
          const clone = part.cloneNode(true) as HTMLElement;
          for (const child of clone.querySelectorAll("[data-part]"))
            child.replaceChildren();
          const entries = parts.get(name) ?? [];
          entries.push(clone.outerHTML);
          parts.set(name, entries);
        }
        return [...parts];
      };
      const baseline = snapshot();
      view.rerender(
        createElement(WaypointChat, {
          client,
          ...skin,
          slots: {
            composer: () => createElement("span", null, "Custom composer"),
            messageActions: () => createElement("span", null, "Custom actions"),
            extraPanels: () => createElement("span", null, "Custom panel"),
          },
        }),
      );
      suite.assert.equal(snapshot(), baseline);
      suite.assert.ok(view.queryAllByText("Custom actions").length);
      view.rerender(
        createElement(WaypointChat, {
          client,
          ...skin,
          parts: {
            composer: () => createElement("span", null, "Custom composer"),
          },
        }),
      );
      suite.assert.equal(snapshot(), baseline);
      view.rerender(
        createElement(WaypointChat, {
          client,
          ...skin,
          widgets: [
            {
              type: "markdown",
              render: () => createElement("span", null, "Custom markdown"),
            },
          ],
        }),
      );
      suite.assert.ok(view.queryByText("Custom markdown"));
      suite.assert.equal(snapshot(), baseline);
    } finally {
      cleanup();
      client.dispose();
    }
  });
}
export function defineWidgetContract(
  suite: ContractSuite,
  skin: Skin = {},
): void {
  const bodies: Record<string, unknown> = {
    markdown: { text: "**Readable**" },
    "form.fill": {
      requestId: "request-a",
      values: {
        title: {
          value: "Draft",
          validation: { status: "valid", messages: [] },
        },
      },
    },
    card: { title: "Card", blocks: [] },
    list: { items: ["Item"] },
    table: { columns: ["Title"], rows: [["Value"]] },
    form: { fields: [{ name: "title", label: "Title", required: true }] },
    choice: { mode: "single", options: ["One", "Two"] },
    buttons: { actions: [{ id: "accept", label: "Accept" }] },
    diff: { before: "Before", after: "After" },
    plan: { planId: "plan-a" },
    "route-link": { label: "View", route: "/items/a" },
    notice: { text: "Notice" },
  };
  for (const [type, body] of Object.entries(bodies))
    suite.test(`widget contract: ${type}`, async () => {
      const fixture = createScriptedTransport();
      const client = createWaypointClient({
        accountId: "test-account",
        conversationId: "test-conversation",
        platform: createTestPlatform(),
        transport: fixture.transport,
      });
      await client.ready;
      try {
        const block = {
          type,
          id: "widget-a",
          fallback: "Readable",
          body,
        } as Block;
        const view = renderWithWaypoint(
          createElement(Widget, { block, disabled: false, onReply: () => {} }),
          { client, skin },
        );
        suite.assert.ok(view.container.textContent);
      } finally {
        cleanup();
        client.dispose();
      }
    });
}
export function defineAccessibilityContract(
  suite: ContractSuite,
  skin: Skin = {},
): void {
  suite.test("failure announcement and direction contract", async () => {
    const fixture = createScriptedTransport();
    const client = createWaypointClient({
      accountId: "test-account",
      conversationId: "test-conversation",
      platform: createTestPlatform(),
      transport: fixture.transport,
    });
    await client.ready;
    try {
      const view = render(
        createElement(WaypointChat, { client, ...skin, dir: "rtl" }),
      );
      await act(async () => {
        client.report({ id: "failure-a", code: "refused" });
      });
      suite.assert.ok(view.getByRole("alert").textContent);
      suite.assert.equal(
        view.container.querySelector(".waypoint")?.getAttribute("dir"),
        "rtl",
      );
      const first = client.getSnapshot().announcement;
      await act(async () => {
        client.report({ id: "failure-a", code: "refused" });
      });
      suite.assert.equal(client.getSnapshot().announcement, first + 1);
    } finally {
      cleanup();
      client.dispose();
    }
  });
}
export function defineFormFillContract(
  suite: ContractSuite,
  skin: Skin = {},
): void {
  suite.test("form drafts and field adornment contract", async () => {
    const fixture = createScriptedTransport();
    const client = createWaypointClient({
      accountId: "form-account",
      conversationId: "form-chat",
      platform: createTestPlatform(),
      transport: fixture.transport,
    });
    await client.ready;
    const session = createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "Draft" }],
      ids: () => "form-contract",
    });
    try {
      const view = renderWithWaypoint(
        createElement(FormFillFields, { session, onRegenerate: () => {} }),
        { client, skin },
      );
      const input = view.getByRole("textbox", { name: "Title" });
      act(() => {
        input.focus();
      });
      suite.assert.ok(view.getByRole("button", { name: "Regenerate Title" }));
      suite.assert.ok(
        view
          .getAllByRole("status")
          .some((status) => status.textContent === "Regenerate Title"),
      );
      fireEvent.change(input, { target: { value: "Edited" } });
      suite.assert.equal(session.getSnapshot().fields.title?.value, "Edited");
      const request = session.begin({ text: "Fill" });
      act(() => {
        session.receive({
          requestId: request.requestId,
          values: {
            title: {
              value: "Proposal",
              validation: { status: "valid", messages: [] },
            },
          },
        });
      });
      suite.assert.equal((input as HTMLInputElement).value, "Edited");
      fireEvent.click(await view.findByRole("button", { name: "Replace" }));
      suite.assert.equal((input as HTMLInputElement).value, "Proposal");
    } finally {
      cleanup();
      session.dispose();
      client.dispose();
    }
  });
}

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { FlowDrawer, FlowPanel } from "../../src/react/flows-panel";
import { WaypointProvider, WaypointChat } from "../../src/react/ui";
import {
  createWaypointClient,
  type FlowSource,
  type FlowSummary,
} from "../../src/core/client";
import type { Flow } from "../../src/protocol/generated";
import { config } from "../support/client";
afterEach(cleanup);

const conversation = (id: string) => ({
  protocol: "1.0",
  id,
  title: "Chat",
  messages: [],
});
const flowDocument = (parameters: Flow["parameters"]): Flow => ({
  format: "1.0",
  id: "flow-a",
  title: "Rename",
  kind: "prompt",
  parameters,
  tags: [],
  body: "Rename",
});
const parameters: Flow["parameters"] = [
  { name: "title", type: "string", required: true, label: "Title" },
  {
    name: "count",
    type: "number",
    required: false,
    label: "Count",
    default: 2,
  },
];
async function chat(
  source: Partial<FlowSource> = {},
  flows: FlowSummary[] = [{ id: "flow-a", title: "Rename" }],
) {
  const base = config();
  let list = flows;
  const run = vi.fn(async (..._args: unknown[]) => ({
    conversationId: "conversation-a",
  }));
  const load = vi.fn(async () => flowDocument(parameters));
  const flowSource: FlowSource = {
    list: () => list,
    setFavourite: () => {},
    run,
    load,
    ...source,
  };
  const client = createWaypointClient({
    ...base,
    tabs: ["presets"],
    transport: { ...base.transport, read: async (id) => conversation(id) },
    flowSource,
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen
    .findByRole("button", { name: flows[0]?.title ?? "x" })
    .catch(() => undefined);
  return {
    client,
    run,
    load,
    setList: (next: FlowSummary[]) => (list = next),
  };
}
// The flow tabs' own alert.
const flowAlert = () =>
  within(screen.getByRole("navigation", { name: "Saved requests" })).findByRole(
    "alert",
  );
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

describe("the flow parameter drawer", () => {
  it("CK-FL1 opens on the press with a loading state, then asks for typed values and runs once", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const load = vi.fn(async () => {
      await held;
      return flowDocument(parameters);
    });
    const h = await chat({ load });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    expect(within(dialog).getByText("Loading request…")).toBeDefined();
    await act(async () => release());
    const title = await within(dialog).findByRole("textbox", {
      name: "Title (required)",
    });
    const run = within(dialog).getByRole("button", { name: "Run" });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(run);
    expect(h.run).not.toHaveBeenCalled();
    expect(
      (
        within(dialog).getByRole("spinbutton", {
          name: "Count",
        }) as HTMLInputElement
      ).value,
    ).toBe("2");
    fireEvent.change(title, { target: { value: "New" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0]![1]).toEqual({ title: "New", count: 2 });
    expect((h.run.mock.calls[0]![2] as Flow).id).toBe("flow-a");
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    h.client.dispose();
  });

  it("CK-FL1 a failed load says so in the drawer, with a Retry that loads again", async () => {
    const load = vi
      .fn<() => Promise<Flow>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(flowDocument(parameters));
    const h = await chat({ load });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog", { name: "Rename" });
    const alert = await within(dialog).findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await within(dialog).findByRole("textbox", { name: "Title (required)" });
    expect(load).toHaveBeenCalledTimes(2);
    h.client.dispose();
  });

  it("CK-FL1 a document with nothing to ask runs at once", async () => {
    const h = await chat({ load: async () => flowDocument([]) });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    h.client.dispose();
  });

  it("CK-FL2 a source without load runs at once, with no drawer", async () => {
    const h = await chat({ load: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await settle();
    expect(h.run).toHaveBeenCalledTimes(1);
    h.client.dispose();
  });

  it("CK-FL1c a load that lands after Cancel shows, keeps and runs nothing", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = await chat({
      load: async () => {
        await held;
        return flowDocument([]);
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close",
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => release());
    await settle();
    expect(h.run).not.toHaveBeenCalled();
    h.client.dispose();
  });

  it("CK-FL1c an earlier row's late load never fills a later row's drawer", async () => {
    let releaseA!: () => void;
    const heldA = new Promise<void>((resolve) => (releaseA = resolve));
    const h = await chat(
      {
        load: async (id: string) => {
          if (id === "flow-a") await heldA;
          return {
            ...flowDocument([
              {
                name: id === "flow-a" ? "fromA" : "fromB",
                type: "string",
                required: false,
                label: id === "flow-a" ? "From A" : "From B",
              },
            ]),
            id,
          };
        },
      },
      [
        { id: "flow-a", title: "Rename" },
        { id: "flow-b", title: "Archive" },
      ],
    );
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = screen.getByRole("dialog", { name: "Archive" });
    await within(dialog).findByRole("textbox", { name: "From B" });
    await act(async () => releaseA());
    await settle();
    expect(
      within(dialog).queryByRole("textbox", { name: "From A" }),
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));
    await settle();
    expect((h.run.mock.calls[0]![2] as Flow).id).toBe("flow-b");
    h.client.dispose();
  });

  it("CK-FL2b a list reload while the drawer is open keeps its document for Run", async () => {
    const h = await chat();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    const title = await within(dialog).findByRole("textbox", {
      name: "Title (required)",
    });
    fireEvent.change(title, { target: { value: "New" } });
    await act(async () => {
      await h.client.loadFlows();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));
    await settle();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect((h.run.mock.calls[0]![2] as Flow).id).toBe("flow-a");
    h.client.dispose();
  });
});

describe("focus around the drawer", () => {
  it("CK-FL1b Run returns focus to the row; a failed run leaves it there", async () => {
    const h = await chat({
      run: vi.fn(async () => {
        throw new Error("refused");
      }),
    });
    const row = screen.getByRole("button", { name: "Rename" });
    row.focus();
    fireEvent.click(row);
    const dialog = screen.getByRole("dialog");
    const title = await within(dialog).findByRole("textbox", {
      name: "Title (required)",
    });
    fireEvent.change(title, { target: { value: "New" } });
    const run = within(dialog).getByRole("button", { name: "Run" });
    run.focus();
    fireEvent.click(run);
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rename" }),
    );
    expect(await flowAlert()).toBeDefined();
    h.client.dispose();
  });

  it("CK-FL6 Retry after a failed run sends the same values and document", async () => {
    const run = vi
      .fn<(...args: unknown[]) => Promise<{ conversationId: string }>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue({ conversationId: "conversation-a" });
    const h = await chat({ run: run as never });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      await within(dialog).findByRole("textbox", { name: "Title (required)" }),
      { target: { value: "New" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Run" }));
    const alert = await flowAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await settle();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![1]).toEqual(run.mock.calls[0]![1]);
    expect(run.mock.calls[1]![2]).toEqual(run.mock.calls[0]![2]);
    expect(h.load).toHaveBeenCalledTimes(1);
    h.client.dispose();
  });
});

describe("saved request rows and tabs", () => {
  it("CK-FL3 the favourite toggle shows the source's state, names its flow, and never flips on its own", async () => {
    let favourite = false;
    const setFavourite = vi.fn(async () => {});
    const h = await chat({
      setFavourite,
      list: () => [{ id: "flow-a", title: "Rename", favourite }],
    });
    const toggle = screen.getByRole("button", { name: "Favourite: Rename" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await settle();
    // The source said nothing new: still not pressed, one write.
    expect(setFavourite).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    favourite = true;
    await act(async () => {
      await h.client.loadFlows();
    });
    expect(
      screen
        .getByRole("button", { name: "Favourite: Rename" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    h.client.dispose();
  });

  it("CK-FL3 a failed favourite write says so, and its Retry writes again", async () => {
    const setFavourite = vi
      .fn<(id: string, value: boolean) => Promise<void>>()
      .mockRejectedValueOnce(new Error("no"))
      .mockResolvedValue();
    const h = await chat({ setFavourite });
    fireEvent.click(screen.getByRole("button", { name: "Favourite: Rename" }));
    const alert = await flowAlert();
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await settle();
    expect(setFavourite.mock.calls).toEqual([
      ["flow-a", true],
      ["flow-a", true],
    ]);
    expect(h.run).not.toHaveBeenCalled();
    h.client.dispose();
  });

  it.each([false, true])(
    "a favourite Retry returns focus to its own flow or the panel if absent: %s",
    async (removed) => {
      let attempts = 0;
      let shown = [
        { id: "flow-a", title: "Rename" },
        { id: "flow-b", title: "Archive" },
      ];
      const h = await chat(
        {
          list: () => shown,
          setFavourite: async () => {
            if (++attempts === 1) throw new Error("offline");
            if (removed) shown = [shown[0]!];
          },
        },
        shown,
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Favourite: Archive" }),
      );
      const alert = await flowAlert();
      const retry = within(alert).getByRole("button", { name: "Retry" });
      retry.focus();
      fireEvent.click(retry);
      await waitFor(() =>
        expect(document.activeElement).toBe(
          removed
            ? screen.getByRole("tabpanel")
            : screen.getByRole("button", { name: "Archive" }),
        ),
      );
      h.client.dispose();
    },
  );

  it("CK-FL4 tabs control one panel, and an empty or failed list says so", async () => {
    const h = await chat({}, []);
    const tab = screen.getByRole("tab", { name: "Presets" });
    const panel = screen.getByRole("tabpanel");
    expect(tab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    await waitFor(() =>
      expect(panel.textContent).toBe("No saved requests here yet."),
    );
    expect(panel.getAttribute("tabindex")).toBe("0");
    h.client.dispose();
  });

  it("CK-FL4 a list that fails to load has a Retry", async () => {
    let fail = true;
    const h = await chat({
      list: () => {
        if (fail) throw new Error("offline");
        return [{ id: "flow-a", title: "Rename" }];
      },
    });
    const alert = await within(screen.getByRole("tabpanel")).findByRole(
      "alert",
    );
    fail = false;
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Rename" })).toBeDefined();
    h.client.dispose();
  });
});

describe("focus after a removed row", () => {
  it("CK-FL7 unfavouriting by keyboard in a list that drops the row hands focus to the panel", async () => {
    let shown = [{ id: "flow-a", title: "Rename", favourite: true }];
    const h = await chat({
      list: () => shown,
      setFavourite: async () => {
        shown = [];
      },
    });
    const toggle = screen.getByRole("button", { name: "Favourite: Rename" });
    toggle.focus();
    fireEvent.click(toggle);
    await settle();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("tabpanel")),
    );
    h.client.dispose();
  });
});

describe("focus after a removed row in a longer list", () => {
  const rows = (...ids: string[]) =>
    ids.map((id) => ({ id: `flow-${id}`, title: id, favourite: true }));
  it("CK-FL7 unfavouriting a middle row hands focus to the row now at its index, the last row to the one before", async () => {
    let shown = rows("a", "b", "c");
    const h = await chat(
      {
        list: () => shown,
        setFavourite: async (id: string) => {
          shown = shown.filter((flow) => flow.id !== id);
        },
      },
      shown,
    );
    const middle = screen.getByRole("button", { name: "Favourite: b" });
    middle.focus();
    fireEvent.keyDown(middle, { key: "Enter" });
    fireEvent.click(middle);
    await settle();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "c" }),
      ),
    );
    const last = screen.getByRole("button", { name: "Favourite: c" });
    last.focus();
    fireEvent.click(last);
    await settle();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "a" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FL7 a row removed by a list reload while its drawer was open: Cancel, Escape and Close move focus to the panel", async () => {
    for (const close of ["Cancel", "Close", "Escape"]) {
      let shown = rows("a", "b");
      const h = await chat({ list: () => shown }, shown);
      const row = screen.getByRole("button", { name: "b" });
      row.focus();
      fireEvent.click(row);
      const dialog = screen.getByRole("dialog");
      const cancel = await within(dialog).findByRole("button", {
        name: close === "Escape" ? "Cancel" : close,
      });
      shown = rows("a");
      await act(async () => {
        await h.client.loadFlows();
      });
      expect(screen.queryByRole("button", { name: "b" })).toBeNull();
      cancel.focus();
      if (close === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else fireEvent.click(cancel);
      await settle();
      expect(document.activeElement, close).toBe(screen.getByRole("tabpanel"));
      h.client.dispose();
      cleanup();
    }
  });
});

describe("Retries that keep focus while they load", () => {
  it("CK-FL4 the list's Retry stays, busy, while the list loads, then hands focus to the first row", async () => {
    let fail = true;
    let release!: () => void;
    const h = await chat({
      list: async () => {
        if (fail) throw new Error("offline");
        await new Promise<void>((resolve) => (release = resolve));
        return [
          { id: "flow-a", title: "Rename" },
          { id: "flow-b", title: "Archive" },
        ];
      },
    });
    const alert = await within(screen.getByRole("tabpanel")).findByRole(
      "alert",
    );
    fail = false;
    const retry = within(alert).getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await settle();
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    // The busy status is its own live region, beside the alert, not in it.
    const status = within(alert.parentElement!).getByRole("status");
    expect(status.textContent).toBe("Loading");
    expect(alert.contains(status)).toBe(false);
    expect(alert.querySelector('[role="status"], [aria-live]')).toBeNull();
    await act(async () => release());
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rename" }),
    );
    h.client.dispose();
  });

  it("CK-FL1 the drawer's Retry keeps focus while the document loads again", async () => {
    let release!: () => void;
    const load = vi
      .fn<() => Promise<Flow>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async () => {
        await new Promise<void>((resolve) => (release = resolve));
        return flowDocument(parameters);
      });
    const h = await chat({ load });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    const retry = await within(dialog).findByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await settle();
    // Never the page while it loads.
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    await act(async () => release());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole("textbox", { name: "Title (required)" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FL1 a preparation that resolves with nothing is a failure in the drawer, never a run with no values", async () => {
    const h = await chat();
    vi.spyOn(h.client, "prepareFlow").mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByRole("button", { name: "Retry" }),
    ).toBeDefined();
    await settle();
    expect(h.run).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeDefined();
    h.client.dispose();
  });
});

describe("focus and states around the flow drawer and panel", () => {
  const two: FlowSummary[] = [
    { id: "flow-a", title: "Rename" },
    { id: "flow-b", title: "Archive" },
  ];
  it("CK-FL1b closing the drawer returns focus to the row that opened it", async () => {
    const h = await chat({}, two);
    for (const close of ["Cancel", "Close", "Escape"]) {
      const row = screen.getByRole("button", { name: "Archive" });
      row.focus();
      fireEvent.click(row);
      const dialog = screen.getByRole("dialog");
      const cancel = await within(dialog).findByRole("button", {
        name: close === "Escape" ? "Cancel" : close,
      });
      cancel.focus();
      if (close === "Escape") fireEvent.keyDown(dialog, { key: "Escape" });
      else fireEvent.click(cancel);
      await settle();
      expect(document.activeElement, close).toBe(
        screen.getByRole("button", { name: "Archive" }),
      );
    }
    h.client.dispose();
  });

  it("CK-FL1b a successful run moves focus to the composer", async () => {
    const h = await chat();
    const row = screen.getByRole("button", { name: "Rename" });
    row.focus();
    fireEvent.click(row);
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      await within(dialog).findByRole("textbox", { name: "Title (required)" }),
      { target: { value: "New" } },
    );
    const run = within(dialog).getByRole("button", { name: "Run" });
    run.focus();
    fireEvent.click(run);
    await settle();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Message" }),
      ),
    );
    h.client.dispose();
  });

  it("CK-FL1c a load that lands after a conversation switch closes the drawer and runs nothing", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const h = await chat({
      load: async () => {
        await held;
        return flowDocument([]);
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    await act(async () => {
      await h.client.switchConversation("conversation-b");
    });
    await act(async () => release());
    await settle();
    expect(h.run).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    h.client.dispose();
  });

  it("CK-FL1c a switch while the drawer asks for values closes it and runs nothing", async () => {
    const h = await chat();
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    await within(screen.getByRole("dialog")).findByRole("textbox", {
      name: "Title (required)",
    });
    await act(async () => {
      await h.client.switchConversation("conversation-b");
    });
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(h.run).not.toHaveBeenCalled();
    // Closed, not hidden: the row opens it again.
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    h.client.dispose();
  });

  it("CK-FL1c a preparation the client refuses closes the drawer, with no Retry", async () => {
    const h = await chat();
    vi.spyOn(h.client, "prepareFlow").mockRejectedValue({
      code: "refused",
      id: "flow-prepare",
    });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByRole("dialog")).toBeDefined();
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(h.run).not.toHaveBeenCalled();
    h.client.dispose();
  });

  it("the list's Retry hands focus to the first row while a favourite failure is also shown", async () => {
    const base = config();
    const client = createWaypointClient({
      ...base,
      tabs: ["presets"],
      flowSource: {
        list: () => [],
        setFavourite: async () => {
          throw new Error("offline");
        },
        run: async () => ({ conversationId: "conversation-a" }),
      },
    });
    await client.ready;
    const rows = [{ id: "flow-a", title: "Rename" }];
    const panel = (flows: typeof rows, list: "failed" | "done") => (
      <WaypointProvider client={client}>
        <FlowPanel
          id="panel"
          labelledBy="tab"
          flows={flows}
          all={flows}
          list={list}
          onRetryList={() => {}}
          onRunFlow={() => {}}
        />
      </WaypointProvider>
    );
    const view = render(panel(rows, "done"));
    fireEvent.click(screen.getByRole("button", { name: "Favourite: Rename" }));
    await screen.findByRole("alert");
    // The list reloads and fails: its own alert and Retry, below the
    // favourite's.
    view.rerender(panel([], "failed"));
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(2);
    const listRetry = within(alerts[1]!).getByRole("button", {
      name: "Retry",
    });
    listRetry.focus();
    view.rerender(panel(rows, "done"));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Rename" }),
      ),
    );
    client.dispose();
  });

  it("a click on the drawer's text moves no focus when its content changes", async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    let release!: () => void;
    render(
      <WaypointProvider client={client}>
        <FlowDrawer
          flow={{ id: "flow-a", title: "Rename" }}
          prepare={async () => {
            await new Promise<void>((resolve) => (release = resolve));
            return flowDocument(parameters);
          }}
          onRun={() => {}}
          onCancel={() => {}}
        />
      </WaypointProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    const body = dialog.querySelector<HTMLElement>('div[tabindex="-1"]')!;
    // A pointer click on the loading text focuses the body itself.
    fireEvent.pointerDown(body);
    body.focus();
    fireEvent.click(body);
    expect(document.activeElement).toBe(body);
    await act(async () => release());
    await within(dialog).findByRole("textbox", { name: "Title (required)" });
    expect(document.activeElement).toBe(body);
    client.dispose();
  });

  it("a drawer Retry with no remaining field hands focus to its content", async () => {
    const cfg = config();
    const client = createWaypointClient(cfg);
    await client.ready;
    let attempt = 0;
    render(
      <WaypointProvider client={client}>
        <FlowDrawer
          flow={{ id: "flow-a", title: "Rename" }}
          prepare={async () => {
            if (++attempt === 1) throw new Error("offline");
            return flowDocument([]);
          }}
          onRun={() => {}}
          onCancel={() => {}}
        />
      </WaypointProvider>,
    );
    const dialog = await screen.findByRole("dialog");
    const retry = await within(dialog).findByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(dialog.querySelector('div[tabindex="-1"]')).toBe(
        document.activeElement,
      ),
    );
    client.dispose();
  });

  it("CK-FL1 Retry in the drawer hands focus to the form it loads", async () => {
    const load = vi
      .fn<() => Promise<Flow>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(flowDocument(parameters));
    const h = await chat({ load });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const dialog = screen.getByRole("dialog");
    const retry = await within(dialog).findByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    const title = await within(dialog).findByRole("textbox", {
      name: "Title (required)",
    });
    await waitFor(() => expect(document.activeElement).toBe(title));
    h.client.dispose();
  });

  it("CK-FL6 Retry of a failed run hands focus to its row when the alert goes", async () => {
    const run = vi
      .fn<(...args: unknown[]) => Promise<{ conversationId: string }>>()
      .mockRejectedValueOnce(new Error("busy"))
      .mockResolvedValue(undefined as never);
    const h = await chat({ run: run as never, load: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const alert = await flowAlert();
    const retry = within(alert).getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await settle();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Rename" }),
    );
    h.client.dispose();
  });
});

describe("the saved requests' panel chunk", () => {
  it("CK-FL4 a panel whose code failed to load says so in its panel, and a Retry loads it", async () => {
    vi.resetModules();
    const state = { fail: true };
    vi.doMock("../../src/react/flows-panel", async (original) => {
      if (state.fail) throw new Error("chunk unavailable");
      return await original();
    });
    try {
      const { WaypointChat: Chat } = await import("../../src/react/ui");
      const { createWaypointClient: create } =
        await import("../../src/core/client");
      const base = config();
      const client = create({
        ...base,
        tabs: ["presets"],
        transport: { ...base.transport, read: async (id) => conversation(id) },
        flowSource: {
          list: () => [{ id: "flow-a", title: "Rename" }],
          setFavourite: () => {},
          run: async () => ({ conversationId: "conversation-a" }),
        },
      });
      await client.ready;
      render(<Chat client={client} />);
      const tab = screen.getByRole("tab", { name: "Presets" });
      const panel = await screen.findByRole("tabpanel");
      expect(tab.getAttribute("aria-controls")).toBe(panel.id);
      const alert = await within(panel).findByRole("alert");
      state.fail = false;
      const retry = within(alert).getByRole("button", { name: "Retry" });
      retry.focus();
      fireEvent.click(retry);
      expect(
        await screen.findByRole("button", { name: "Rename" }),
      ).toBeDefined();
      // The Retry is gone: focus goes to the panel it loaded.
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("tabpanel")),
      );
      client.dispose();
    } finally {
      vi.doUnmock("../../src/react/flows-panel");
      vi.resetModules();
    }
  });
});

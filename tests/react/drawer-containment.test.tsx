// @vitest-environment jsdom
// Every modal drawer makes the page behind it unreachable, as a modal
// dialog does, whoever renders it: a standalone confirm sheet, the
// form-fill popup and the chat's own drawers, in both skins. Only the
// topmost of stacked drawers is reachable, and closing undoes exactly what
// opening did.
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode, useState } from "react";
import { ConfigProvider, Select } from "antd";
import { ModalDrawer } from "../../src/react/chat-focus";
import type { ReactNode } from "react";
import { ConfirmSheet, WaypointProvider } from "../../src/react/index";
import { FormFillPopup } from "../../src/react/form-fill";
import { antdPrimitives } from "../../src/skin-antd/index";
import { createFormSession } from "../../src/core/form-session";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import { containFocus } from "../../src/react/focus";

afterEach(cleanup);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
// While a drawer is open, nothing outside it can be reached: everything
// outside lies in an inert subtree, nothing inside does.
// A skin may mark the drawer's own root (the antd mask and focus sentinels
// beside the dialog): it counts as inside, and only its focus sentinels,
// which are no Tab stops, are inert in it.
function expectContained() {
  const own = dialog().closest("[data-wp-modal-root]") ?? dialog();
  const outside = [...document.body.querySelectorAll("*")].filter(
    (element) => !own.contains(element) && !element.contains(own),
  );
  expect(outside.length).toBeGreaterThan(0);
  for (const element of outside)
    expect(
      element.closest("[inert]"),
      element.outerHTML.slice(0, 80),
    ).not.toBeNull();
  expect(own.closest("[inert]")).toBeNull();
  expect(own.querySelector("[inert]:not([data-sentinel])")).toBeNull();
  expect(dialog().querySelector("[inert]")).toBeNull();
}
const noInert = () => expect(document.querySelector("[inert]")).toBeNull();
const skins: [string, object][] = [
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
];
const sheet = (
  <ConfirmSheet
    title="Confirm"
    body="A recorded request will run"
    onProceed={() => {}}
    onCancel={() => {}}
  />
);
describe("a standalone confirm sheet", () => {
  it("with no provider at all", async () => {
    const view = render(
      <>
        {sheet}
        <button>Behind</button>
      </>,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expectContained();
    view.unmount();
    noInert();
  });
  it.each(skins)("inside a provider, %s", async (_, skin) => {
    const client = createWaypointClient(config());
    render(
      <WaypointProvider client={client} {...skin}>
        {sheet}
        <button>Behind</button>
      </WaypointProvider>,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expectContained();
    client.dispose();
  });
});
describe.each(skins)("the form-fill popup, %s", (_, skin) => {
  it("makes the page behind it unreachable, and reachable again on close", async () => {
    const client = createWaypointClient(config());
    await client.ready;
    const session = createFormSession({
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
      ids: () => "request",
    });
    const wrap = (children: ReactNode) => (
      <WaypointProvider client={client} {...skin}>
        {children}
      </WaypointProvider>
    );
    const view = render(
      wrap(
        <>
          <button>Behind</button>
          <FormFillPopup session={session} open onClose={() => {}} />
        </>,
      ),
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expectContained();
    view.rerender(
      wrap(
        <>
          <button>Behind</button>
          <FormFillPopup session={session} open={false} onClose={() => {}} />
        </>,
      ),
    );
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    noInert();
    client.dispose();
  });
});
describe.each(skins)("programmatic modal entry, %s", (_, skin) => {
  it("moves focus from the page into a sheet opened without a chat press", async () => {
    const client = createWaypointClient(config());
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const view = render(
      <WaypointProvider client={client} {...skin}>
        {sheet}
      </WaypointProvider>,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(dialog().contains(document.activeElement)).toBe(true);
    view.unmount();
    opener.remove();
    client.dispose();
  });
});
it("a sheet with no provider enters its dialog", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  render(sheet);
  expect(dialog()).toBe(document.activeElement);
  opener.remove();
});

describe("stacked drawers and what was inert before", () => {
  function Two() {
    const [first, setFirst] = useState(true);
    const [second, setSecond] = useState(false);
    return (
      <>
        <p inert>Already inert</p>
        <button onClick={() => setSecond(true)}>Behind</button>
        {first ? (
          <ConfirmSheet
            title="First"
            body="The first sheet"
            onProceed={() => {}}
            onCancel={() => setFirst(false)}
          />
        ) : null}
        {second ? (
          <ConfirmSheet
            title="Second"
            body="The second sheet"
            onProceed={() => {}}
            onCancel={() => setSecond(false)}
          />
        ) : null}
      </>
    );
  }
  it("only the topmost drawer's outside is inert; closing restores each layer, and leaves alone what was inert before", async () => {
    render(<Two />);
    const named = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
        (element) => element.textContent?.includes(name),
      )!;
    await waitFor(() => expect(named("The first sheet")).toBeTruthy());
    const behind = screen.getByText("Behind");
    expect(behind.closest("[inert]")).not.toBeNull();
    // A second sheet opened from outside (as a host would, in code).
    fireEvent.click(behind);
    await waitFor(() => expect(named("The second sheet")).toBeTruthy());
    expect(named("The second sheet").closest("[inert]")).toBeNull();
    expect(named("The first sheet").closest("[inert]")).not.toBeNull();
    fireEvent.click(
      [...named("The second sheet").querySelectorAll("button")].at(-1)!,
    );
    await waitFor(() => expect(named("The second sheet")).toBeUndefined());
    expect(named("The first sheet").closest("[inert]")).toBeNull();
    expect(behind.closest("[inert]")).not.toBeNull();
    fireEvent.click(
      [...named("The first sheet").querySelectorAll("button")].at(-1)!,
    );
    await waitFor(() => expect(named("The first sheet")).toBeUndefined());
    expect(behind.closest("[inert]")).toBeNull();
    expect(screen.getByText("Already inert").hasAttribute("inert")).toBe(true);
  });
  it("an unmounted drawer leaves nothing inert", async () => {
    const view = render(
      <>
        {sheet}
        <button>Behind</button>
      </>,
    );
    await waitFor(() => expect(dialog()).not.toBeNull());
    expectContained();
    view.unmount();
    noInert();
  });
});

describe.each(skins)("standalone modal return, %s", (_, skin) => {
  it.each([false, true])(
    "restores its opener after close, strict mode %s",
    async (strict) => {
      const client = createWaypointClient(config());
      const opener = document.createElement("button");
      document.body.append(opener);
      opener.focus();
      const tree = (open: boolean) => {
        const content = (
          <WaypointProvider client={client} {...skin}>
            {open ? sheet : null}
          </WaypointProvider>
        );
        return strict ? <StrictMode>{content}</StrictMode> : content;
      };
      const view = render(tree(true));
      await waitFor(() => expect(document.activeElement).toBe(dialog()));
      view.rerender(tree(false));
      await act(async () => {});
      expect(document.activeElement).toBe(opener);
      view.unmount();
      opener.remove();
      client.dispose();
    },
  );
  it.each(["host focus", "removed opener", "disabled opener"])(
    "does not restore after %s",
    async (change) => {
      const client = createWaypointClient(config());
      const opener = document.createElement("button");
      const other = document.createElement("button");
      document.body.append(opener, other);
      opener.focus();
      const view = render(
        <WaypointProvider client={client} {...skin}>
          {sheet}
        </WaypointProvider>,
      );
      await waitFor(() => expect(document.activeElement).toBe(dialog()));
      if (change === "host focus") other.focus();
      if (change === "removed opener") opener.remove();
      if (change === "disabled opener") opener.disabled = true;
      view.unmount();
      await act(async () => {});
      expect(document.activeElement).not.toBe(opener);
      if (change === "host focus") expect(document.activeElement).toBe(other);
      else expect(document.activeElement).toBe(document.body);
      opener.remove();
      other.remove();
      client.dispose();
    },
  );
});

describe("modal inert ownership", () => {
  it.each(["claim", "clear", "replace"])(
    "preserves the host's later inert write: %s",
    (change) => {
      const behind = document.createElement("button");
      const modal = document.createElement("div");
      document.body.append(behind, modal);
      const release = containFocus(modal);
      try {
        expect(behind.hasAttribute("inert")).toBe(true);
        if (change === "clear") behind.removeAttribute("inert");
        else {
          if (change === "replace") behind.removeAttribute("inert");
          behind.setAttribute("inert", "");
        }
        release();
        expect(behind.hasAttribute("inert")).toBe(change !== "clear");
      } finally {
        release();
        behind.remove();
        modal.remove();
      }
    },
  );
  it("preserves a host claim on a sibling added while the modal is open", async () => {
    const modal = document.createElement("div");
    document.body.append(modal);
    const release = containFocus(modal);
    const added = document.createElement("button");
    try {
      document.body.append(added);
      await act(async () => {});
      expect(added.hasAttribute("inert")).toBe(true);
      added.setAttribute("inert", "");
      release();
      expect(added.hasAttribute("inert")).toBe(true);
    } finally {
      release();
      added.remove();
      modal.remove();
    }
  });
});

it("encloses shadow and assigned siblings of a slotted modal, including additions", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  const button = document.createElement("button");
  const slot = document.createElement("slot");
  shadow.append(button, slot);
  const modal = document.createElement("div");
  const sibling = document.createElement("button");
  host.append(modal, sibling);
  const release = containFocus(modal);
  const added = document.createElement("button");
  try {
    expect(modal.assignedSlot).toBe(slot);
    expect(button.hasAttribute("inert")).toBe(true);
    expect(sibling.hasAttribute("inert")).toBe(true);
    expect(slot.hasAttribute("inert")).toBe(false);
    expect(modal.hasAttribute("inert")).toBe(false);
    host.append(added);
    await act(async () => {});
    expect(added.hasAttribute("inert")).toBe(true);
    release();
    expect(button.hasAttribute("inert")).toBe(false);
    expect(sibling.hasAttribute("inert")).toBe(false);
    expect(added.hasAttribute("inert")).toBe(false);
  } finally {
    release();
    host.remove();
  }
});

it("keeps a drawer control's popup inside the modal and preserves the host container outside", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const options = [{ value: "one", label: "One" }];
  const tree = (open: boolean) => (
    <ConfigProvider getPopupContainer={() => host}>
      <Select aria-label="Outside choice" options={options} />
      {open ? (
        <ModalDrawer
          as={antdPrimitives.drawer}
          open
          label="Options"
          onClose={() => {}}
        >
          <Select aria-label="Inside choice" options={options} />
        </ModalDrawer>
      ) : null}
    </ConfigProvider>
  );
  const view = render(tree(true));
  try {
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Inside choice" }),
    );
    await waitFor(() =>
      expect(document.querySelector(".ant-select-dropdown")).not.toBeNull(),
    );
    expect(dialog().querySelector(".ant-select-dropdown")).not.toBeNull();
    expect(
      document.querySelector(".ant-select-dropdown")!.closest("[inert]"),
    ).toBeNull();
    view.rerender(tree(false));
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Outside choice" }),
    );
    await waitFor(() =>
      expect(host.querySelector(".ant-select-dropdown")).not.toBeNull(),
    );
  } finally {
    view.unmount();
    host.remove();
  }
});

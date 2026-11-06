// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { config } from "../support/client";
afterEach(() => {
  cleanup();
  vi.doUnmock("../../src/react/form-extras");
  vi.resetModules();
});

const chunk = { gate: Promise.resolve(), fail: false };
async function load() {
  vi.resetModules();
  vi.doMock("../../src/react/form-extras", async (original) => {
    await chunk.gate;
    if (chunk.fail) throw new Error("chunk unavailable");
    return await original();
  });
  const { FormFillFields, FormFillPopup } =
    await import("../../src/react/form-fill");
  const { WaypointProvider } = await import("../../src/react/ui");
  const { createFormSession } = await import("../../src/core/form-session");
  const { createWaypointClient } = await import("../../src/core/client");
  const cfg = config();
  cfg.transport.negotiate = async () => ({
    protocol: "1.1",
    capabilities: ["form-fill"],
  });
  const client = createWaypointClient(cfg);
  await client.ready;
  const session = createFormSession({
    fields: [{ name: "title", label: "Title", tier: "low", value: "Mine" }],
    ids: () => "fill",
  });
  const view = render(
    <WaypointProvider client={client}>
      <form data-host="">
        <FormFillFields session={session} onRegenerate={() => {}} />
      </form>
      <FormFillPopup
        session={session}
        open
        onClose={() => {}}
        attachments={{ upload: async () => "ref", remove: async () => {} }}
      />
    </WaypointProvider>,
  );
  return { client, session, view };
}
const generate = () => screen.getByRole("button", { name: "Generate draft" });

describe("form fill while its extras load", () => {
  it("CK-FF0 the fields are there and editable at once, and stay put when the extras arrive", async () => {
    let release!: () => void;
    chunk.gate = new Promise<void>((resolve) => (release = resolve));
    chunk.fail = false;
    const h = await load();
    const input = screen.getByRole("textbox", {
      name: "Title",
    }) as HTMLInputElement;
    // No element between the host's form and the field's own wrapper.
    expect(
      (
        h.view.container.querySelector("form[data-host]")!
          .firstElementChild as HTMLElement
      ).className,
    ).toBe("wp-field-parent");
    fireEvent.change(input, { target: { value: "Typed" } });
    expect(h.session.getSnapshot().fields.title?.value).toBe("Typed");
    input.focus();
    expect(generate().getAttribute("aria-disabled")).toBe("true");
    expect(
      document.getElementById(generate().getAttribute("aria-describedby")!)!
        .textContent,
    ).toBe("Draft tools are still loading.");
    await act(async () => release());
    await waitFor(() =>
      expect(generate().getAttribute("aria-disabled")).toBeNull(),
    );
    expect(screen.getByRole("textbox", { name: "Title" })).toBe(input);
    expect(document.activeElement).toBe(input);
    h.client.dispose();
  });

  it("CK-FF0 a failed load leaves the fields usable, says so in the popup, and a Retry loads again", async () => {
    chunk.gate = Promise.resolve();
    chunk.fail = true;
    const h = await load();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "The request could not be completed.",
      ),
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
      target: { value: "Still typing" },
    });
    expect(h.session.getSnapshot().fields.title?.value).toBe("Still typing");
    expect(
      document.getElementById(generate().getAttribute("aria-describedby")!)!
        .textContent,
    ).toBe("Draft tools couldn't load. Retry first.");
    // An image now is not uploaded; a file drop never reaches the page.
    const area = screen.getByRole("textbox", { name: "Message" });
    const drop = fireEvent.drop(area, {
      dataTransfer: {
        files: [new File(["a"], "a.png", { type: "image/png" })],
        types: ["Files"],
      },
    });
    expect(drop).toBe(false);
    expect(
      screen.getByText("Images can't be attached right now."),
    ).toBeDefined();
    chunk.fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(generate().getAttribute("aria-disabled")).toBeNull(),
    );
    h.client.dispose();
  });
});

describe("form fill extras Retry", () => {
  it("CK-FF12 a Retry that loads the extras hands focus to the Message field", async () => {
    chunk.gate = Promise.resolve();
    chunk.fail = true;
    const h = await load();
    const alert = await screen.findByRole("alert");
    chunk.fail = false;
    const retry = within(alert).getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Message" }),
      ),
    );
    h.client.dispose();
  });
});

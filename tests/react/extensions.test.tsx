// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import { WaypointChat, createFormatter } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
afterEach(cleanup);
it("problemText can provide text and an action without exposing raw problem details", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(
    <WaypointChat
      client={client}
      problemText={() => ({
        text: "Try your session again",
        action: <button>Sign in</button>,
      })}
    />,
  );
  await act(async () => client.report({ code: "sign-in", id: "problem-a" }));
  expect(screen.getByRole("alert").textContent).toContain(
    "Try your session again",
  );
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  client.dispose();
});
it("features and disabled shortcuts are honored independently of negotiated capabilities", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  render(
    <WaypointChat
      client={client}
      features={["widgets"]}
      shortcuts={{ focusComposer: false, send: false }}
    />,
  );
  expect(screen.queryByLabelText("Saved requests")).toBeNull();
  const field = screen.getByRole("textbox", { name: "Message" });
  field.blur();
  fireEvent.keyDown(document.querySelector(".waypoint")!, { key: "/" });
  expect(document.activeElement).not.toBe(field);
  fireEvent.change(field, { target: { value: "Keep" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(client.getSnapshot().draft).toBe("Keep");
  client.dispose();
});
it("Simplified Chinese includes ICU plural formatting", () =>
  expect(createFormatter("zh-CN")("chat.stepUp", { count: 2 })).toBe(
    "2 次验证",
  ));
it("configured flow tabs expose selection and scoped arrow-key navigation", async () => {
  const client = createWaypointClient({
    ...config(),
    tabs: ["presets", "favourites"],
    flowSource: {
      list: () => [],
      setFavourite: () => {},
      run: () => ({ conversationId: "conversation-a" }),
    },
  });
  await client.ready;
  await client.loadFlows();
  render(<WaypointChat client={client} />);
  const presets = screen.getByRole("tab", { name: "Presets" });
  expect(presets.getAttribute("aria-selected")).toBe("true");
  // Keys move between tabs only from a focused tab of this tablist.
  presets.focus();
  fireEvent.keyDown(presets, { key: "ArrowRight" });
  expect(
    screen
      .getByRole("tab", { name: "Favourites" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  client.dispose();
});
it("the deprecated global shortcut option moves no focus from outside the chat", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const view = render(
    <>
      <input aria-label="Host input" />
      <select aria-label="Host select">
        <option>One</option>
      </select>
      <div contentEditable>
        <span>Editable</span>
      </div>
      <WaypointChat client={client} shortcuts={{ global: true }} />
    </>,
  );
  for (const target of [
    screen.getByLabelText("Message"),
    screen.getByLabelText("Host input"),
    screen.getByLabelText("Host select"),
    screen.getByText("Editable"),
  ]) {
    expect(fireEvent.keyDown(target, { key: "/", cancelable: true })).toBe(
      true,
    );
  }
  const host = screen.getByLabelText("Host input");
  host.focus();
  expect(
    fireEvent.keyDown(view.container, { key: "/", cancelable: true }),
  ).toBe(true);
  expect(document.activeElement).toBe(host);
  client.dispose();
});
it("renders host tab labels through their label keys", async () => {
  const client = createWaypointClient({
    ...config(),
    tabs: [{ id: "team", labelKey: "host.team" }],
    flowSource: {
      list: () => [],
      setFavourite: () => {},
      run: () => ({ conversationId: "conversation-a" }),
    },
  });
  await client.ready;
  await client.loadFlows();
  render(
    <WaypointChat
      client={client}
      flowTabLabel={(key) => (key === "host.team" ? "Team requests" : key)}
    />,
  );
  expect(
    screen
      .getByRole("tab", { name: "Team requests" })
      .getAttribute("aria-selected"),
  ).toBe("true");
  client.dispose();
});

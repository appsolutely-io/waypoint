// @vitest-environment jsdom
import { afterEach, it, expect } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdSkin, antdPrimitives } from "../../src/skin-antd/index";
import { config } from "../support/client";
import { createWaypointClient } from "../../src/core/client";
afterEach(cleanup);
it("antd replaces presentation while preserving controlled composer and dark switching", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const view = render(<WaypointChat client={client} {...antdSkin} />);
  const field = screen.getByRole("textbox", { name: "Message" });
  expect(field.className).toContain("ant-input");
  fireEvent.change(field, { target: { value: "Keep" } });
  view.rerender(
    <WaypointChat client={client} {...antdSkin} colorScheme="dark" />,
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toBe(field);
  expect(client.getSnapshot().draft).toBe("Keep");
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(client.getSnapshot().draft).toBe(""));
  client.dispose();
});
it("pixel token dimensions map without multiplying them as rem values", async () => {
  const { theme } = await import("antd");
  function Tokens() {
    const { token } = theme.useToken();
    return <output>{token.borderRadius}</output>;
  }
  const { WaypointProvider } = await import("../../src/react/index");
  const client = createWaypointClient(config());
  await client.ready;
  render(
    <WaypointProvider client={client} {...antdSkin} theme={{ radius: "8px" }}>
      <Tokens />
    </WaypointProvider>,
  );
  expect(screen.getByRole("status").textContent).toBe("8");
  client.dispose();
});

it("disables the controlled textarea when the conversation is unavailable", () => {
  const Textarea = antdPrimitives.textarea;
  render(
    <Textarea value="Keep" label="Message" disabled onChange={() => {}} />,
  );
  expect(
    (screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
});

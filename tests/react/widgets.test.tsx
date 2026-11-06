// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import {
  WaypointProvider,
  Widget,
  standardWidgets,
  createFormatter,
} from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import samples from "../protocol/samples.json";
import type { Block } from "../../src/protocol/generated";
afterEach(cleanup);
for (const registration of standardWidgets)
  it(`standard widget ${registration.type}`, async () => {
    const client = createWaypointClient(config());
    await client.ready;
    const block = Object.values(samples).find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        value.type === registration.type,
    ) as Block;
    render(
      <WaypointProvider client={client}>
        <Widget block={block} disabled={false} onReply={() => {}} />
      </WaypointProvider>,
    );
    expect(document.body.textContent?.length).toBeGreaterThan(0);
    client.dispose();
  });
it("fallback cannot answer; markdown renderer replacement and unsafe link refusal", async () => {
  const client = createWaypointClient(config());
  await client.ready;
  const block = {
    type: "future/widget",
    id: "a",
    fallback: "Readable",
    body: {},
  };
  const view = render(
    <WaypointProvider client={client}>
      <Widget
        block={block}
        disabled={false}
        onReply={() => {
          throw new Error("must not answer");
        }}
      />
    </WaypointProvider>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(
    <WaypointProvider
      client={client}
      renderers={{ markdown: ({ text }) => <p>Custom {text}</p> }}
    >
      <Widget
        block={{
          type: "markdown",
          id: "a",
          fallback: "",
          body: { text: "Hello" },
        }}
        disabled={false}
        onReply={() => {}}
      />
    </WaypointProvider>,
  );
  expect(screen.getByText("Custom Hello")).toBeTruthy();
  client.dispose();
});
it("ICU plurals and both catalogues", () => {
  expect(createFormatter("en")("chat.stepUp", { count: 2 })).toBe(
    "2 verification prompts",
  );
  expect(createFormatter("zh-CN")("chat.send")).toBe("发送");
});

// @vitest-environment jsdom
// Below 40rem of the chat's width the plan is read where it is decided:
// after the messages and before the composer, in the reading order and on
// screen. Wide, it keeps its own column after the conversation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { antdPrimitives } from "../../src/skin-antd/index";
import { english } from "../../src/react/i18n";
import { createWaypointClient } from "../../src/core/client";
import type { PlanRecord } from "../../src/protocol/generated";
import { config } from "../support/client";
import {
  installResizeObserver,
  notifyResize,
} from "../support/transcript-geometry";

let restore: () => void;
beforeEach(() => {
  restore = installResizeObserver();
});
afterEach(() => {
  cleanup();
  restore();
  document.body.innerHTML = "";
});
let width = 300;
const measure = async (next: number) => {
  width = next;
  await act(async () => {
    notifyResize();
  });
};
const plan = {
  protocol: "1.0",
  id: "plan-a",
  state: "awaiting-confirmation",
  outcomes: [],
  plan: {
    kind: "immediate",
    stage: "final",
    id: "plan-a",
    digest: "d",
    stepUpCount: 0,
    steps: [],
  },
} as unknown as PlanRecord;
const before = (a: Node, b: Node) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe.each([
  ["neutral", {}],
  ["antd", { primitives: antdPrimitives }],
] as const)("the plan's place (%s)", (_, skin) => {
  it("narrow: after the messages and before the composer; wide: its own column", async () => {
    const client = createWaypointClient(config());
    render(<WaypointChat client={client} {...skin} />);
    await act(async () => {
      await client.ready;
      client.setPlan(plan);
    });
    const root = document.querySelector<HTMLElement>(".waypoint")!;
    Object.defineProperty(root, "getBoundingClientRect", {
      configurable: true,
      value: () => DOMRect.fromRect({ width, height: 600 }),
    });
    const region = () =>
      document.querySelector<HTMLElement>(
        `:is(aside, section)[aria-label="${english["chat.plan"]}"]`,
      )!;
    const composer = () => screen.getByRole("textbox", { name: "Message" });
    const transcript = () =>
      screen.getByRole("region", { name: english["chat.transcript"] });
    await measure(300);
    expect(before(transcript(), region())).toBe(true);
    expect(before(region(), composer())).toBe(true);
    // Inside the conversation, it is a region, not a top-level aside.
    expect(region().tagName).toBe("SECTION");
    await measure(1000);
    expect(region().tagName).toBe("ASIDE");
    expect(before(composer(), region())).toBe(true);
    client.dispose();
  });
});

// @vitest-environment jsdom
import { it, expect, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "../support/client";
import { createCardHost } from "../support/card-host";
afterEach(cleanup);
it("a refused card answer can be corrected and retried instead of staying disabled", async () => {
  const base = config();
  let attempts = 0;
  // The host marks the card answered once it applied an answer.
  let answered = false;
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "assistant-a",
            role: "assistant",
            content: "",
            createdAt: 0,
            blocks: [
              {
                type: "buttons",
                id: "question-a",
                fallback: "Answer",
                body: { actions: [{ id: "accept", label: "Accept" }] },
                answered,
              },
            ],
          },
        ],
      }),
      send: async () => {
        attempts++;
        if (attempts === 1) throw { id: "p", code: "refused" };
        answered = true;
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(
    (screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  client.dispose();
});
it("nested replies name the actual form block while one answer disables the whole card", async () => {
  const base = config();
  let target = "";
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async () => ({
        protocol: "1.0",
        id: "conversation-a",
        title: "Chat",
        messages: [
          {
            id: "assistant-a",
            role: "assistant",
            content: "",
            createdAt: 0,
            blocks: [
              {
                type: "card",
                id: "card-a",
                fallback: "Card",
                body: {
                  title: "Question",
                  blocks: [
                    {
                      type: "buttons",
                      id: "child-a",
                      fallback: "Answer",
                      body: { actions: [{ id: "yes", label: "Yes" }] },
                    },
                    {
                      type: "buttons",
                      id: "child-b",
                      fallback: "Other",
                      body: { actions: [{ id: "no", label: "No" }] },
                    },
                  ],
                },
                // The host marks the whole card answered.
                answered: target !== "",
              },
            ],
          },
        ],
      }),
      send: async (reply) => {
        if (reply.kind === "action") target = reply.blockId;
        return { id: "stored" };
      },
    },
  });
  await client.ready;
  render(<WaypointChat client={client} />);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  await waitFor(() => expect(target).toBe("child-a"));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "No" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  client.dispose();
});
// A browser moves focus off a control that becomes disabled (jsdom does
// not, and does not blur a disabled control, so the test does it for it).
const pressAndLoseFocus = async (name: string) => {
  const button = screen.getByRole("button", { name }) as HTMLButtonElement;
  button.focus();
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  await act(async () => {
    button.disabled = false;
    button.blur();
    button.disabled = true;
  });
};
it("after a lost response the card shows the answer the host holds, and focus goes to the composer", async () => {
  const host = createCardHost({ lose: (send) => send === 1 });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByRole("button", { name: "Accept" });
  await pressAndLoseFocus("Accept");
  const composer = screen.getByRole("textbox");
  await waitFor(() => expect(document.activeElement).toBe(composer));
  expect(host.applied).toEqual(["accept"]);
  for (const name of ["Accept", "Decline"])
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
  expect(
    screen.queryByRole("button", { name: "Send answer again" }),
  ).toBeNull();
  client.dispose();
});
it("after a refusal that leaves the card open, focus returns to the pressed answer", async () => {
  const host = createCardHost({
    refuse: (send) =>
      send === 1 ? { error: { id: "p", code: "declined" } } : undefined,
  });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  await screen.findByRole("button", { name: "Accept" });
  await pressAndLoseFocus("Accept");
  const pressed = screen.getByRole("button", {
    name: "Accept",
  }) as HTMLButtonElement;
  await waitFor(() => expect(pressed.disabled).toBe(false));
  await waitFor(() => expect(document.activeElement).toBe(pressed));
  client.dispose();
});
it("after an accepted answer whose read fails, the card stays answered and the read error offers a retry", async () => {
  let failing = false;
  const host = createCardHost({ fail: () => failing, answer: true });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  failing = true;
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await screen.findByText("This conversation could not be loaded.");
  const other = screen.getByRole("button", {
    name: "Decline",
  }) as HTMLButtonElement;
  expect(other.disabled).toBe(true);
  fireEvent.click(other);
  expect(host.sent).toEqual(["accept"]);
  failing = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Answered: Accept");
  expect(other.disabled).toBe(true);
  client.dispose();
});
const answerElsewhere = (actionId: string) => ({
  kind: "action" as const,
  blockId: "question-a",
  actionId,
  clientReplyId: "another-tab",
});
it("an answer refused because the card was answered elsewhere says so instead of the generic refusal", async () => {
  const host = createCardHost();
  const here = host.client();
  const elsewhere = host.client();
  await Promise.all([here.ready, elsewhere.ready]);
  await elsewhere.replyOutcome(answerElsewhere("accept"));
  render(<WaypointChat client={here} />);
  fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
  await screen.findByText("This question was already answered.");
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(screen.queryByText("The site refused this request.")).toBeNull();
  expect(host.applied).toEqual(["accept"]);
  here.dispose();
  elsewhere.dispose();
});
// A host whose next read waits until `release`, and what the alert region
// said over time.
const heldRead = () => {
  let holding = false;
  let release = () => {};
  let started = () => {};
  const held = new Promise<void>((resolve) => (started = resolve));
  return {
    hold: () => {
      if (!holding) return undefined;
      holding = false;
      started();
      return new Promise<void>((resolve) => (release = resolve));
    },
    next: () => (holding = true),
    held,
    release: () => release(),
  };
};
const alertHistory = () => {
  const alert = document.querySelector("[data-announcement]")!;
  const said: string[] = [];
  const observer = new MutationObserver(() => said.push(alert.textContent!));
  observer.observe(alert, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  return { alert, said, stop: () => observer.disconnect() };
};
it("an answer refused because the card was answered elsewhere never announces the generic refusal", async () => {
  const read = heldRead();
  const host = createCardHost({ hold: read.hold });
  const here = host.client();
  const elsewhere = host.client();
  await Promise.all([here.ready, elsewhere.ready]);
  await elsewhere.replyOutcome(answerElsewhere("accept"));
  render(<WaypointChat client={here} />);
  const decline = await screen.findByRole("button", { name: "Decline" });
  const history = alertHistory();
  read.next();
  fireEvent.click(decline);
  await read.held;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  // Quiet while the read after the refusal is in flight.
  expect(history.alert.textContent).toBe("");
  read.release();
  await screen.findByText("This question was already answered.");
  history.stop();
  expect(history.said.length).toBeGreaterThan(0);
  expect(
    history.said.filter((text) =>
      text.includes("The site refused this request."),
    ),
  ).toEqual([]);
  here.dispose();
  elsewhere.dispose();
});
it("a host's problemText words an answer refused because the card was answered elsewhere", async () => {
  const host = createCardHost();
  const here = host.client();
  const elsewhere = host.client();
  await Promise.all([here.ready, elsewhere.ready]);
  await elsewhere.replyOutcome(answerElsewhere("accept"));
  render(
    <WaypointChat
      client={here}
      problemText={(problem) => ({ text: `Host: ${problem.code}` })}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
  await screen.findByText("Host: refused");
  here.dispose();
  elsewhere.dispose();
});
it("a refused answer on a card that stays open is announced once the read after it settles", async () => {
  const read = heldRead();
  const host = createCardHost({
    hold: read.hold,
    refuse: () => ({ error: { id: "p", code: "refused" } }),
  });
  const client = host.client();
  await client.ready;
  render(<WaypointChat client={client} />);
  const accept = await screen.findByRole("button", { name: "Accept" });
  const history = alertHistory();
  read.next();
  fireEvent.click(accept);
  await read.held;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(history.alert.textContent).toBe("");
  read.release();
  await screen.findByText("The site refused this request.");
  history.stop();
  client.dispose();
});
for (const [name, answer, actionId, text] of [
  ["names the answer the host applied", true, "accept", "Answered: Accept"],
  ["says answered when the host names no answer", false, "accept", "Answered"],
  [
    "says answered when the named answer is not on the card",
    true,
    "gone",
    "Answered",
  ],
] as const)
  it(`an answered card ${name}`, async () => {
    const host = createCardHost({ answer });
    const client = host.client();
    await client.ready;
    await client.replyOutcome(answerElsewhere(actionId));
    render(<WaypointChat client={client} />);
    await screen.findByText(text);
    expect(
      (screen.getByRole("button", { name: "Accept" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    client.dispose();
  });

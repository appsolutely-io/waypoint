// A chat showing one user and one assistant message, whose sends never
// settle unless the test says otherwise.
import { render } from "@testing-library/react";
import { WaypointChat } from "../../src/react/index";
import { createWaypointClient } from "../../src/core/client";
import { config } from "./client";

const GREETING = [
  { id: "u", role: "user", content: "Hello", blocks: [], createdAt: 1 },
  {
    id: "a",
    role: "assistant",
    content: "Hi there",
    blocks: [],
    createdAt: 2,
    status: "completed",
  },
];
export async function showGreeting(
  extra: Record<string, unknown> = {},
  send: () => Promise<unknown> = () => new Promise(() => {}),
  messages: object[] = GREETING,
) {
  const base = config();
  const client = createWaypointClient({
    ...base,
    transport: {
      ...base.transport,
      read: async (id: string) => ({
        protocol: "1.0",
        id,
        title: id,
        messages,
      }),
      send: send as never,
    },
  } as never);
  await client.ready;
  render(<WaypointChat client={client} {...extra} />);
  return client;
}

import { seedTurn } from "./copy";
import type { Conversation } from "../src/protocol/generated";

export async function seed(fixtureUrl: string) {
  const sessionResponse = await fetch(`${fixtureUrl}/__conformance/session`, {
    method: "POST",
  });
  const session = (await sessionResponse.json()) as {
    csrf: string;
    session: string;
  };
  const post = async (path: string, body: object) => {
    const response = await fetch(fixtureUrl + path, {
      method: "POST",
      headers: {
        Cookie: `waypoint=${session.session}`,
        "X-CSRF-Token": session.csrf,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ protocol: "1.1", ...body }),
    });
    if (!response.ok) throw new Error("Preview data unavailable");
    return response.json();
  };
  for (const [title, count] of [
    ["Local preview", 2],
    ["Saved requests", 1],
    ["A longer conversation", 24],
  ] as const) {
    const conversation = (await post("/conversations", {
      title,
    })) as Conversation;
    for (let at = 0; at < count; at++) {
      const { content, question } = seedTurn(
        at,
        title === "A longer conversation",
      );
      await post("/__conformance/script", { turns: [{ content }] });
      await post(`/conversations/${conversation.id}/messages`, {
        clientMessageId: `seed-${conversation.id}-${at}`,
        content: question,
      });
    }
  }
}

import { it, expect } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import { createWaypointClient } from "../../src/core/client";
import { createSseTransport, type StreamPort } from "../../src/core/transports";
import type { HttpRequest } from "../../src/conformance/index";
import { platform } from "../support/client";

const until = async (check: () => boolean, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not reached");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

it("a host that ends the bound stream gets a new stream under the new agreement, with no native retry of the old URL", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const session = (await (
      await fetch(host.url + "/__conformance/session", { method: "POST" })
    ).json()) as { session: string; csrf: string };
    const auth = {
      Cookie: `waypoint=${session.session}`,
      "X-CSRF-Token": session.csrf,
    };
    const request: HttpRequest = async (path, init) => {
      const response = await fetch(host.url + path, {
        method: init?.method,
        body: init?.body,
        headers: { ...auth, ...init?.headers },
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
    const conversation = (await request("/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ protocol: "1.0", title: "Live" }),
    })) as { body: { id: string } };
    // An EventSource-like port: after an error it retries the same URL
    // itself unless it was closed first.
    const opened: string[] = [];
    let nativeRetries = 0;
    let live = 0;
    const port: StreamPort = {
      subscribe(path, onChunk, onStatus) {
        let closed = false;
        let abort = () => {};
        const open = async (retry: boolean) => {
          if (closed) return;
          if (retry) nativeRetries++;
          opened.push(path);
          const controller = new AbortController();
          abort = () => controller.abort();
          try {
            const response = await fetch(host.url + path, {
              headers: { ...auth, Accept: "text/event-stream" },
              signal: controller.signal,
            });
            if (response.status !== 200 || !response.body)
              throw new Error("stream refused");
            onStatus("open");
            live++;
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              onChunk(decoder.decode(value, { stream: true }));
            }
            live--;
            throw new Error("stream ended");
          } catch {
            if (closed) return;
            onStatus("reconnecting");
            setTimeout(() => void open(true), 0);
          }
        };
        void open(false);
        return () => {
          closed = true;
          abort();
        };
      },
    };
    const client = createWaypointClient({
      accountId: "account-a",
      conversationId: conversation.body.id,
      platform,
      transport: createSseTransport(request, port),
    });
    await client.ready;
    await until(() => live === 1);
    expect(opened).toEqual([
      `/conversations/${conversation.body.id}/stream?waypointAgreement=agreement-1`,
    ]);
    // The host ends every agreement and its open streams.
    await request("/__conformance/agreements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "reset" }),
    });
    await until(() => live === 1 && opened.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(opened[1]).toBe(
      `/conversations/${conversation.body.id}/stream?waypointAgreement=agreement-2`,
    );
    expect(nativeRetries).toBe(0);
    expect(client.getSnapshot().status).toBe("open");
    client.dispose();
  } finally {
    await host.close();
  }
});

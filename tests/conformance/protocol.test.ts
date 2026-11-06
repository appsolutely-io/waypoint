import { it, expect } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import { runConformance } from "../../src/conformance/index";
import type { Conversation } from "../../src/protocol/generated";
for (const fault of [
  undefined,
  "version",
  "dedupe",
  "failure",
  "fallback",
  "refetch",
  "binding",
  "shared-answer",
  "second-answer",
  "wrong-answer",
  "malformed-answer",
  "null-answer",
] as const)
  it(`HTTP protocol ${fault ?? "clean"}`, async () => {
    const host = await createFixtureServer({ testMode: true, fault });
    try {
      const result = await runConformance({
        baseUrl: host.url,
        request: async (path, init) => {
          const response = await fetch(host.url + path, init);
          return { status: response.status, body: await response.json() };
        },
        profile: "admin-host",
      });
      expect(result.passed, result.failures.join(",")).toBe(
        fault === undefined,
      );
    } finally {
      await host.close();
    }
  });
for (const fault of ["reordered-answer", "extended-answer"] as const)
  it(`a host whose card answer is ${fault === "reordered-answer" ? "in another key order" : "extended by an allowed field"} conforms`, async () => {
    const host = await createFixtureServer({ testMode: true, fault });
    try {
      const result = await runConformance({
        baseUrl: host.url,
        profile: "admin-host",
        request: async (path, init) => {
          const r = await fetch(host.url + path, init);
          return { status: r.status, body: await r.json() };
        },
      });
      expect(result.passed, result.failures.join(", ")).toBe(true);
    } finally {
      await host.close();
    }
  });
it("test-only endpoints are absent outside test mode", async () => {
  const host = await createFixtureServer({ testMode: false });
  try {
    for (const path of [
      "/__conformance/session",
      "/__conformance/script",
      "/__conformance/agreements",
    ])
      expect((await fetch(host.url + path, { method: "POST" })).status).toBe(
        404,
      );
  } finally {
    await host.close();
  }
});
it("keeps the complete ordinary protocol suite working with a 1.0-only peer", async () => {
  const host = await createFixtureServer({ testMode: true, protocol: "1.0" });
  try {
    const result = await runConformance({
      baseUrl: host.url,
      profile: "admin-host",
      request: async (path, init) => {
        const r = await fetch(host.url + path, init);
        return { status: r.status, body: await r.json() };
      },
    });
    expect(result.passed, result.failures.join(", ")).toBe(true);
    expect(result.scenarios).not.toContain("form creation replay");
  } finally {
    await host.close();
  }
});
it("uses negotiated 1.1 for ordinary conversation reads and stream frames", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const session = await fetch(host.url + "/__conformance/session", {
      method: "POST",
    }).then((r) => r.json());
    const headers = {
      "Content-Type": "application/json",
      Cookie: `waypoint=${session.session}`,
      "X-CSRF-Token": session.csrf,
    };
    const negotiation = await fetch(host.url + "/negotiate", {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "1.0", supported: ["1.1"] }),
    });
    expect(negotiation.status).toBe(200);
    const conversation = await fetch(host.url + "/conversations", {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "1.1", title: "Ordinary" }),
    }).then((r) => r.json());
    const read = await fetch(`${host.url}/conversations/${conversation.id}`, {
      headers,
    }).then((r) => r.json());
    const stream = await fetch(
      `${host.url}/conversations/${conversation.id}/stream`,
      { headers },
    ).then((r) => r.json());
    expect(read.protocol).toBe("1.1");
    expect(stream.protocol).toBe("1.1");
  } finally {
    await host.close();
  }
});

it("the reference host refuses an unknown or malformed agreement before admitting anything", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const session = (await (
      await fetch(host.url + "/__conformance/session", { method: "POST" })
    ).json()) as { session: string; csrf: string };
    const headers = {
      "Content-Type": "application/json",
      Cookie: `waypoint=${session.session}`,
      "X-CSRF-Token": session.csrf,
    };
    const call = async (
      path: string,
      init: { method?: string; body?: unknown; agreement?: string } = {},
    ) => {
      const r = await fetch(host.url + path, {
        method: init.method ?? "GET",
        headers: {
          ...headers,
          ...(init.agreement ? { "Waypoint-Agreement": init.agreement } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      });
      return { status: r.status, body: (await r.json()) as never };
    };
    const legacy = await call("/negotiate", {
      method: "POST",
      body: { protocol: "1.0", supported: ["1.0"] },
    });
    expect((legacy.body as { agreementId?: string }).agreementId).toBe(
      undefined,
    );
    const bound = await call("/negotiate", {
      method: "POST",
      body: {
        protocol: "1.0",
        supported: ["1.0"],
        offer: { capabilities: ["plans"] },
      },
    });
    const answer = bound.body as {
      agreementId: string;
      capabilities: string[];
    };
    expect(answer.capabilities).toEqual(["plans"]);
    expect(answer.agreementId).toMatch(/^[A-Za-z0-9-]+$/);
    const created = await call("/conversations", {
      method: "POST",
      body: { protocol: "1.0", title: "Binding" },
    });
    const id = (created.body as { id: string }).id;
    expect((await call(`/conversations/${id}`)).status).toBe(200);
    expect(
      (await call(`/conversations/${id}`, { agreement: answer.agreementId }))
        .status,
    ).toBe(200);
    expect(
      (await call(`/conversations/${id}/stream?waypointAgreement=unknown-a`))
        .status,
    ).toBe(409);
    const unknown = await call(`/conversations/${id}`, {
      agreement: "unknown-a",
    });
    expect(unknown).toEqual({
      status: 409,
      body: { protocol: "1.0", code: "agreement-expired", id: "agreement" },
    });
    expect(
      (await call(`/conversations/${id}`, { agreement: "bad id!" })).status,
    ).toBe(400);
    const refused = await call(`/conversations/${id}/messages`, {
      method: "POST",
      agreement: "unknown-a",
      body: { protocol: "1.0", clientMessageId: "bound-a", content: "Hi" },
    });
    expect(refused.status).toBe(409);
    const read = await call(`/conversations/${id}`);
    expect(
      (read.body as Conversation).messages.some(
        (message) => message.clientMessageId === "bound-a",
      ),
    ).toBe(false);
    expect(
      (
        await call("/__conformance/agreements", {
          method: "POST",
          body: { operation: "reset" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await call(`/conversations/${id}`, { agreement: answer.agreementId }))
        .status,
    ).toBe(409);
  } finally {
    await host.close();
  }
});

it("each reference-host agreement keeps its own negotiated answer", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const session = (await (
      await fetch(host.url + "/__conformance/session", { method: "POST" })
    ).json()) as { session: string; csrf: string };
    const headers = {
      "Content-Type": "application/json",
      Cookie: `waypoint=${session.session}`,
      "X-CSRF-Token": session.csrf,
    };
    const post = async (path: string, body: unknown) =>
      (await (
        await fetch(host.url + path, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).json()) as { agreementId: string; protocol: string; id: string };
    const offer = { capabilities: ["plans", "form-fill"] };
    const a = await post("/negotiate", {
      protocol: "1.0",
      supported: ["1.0"],
      offer,
    });
    const created = await post("/conversations", {
      protocol: "1.0",
      title: "Answers",
    });
    const b = await post("/negotiate", {
      protocol: "1.0",
      supported: ["1.1", "1.0"],
      offer,
    });
    expect([a.protocol, b.protocol]).toEqual(["1.0", "1.1"]);
    const read = async (agreement: string) =>
      (
        (await (
          await fetch(host.url + `/conversations/${created.id}`, {
            headers: { ...headers, "Waypoint-Agreement": agreement },
          })
        ).json()) as { protocol: string }
      ).protocol;
    expect(await read(a.agreementId)).toBe("1.0");
    expect(await read(b.agreementId)).toBe("1.1");
  } finally {
    await host.close();
  }
});
it("a host that answers a changed reply body with 422, as the Idempotency-Key draft does, conforms", async () => {
  const host = await createFixtureServer({
    testMode: true,
    fault: "changed-422",
  });
  try {
    const result = await runConformance({
      baseUrl: host.url,
      profile: "admin-host",
      request: async (path, init) => {
        const r = await fetch(host.url + path, init);
        return { status: r.status, body: await r.json() };
      },
    });
    expect(result.passed, result.failures.join(", ")).toBe(true);
  } finally {
    await host.close();
  }
});

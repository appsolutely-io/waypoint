import { it, expect } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import { runFormFillConformance } from "../../src/conformance/form-fill";
for (const fault of [
  undefined,
  "form-mode",
  "form-fields",
  "form-parent",
  "form-dedupe",
  "form-filter",
  "form-general",
] as const)
  it(`form protocol detects ${fault ?? "clean peer"}`, async () => {
    const host = await createFixtureServer({ testMode: true, fault });
    try {
      const result = await runFormFillConformance(async (path, init) => {
        const r = await fetch(host.url + path, init);
        return { status: r.status, body: await r.json() };
      });
      if (fault === "form-general")
        expect(result.failures).toContain("form refuses general replies");
      expect(result.passed, result.failures.join(", ")).toBe(
        fault === undefined,
      );
    } finally {
      await host.close();
    }
  });
it("does not mistake a global idempotency conflict for form refusal", async () => {
  const host = await createFixtureServer({
    testMode: true,
    fault: "form-general",
  });
  const seen = new Map<string, string>();
  try {
    const result = await runFormFillConformance(async (path, init) => {
      if (path.endsWith("/messages") && init?.body) {
        const body = JSON.parse(String(init.body)) as {
          clientReplyId: string;
          clientMessageId: string;
        };
        for (const id of [body.clientReplyId, body.clientMessageId]) {
          if (seen.has(id) && seen.get(id) !== path)
            return { status: 409, body: { code: "idempotency-conflict" } };
          seen.set(id, path);
        }
      }
      const response = await fetch(host.url + path, init);
      return { status: response.status, body: await response.json() };
    });
    expect(seen.size).toBe(4);
    expect(result.failures).toContain("form refuses general replies");
  } finally {
    await host.close();
  }
});
it("requires a typed form refusal rather than an unrelated server error", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const result = await runFormFillConformance(async (path, init) => {
      if (/\/conversations\/form-[^/]+\/messages$/.test(path))
        return { status: 503, body: { code: "unavailable" } };
      const response = await fetch(host.url + path, init);
      return { status: response.status, body: await response.json() };
    });
    expect(result.failures).toContain("form refuses general replies");
  } finally {
    await host.close();
  }
});

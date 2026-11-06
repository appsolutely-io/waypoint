import { it, expect } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import { runConformance } from "../../src/conformance/index";

const run = async (
  fault?:
    | "ignores-stop"
    | "loses-stopped-text"
    | "no-stop"
    | "stops-once-per-message"
    | "stopped-to-all"
    | "stops-any-version",
) => {
  const host = await createFixtureServer({ testMode: true, fault });
  try {
    return await runConformance({
      baseUrl: host.url,
      profile: "admin-host",
      request: async (path, init) => {
        const response = await fetch(host.url + path, init);
        return { status: response.status, body: await response.json() };
      },
    });
  } finally {
    await host.close();
  }
};

it("a host that stops a reply and keeps its text conforms", async () => {
  const result = await run();
  expect(result.scenarios).toContain("reply stop");
  expect(result.passed, result.failures.join(", ")).toBe(true);
});

it("a host that offers reply-stop and keeps writing fails", async () => {
  const result = await run("ignores-stop");
  expect(result.failures).toEqual(["reply stop"]);
});

it("a host that blanks the stopped reply fails", async () => {
  const result = await run("loses-stopped-text");
  expect(result.failures).toEqual(["reply stop"]);
});

it("a host that does not offer reply-stop is not asked to stop", async () => {
  const result = await run("no-stop");
  expect(result.scenarios).not.toContain("reply stop");
  expect(result.passed, result.failures.join(", ")).toBe(true);
});

it("a host that takes only one stop per message fails", async () => {
  // Each version of a reply is stopped with its own id.
  const result = await run("stops-once-per-message");
  expect(result.failures).toEqual(["reply stop"]);
});

it("a host that shows a stopped reply as stopped to a client without reply-stop fails", async () => {
  // Such a client sees it as failed: never as finished, in a status it knows.
  const result = await run("stopped-to-all");
  expect(result.failures).toEqual(["reply stop"]);
});

it("a host that stops a version other than the one a stop names fails", async () => {
  // A stop that arrives late must not stop the version after it.
  const result = await run("stops-any-version");
  expect(result.failures).toEqual(["reply stop"]);
});

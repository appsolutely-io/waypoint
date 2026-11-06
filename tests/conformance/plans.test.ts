import { it, expect } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import { runPlanConformance } from "../../src/conformance/plans";
it("runs planning values, digest confirmation, refusal and undo over HTTP", async () => {
  const host = await createFixtureServer({ testMode: true });
  try {
    const result = await runPlanConformance(async (path, init) => {
      const response = await fetch(host.url + path, init);
      return { status: response.status, body: await response.json() };
    });
    expect(result.failures).toEqual([]);
  } finally {
    await host.close();
  }
});

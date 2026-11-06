import { it, expect, vi, afterEach } from "vitest";
afterEach(() => {
  vi.doUnmock("../../src/conformance/run");
  vi.resetModules();
});
it("the conformance runners reject with the fixed retryable problem when their code cannot load, then load on retry", async () => {
  vi.resetModules();
  vi.doMock("../../src/conformance/run", () => {
    throw new Error("chunk unavailable");
  });
  const conformance = await import("../../src/conformance/index");
  const request = async () => ({ status: 503, body: null });
  const fixed = { code: "retryable", id: "conformance-load" };
  await expect(
    conformance.runConformance({
      baseUrl: "http://host.invalid",
      request,
      profile: "app-host",
    }),
  ).rejects.toEqual(fixed);
  await expect(conformance.runPlanConformance(request)).rejects.toEqual(fixed);
  await expect(conformance.runFormFillConformance(request)).rejects.toEqual(
    fixed,
  );
  expect(conformance.CONFORMANCE_UNAVAILABLE).toEqual(fixed);
  vi.doUnmock("../../src/conformance/run");
  const result = await conformance.runConformance({
    baseUrl: "http://host.invalid",
    request,
    profile: "app-host",
  });
  expect(result.passed).toBe(false);
});

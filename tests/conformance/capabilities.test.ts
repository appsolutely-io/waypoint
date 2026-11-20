import { expect, it } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import {
  runConformance,
  type ConformanceConfig,
  type HttpResult,
} from "../../src/conformance/index";

type Selection = {
  profile?: ConformanceConfig["profile"];
  plans?: boolean;
  protocol?: string;
  form?: boolean;
  malformed?: unknown;
  brokenPlans?: boolean;
  unsolicitedPlans?: boolean;
};
async function run(options: Selection = {}) {
  const host = await createFixtureServer({ testMode: true });
  const offers: string[][] = [];
  const planRequests: string[] = [];
  const formRequests: string[] = [];
  try {
    const result = await runConformance({
      baseUrl: host.url,
      ...(options.profile && { profile: options.profile }),
      request: async (path, init) => {
        const body = init?.body
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
        if (
          path.startsWith("/plans/") ||
          (path === "/__conformance/script" && body?.planScenario)
        ) {
          planRequests.push(path);
          if (options.brokenPlans) return { status: 500, body: {} };
        }
        if (path === "/conversations" && body?.mode === "form-fill")
          formRequests.push(path);
        if (path === "/negotiate")
          offers.push(
            (body?.offer as { capabilities?: string[] } | undefined)
              ?.capabilities ?? [],
          );
        const response = await fetch(host.url + path, init);
        const value: HttpResult = {
          status: response.status,
          body: await response.json(),
        };
        if (path !== "/negotiate") return value;
        if (options.malformed !== undefined)
          return { status: 200, body: options.malformed };
        const peer = value.body as { protocol: string; capabilities: string[] };
        if (options.protocol) peer.protocol = options.protocol;
        if (options.plans === false)
          peer.capabilities = peer.capabilities.filter(
            (capability) => capability !== "plans",
          );
        if (options.form === false)
          peer.capabilities = peer.capabilities.filter(
            (capability) => capability !== "form-fill",
          );
        if (options.unsolicitedPlans && !peer.capabilities.includes("plans"))
          peer.capabilities.push("plans");
        return value;
      },
    });
    return { result, offers, planRequests, formRequests };
  } finally {
    await host.close();
  }
}
it("a host without plans passes without any plan endpoint request", async () => {
  const h = await run({ plans: false });
  expect(h.result.passed, h.result.failures.join(", ")).toBe(true);
  expect(h.planRequests).toEqual([]);
  expect(h.result.scenarios).not.toContain("plan run");
  expect(h.result.skipped).toEqual(
    expect.arrayContaining(["plan run", "plan refuse"]),
  );
});
it("offered and negotiated plans run and detect a broken plan host", async () => {
  const h = await run({ brokenPlans: true });
  expect(h.offers[0]).toContain("plans");
  expect(h.planRequests.length).toBeGreaterThan(0);
  expect(h.result.passed).toBe(false);
  expect(h.result.failures).toContain("plan run");
});
it("admin-host offers the implemented plan scenarios", async () => {
  const h = await run({ profile: "admin-host" });
  expect(h.offers[0]).toContain("plans");
  expect(h.result.passed, h.result.failures.join(", ")).toBe(true);
  expect(h.result.scenarios).toContain("plan run");
});
it("app-host omits plan scenarios and reports their skipped names", async () => {
  const h = await run({ profile: "app-host" });
  expect(
    h.offers.every(
      (offer) =>
        !offer.some((capability) =>
          [
            "plans",
            "plan-recovery",
            "plan-leave",
            "plan-keep",
            "step-up",
            "scheduled",
          ].includes(capability),
        ),
    ),
  ).toBe(true);
  expect(h.planRequests).toEqual([]);
  expect(h.result.passed, h.result.failures.join(", ")).toBe(true);
  expect(h.result.skipped).toEqual(
    expect.arrayContaining(["plan run", "plan refuse"]),
  );
});
it("unsolicited plans not offered by the profile are skipped", async () => {
  const h = await run({ profile: "app-host", unsolicitedPlans: true });
  expect(h.planRequests).toEqual([]);
  expect(h.result.skipped).toEqual(
    expect.arrayContaining(["plan run", "plan refuse"]),
  );
});
it.each([
  null,
  {},
  { protocol: "1.0", capabilities: [5] },
  { protocol: "9.0", capabilities: ["plans"] },
])(
  "malformed negotiation fails without plan writes (%j)",
  async (malformed) => {
    const h = await run({ malformed });
    expect(h.result.passed).toBe(false);
    expect(h.result.failures).toContain("negotiation");
    expect(h.planRequests).toEqual([]);
    expect(h.formRequests).toEqual([]);
  },
);
it.each([{ form: false }, { protocol: "1.0" }])(
  "form-fill scenarios require their negotiated capability and protocol (%j)",
  async (options) => {
    const h = await run({ ...options, plans: false });
    expect(h.formRequests).toEqual([]);
    expect(h.result.scenarios).not.toContain("form creation replay");
    expect(h.result.skipped).toContain("form creation replay");
  },
);
it("legacy default fixture runs all its existing scenarios", async () => {
  const h = await run();
  expect(h.result.passed, h.result.failures.join(", ")).toBe(true);
  expect(h.result.scenarios).toEqual(
    expect.arrayContaining([
      "negotiation",
      "optimistic replay",
      "form creation replay",
      "reply stop",
      "plan run",
      "plan refuse",
    ]),
  );
  expect(h.result.skipped).toEqual([]);
});

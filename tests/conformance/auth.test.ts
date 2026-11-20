import { expect, it, vi } from "vitest";
import { createFixtureServer } from "../../fixtures/server/index";
import {
  runConformance,
  runPlanConformance,
  runFormFillConformance,
  type ConformanceAuthOptions,
  type ConformanceResult,
  type HttpRequest,
} from "../../src/conformance/index";

const AUTH = "synthetic-session-credential";
const BOOTSTRAP = "synthetic-bootstrap-credential";
const runners: [
  string,
  (
    request: HttpRequest,
    options?: ConformanceAuthOptions,
  ) => Promise<ConformanceResult>,
][] = [
  [
    "main",
    (request, options) =>
      runConformance({ baseUrl: "https://example.test", request, ...options }),
  ],
  ["plans", runPlanConformance],
  ["forms", runFormFillConformance],
];
function header(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  return Object.entries(headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}
async function service(
  sessionBody: (legacy: Record<string, string>) => unknown,
  expected: Record<string, string>,
  body: (
    request: HttpRequest,
    counters: { calls: number; wrong: number; sessions: number },
  ) => Promise<void>,
) {
  const host = await createFixtureServer({ testMode: true });
  const counters = { calls: 0, wrong: 0, sessions: 0 };
  let legacy: Record<string, string> = {};
  const request: HttpRequest = async (path, init) => {
    if (path === "/__conformance/session") {
      counters.sessions++;
      const response = await fetch(host.url + path, { method: "POST" });
      legacy = (await response.json()) as Record<string, string>;
      return { status: response.status, body: sessionBody(legacy) };
    }
    counters.calls++;
    const names = Object.keys(init?.headers ?? {}).map((name) =>
      name.toLowerCase(),
    );
    if (
      new Set(names).size !== names.length ||
      Object.entries(expected).some(
        ([name, value]) => header(init?.headers, name) !== value,
      )
    )
      counters.wrong++;
    if (
      !("cookie" in expected) &&
      header(init?.headers, "cookie") !== undefined
    )
      counters.wrong++;
    const response = await fetch(host.url + path, {
      ...init,
      headers: {
        ...init?.headers,
        cookie: `waypoint=${legacy.session}`,
        "x-csrf-token": legacy.csrf!,
      },
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    await body(request, counters);
  } finally {
    await host.close();
  }
}
for (const [name, run] of runners) {
  it(`host session headers authenticate every runner (${name})`, async () => {
    await service(
      () => ({ headers: { "X-Host-Auth": AUTH } }),
      { "x-host-auth": AUTH },
      async (request, count) => {
        const result = await run(request);
        expect(result.passed, "authenticated scenarios pass").toBe(true);
        expect(count.calls > 0, "scenarios executed").toBe(true);
        expect(
          count.wrong,
          "all requests use host credentials without legacy cookies",
        ).toBe(0);
      },
    );
  });
  it(`an empty host header map does not fabricate credentials (${name})`, async () => {
    await service(
      (legacy) => ({ ...legacy, headers: {} }),
      {},
      async (request, count) => {
        expect(
          (await run(request)).passed,
          "empty header sessions can execute",
        ).toBe(true);
        expect(count.calls > 0).toBe(true);
        expect(count.wrong, "no fabricated cookie").toBe(0);
      },
    );
  });
  it(`custom authentication supports an opaque session (${name})`, async () => {
    const opaque = { ticket: "opaque-session" };
    const authenticate = vi.fn(async (value: unknown) => {
      expect(value === opaque, "callback receives the opaque session").toBe(
        true,
      );
      return { "X-Host-Auth": AUTH };
    });
    await service(
      () => opaque,
      { "x-host-auth": AUTH },
      async (request, count) => {
        expect(
          (await run(request, { authenticate })).passed,
          "custom-authenticated scenarios pass",
        ).toBe(true);
        expect(
          authenticate.mock.calls.length,
          "each runner session is authenticated",
        ).toBe(count.sessions);
        expect(count.wrong).toBe(0);
      },
    );
  });
  it(`legacy conformance credentials remain unchanged (${name})`, async () => {
    await service(
      (legacy) => legacy,
      { cookie: "waypoint=fixture-session", "x-csrf-token": "fixture-csrf" },
      async (request, count) => {
        expect((await run(request)).passed, "legacy scenarios pass").toBe(true);
        expect(count.wrong, "legacy cookie and CSRF preserved").toBe(0);
      },
    );
  });
  it(`authentication headers merge without case duplicates (${name})`, async () => {
    await service(
      () => ({ headers: { "X-Host-Auth": AUTH } }),
      { "x-host-auth": AUTH, "x-bootstrap": BOOTSTRAP },
      async (request, count) => {
        let bootstrap = 0;
        const observed: HttpRequest = async (path, init) => {
          if (
            path === "/__conformance/session" &&
            header(init?.headers, "x-bootstrap") === BOOTSTRAP
          )
            bootstrap++;
          return request(path, init);
        };
        expect(
          (
            await run(observed, {
              headers: {
                "x-host-auth": BOOTSTRAP,
                "X-Bootstrap": BOOTSTRAP,
                "waypoint-step": "wrong-step",
              },
            })
          ).passed,
          "runner protocol headers override defaults",
        ).toBe(true);
        expect(bootstrap, "bootstrap authenticates all session requests").toBe(
          count.sessions,
        );
        expect(count.wrong, "case-insensitive override").toBe(0);
      },
    );
  });
  it(`malformed conformance auth fails without leaking its values (${name})`, async () => {
    const marker = "synthetic-unsafe-credential";
    const request = vi.fn<HttpRequest>(async () => ({
      status: 200,
      body: {
        session: "valid-legacy-session",
        csrf: "valid-legacy-csrf",
        headers: { "X-Bad": marker + "\r\n" },
      },
    }));
    const result = await run(request);
    expect(result.passed).toBe(false);
    expect(
      request.mock.calls.length,
      "invalid explicit headers never fall back or write scenarios",
    ).toBe(1);
    expect(
      JSON.stringify(result).includes(marker),
      "safe result excludes credential",
    ).toBe(false);
  });
}
it("conformance auth reads only own data properties without invoking accessors", async () => {
  let invoked = 0;
  const session = Object.defineProperty(
    { session: "valid", csrf: "valid" },
    "headers",
    {
      enumerable: true,
      get() {
        invoked++;
        throw new Error("synthetic-sensitive-error");
      },
    },
  );
  const request = vi.fn<HttpRequest>(async () => ({
    status: 200,
    body: session,
  }));
  const result = await runConformance({
    baseUrl: "https://example.test",
    request,
  });
  expect(result.passed).toBe(false);
  expect(invoked).toBe(0);
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.stringify(result).includes("synthetic-sensitive-error")).toBe(
    false,
  );
});
it("invalid bootstrap headers fail before any request", async () => {
  const request = vi.fn<HttpRequest>();
  const result = await runConformance({
    baseUrl: "https://example.test",
    request,
    headers: { "Bad Header": BOOTSTRAP },
  });
  expect(result.passed).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
it("a rejected authentication callback produces a safe setup failure", async () => {
  const marker = "synthetic-callback-credential";
  const request = vi.fn<HttpRequest>(async () => ({ status: 200, body: {} }));
  const result = await runConformance({
    baseUrl: "https://example.test",
    request,
    authenticate: async () => {
      throw new Error(marker);
    },
  });
  expect(result.passed).toBe(false);
  expect(request).toHaveBeenCalledOnce();
  expect(JSON.stringify(result).includes(marker)).toBe(false);
});

for (const [name, run] of runners) {
  it(`adapter errors never expose credentials through conformance results (${name})`, async () => {
    await service(
      () => ({ headers: {} }),
      {},
      async (request) => {
        const guarded: HttpRequest = async (path, init) => {
          if (path === "/conversations") throw new Error(AUTH);
          return request(path, init);
        };
        const result = await run(guarded);
        expect(result.passed, "adapter failure is reported").toBe(false);
        expect(
          JSON.stringify(result).includes(AUTH),
          "safe failure result",
        ).toBe(false);
      },
    );
  });
}

for (const [name, run] of runners) {
  it(`prototype-like header names remain own string values (${name})`, async () => {
    const headers = Object.fromEntries([
      ["__proto__", AUTH],
      ["constructor", BOOTSTRAP],
    ]);
    await service(
      () => ({ headers }),
      headers,
      async (request, count) => {
        expect((await run(request)).passed).toBe(true);
        expect(count.wrong, "every valid own header is preserved").toBe(0);
      },
    );
  });
}

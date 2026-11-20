import { expect, it } from "vitest";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFixtureServer } from "../../fixtures/server/index";

const BOOTSTRAP = "synthetic-cli-bootstrap";
const AUTH = "synthetic-cli-session";
const COOKIE = "synthetic-cli-cookie";
const HEADERS = { "X-Bootstrap": BOOTSTRAP };
const root = new URL("../../", import.meta.url);
function execute(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", ...args],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 15000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new Error("CLI process could not start"));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Loopback listener unavailable");
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) =>
          error ? reject(new Error("Loopback close failed")) : resolve(),
        ),
      );
    },
  };
}
async function fixture(
  options: {
    auth?: boolean;
    failing?: boolean;
    redirectStatus?: number;
    crossAt?: "session" | "read" | "write";
  } = {},
) {
  const host = await createFixtureServer({ testMode: true });
  let foreignRequests = 0;
  const foreign = await listen((_request, response) => {
    foreignRequests++;
    response.setHeader("Content-Type", "application/json");
    response.end("{}");
  });
  const seen = {
    requests: 0,
    sessions: 0,
    authenticated: 0,
    failedReplay: 0,
    hops: 0,
    preserved: 0,
    changed: 0,
    get: 0,
  };
  const acknowledgements = new Map<string, { status: number; text: string }>();
  const initialBodies = new Map<string, string>();
  const proxy = await listen((request, response) => {
    void (async () => {
      seen.requests++;
      const url = new URL(request.url!, "http://127.0.0.1");
      const rawPath = url.pathname + url.search;
      const hop = rawPath.startsWith("/hop/");
      const path = hop ? rawPath.slice(4) : rawPath;
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const content = Buffer.concat(chunks).toString("utf8");
      const send = (status: number, text: string) => {
        response.statusCode = status;
        response.setHeader("Content-Type", "application/json");
        response.end(text);
      };
      if (rawPath.startsWith("/ack/")) {
        if (request.method === "GET" && !content) seen.changed++;
        const value = acknowledgements.get(rawPath);
        send(value?.status ?? 500, value?.text ?? "{}");
        return;
      }
      if (options.auth) {
        const bootstrap = request.headers["x-bootstrap"] === BOOTSTRAP;
        const authenticated =
          request.headers.authorization === AUTH &&
          request.headers.cookie === COOKIE;
        if (
          !bootstrap ||
          (path !== "/__conformance/session" && !authenticated)
        ) {
          send(401, "{}");
          return;
        }
        if (path === "/__conformance/session") seen.sessions++;
        else seen.authenticated++;
      }
      const category =
        path === "/__conformance/session"
          ? "session"
          : request.method === "GET" && path.startsWith("/conversations/")
            ? "read"
            : request.method === "POST" && path === "/conversations"
              ? "write"
              : undefined;
      if (hop) {
        seen.hops++;
        if (options.crossAt === category) {
          response.statusCode = 307;
          response.setHeader("Location", foreign.url + "/receiver");
          response.end();
          return;
        }
        if (request.method === "POST" && content === initialBodies.get(path))
          seen.preserved++;
        if (request.method === "GET") seen.get++;
      }
      const forward = async () => {
        if (options.auth && path === "/__conformance/session")
          return {
            status: 200,
            text: JSON.stringify({
              headers: { Authorization: AUTH, Cookie: COOKIE },
            }),
          };
        if (
          options.failing &&
          request.method === "POST" &&
          /\/messages$/.test(path) &&
          JSON.parse(content).clientMessageId === "replay-a"
        ) {
          seen.failedReplay++;
          return {
            status: 200,
            text: JSON.stringify({
              id: `different-${seen.failedReplay}`,
              echo: [BOOTSTRAP, AUTH, COOKIE],
            }),
          };
        }
        const headers = {
          ...request.headers,
          host: undefined,
          "content-length": undefined,
          connection: undefined,
        };
        const selected = Object.fromEntries(
          Object.entries(headers).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
        if (options.auth) {
          selected.cookie = "waypoint=fixture-session";
          selected["x-csrf-token"] = "fixture-csrf";
        }
        const upstream = await fetch(host.url + path, {
          method: request.method,
          headers: selected,
          ...(content && { body: content }),
        });
        return { status: upstream.status, text: await upstream.text() };
      };
      if (
        !hop &&
        category &&
        (options.redirectStatus || options.crossAt === category)
      ) {
        const status = options.redirectStatus ?? 307;
        if ([301, 302, 303].includes(status) && request.method === "POST") {
          const value = await forward();
          const target = `/ack/${acknowledgements.size}`;
          acknowledgements.set(target, value);
          response.statusCode = status;
          response.setHeader("Location", target);
          response.end();
          return;
        }
        initialBodies.set(path, content);
        response.statusCode = status;
        response.setHeader("Location", "/hop" + path);
        response.end();
        return;
      }
      const value = await forward();
      send(value.status, value.text);
    })().catch(() => {
      response.statusCode = 500;
      response.end("{}");
    });
  });
  return {
    url: proxy.url,
    seen,
    foreignRequests: () => foreignRequests,
    async close() {
      await proxy.close();
      await foreign.close();
      await host.close();
    },
  };
}
async function withHeaders(
  body: (file: string) => Promise<void>,
  contents = JSON.stringify(HEADERS),
) {
  const directory = await mkdtemp(join(tmpdir(), "waypoint-cli-"));
  const file = join(directory, "headers.json");
  try {
    await writeFile(file, contents, { encoding: "utf8", mode: 0o600 });
    await body(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
function resultOf(stdout: string): {
  passed: boolean;
  failures: string[];
  scenarios: string[];
} {
  try {
    return JSON.parse(stdout) as {
      passed: boolean;
      failures: string[];
      scenarios: string[];
    };
  } catch {
    throw new Error("CLI did not emit its safe JSON result");
  }
}
function noCredentials(stdout: string, stderr: string) {
  for (const marker of [BOOTSTRAP, AUTH, COOKIE])
    expect(
      (stdout + stderr).includes(marker),
      "output excludes the supplied credential",
    ).toBe(false);
}
it("CLI header files authenticate the test session and scenarios", async () => {
  const host = await fixture({ auth: true });
  try {
    await withHeaders(async (file) => {
      const output = await execute([host.url, "--headers-file", file]);
      expect(output.code, "authenticated CLI succeeds").toBe(0);
      expect(resultOf(output.stdout).passed).toBe(true);
      expect(
        host.seen.sessions > 0,
        "bootstrap authenticated session setup",
      ).toBe(true);
      expect(
        host.seen.authenticated > 0,
        "session headers authenticated scenarios",
      ).toBe(true);
      noCredentials(output.stdout, output.stderr);
    });
  } finally {
    await host.close();
  }
}, 20000);
it("a failing conformance scenario never prints supplied credentials", async () => {
  const host = await fixture({ auth: true, failing: true });
  try {
    await withHeaders(async (file) => {
      const output = await execute([host.url, "--headers-file", file]);
      expect(output.code !== 0).toBe(true);
      expect(host.seen.authenticated > 0, "authentication completed").toBe(
        true,
      );
      expect(host.seen.failedReplay, "enabled replay scenario executed").toBe(
        2,
      );
      const result = resultOf(output.stdout);
      expect(result.passed).toBe(false);
      expect(result.failures.includes("optimistic replay")).toBe(true);
      expect(result.scenarios.includes("optimistic replay")).toBe(true);
      expect(
        Object.keys(result).every((key) =>
          ["passed", "failures", "scenarios", "skipped"].includes(key),
        ),
        "fixed safe result shape",
      ).toBe(true);
      noCredentials(output.stdout, output.stderr);
      noCredentials(JSON.stringify(result), "");
    });
  } finally {
    await host.close();
  }
}, 20000);
it.each([301, 302, 303, 307, 308])(
  "CLI follows same-origin redirects without changing legacy requests (%s)",
  async (redirectStatus) => {
    const host = await fixture({ redirectStatus });
    try {
      const output = await execute([host.url]);
      expect(output.code, "legacy same-origin CLI succeeds").toBe(0);
      expect(resultOf(output.stdout).passed).toBe(true);
      expect(host.seen.get > 0, "GET redirects remain GET").toBe(true);
      if ([301, 302, 303].includes(redirectStatus))
        expect(host.seen.changed > 0, "POST changes to bodyless GET").toBe(
          true,
        );
      else
        expect(
          host.seen.preserved > 0,
          "POST body survives method-preserving redirect",
        ).toBe(true);
    } finally {
      await host.close();
    }
  },
  20000,
);
it.each(["session", "read", "write"] as const)(
  "header-file credentials are not sent across a redirect (%s)",
  async (crossAt) => {
    const host = await fixture({ auth: true, crossAt });
    try {
      await withHeaders(async (file) => {
        const output = await execute([host.url, "--headers-file", file]);
        expect(output.code !== 0, "cross-origin CLI fails").toBe(true);
        expect(
          host.seen.sessions > 0,
          "intended base request was authenticated",
        ).toBe(true);
        expect(host.seen.hops > 0, "first same-origin hop executed").toBe(true);
        expect(host.foreignRequests(), "no foreign request dispatched").toBe(0);
        noCredentials(output.stdout, output.stderr);
      });
    } finally {
      await host.close();
    }
  },
  20000,
);
it.each(["missing", "malformed", "invalid-header", "unknown-option"])(
  "invalid CLI authentication input fails before making requests (%s)",
  async (kind) => {
    const host = await fixture();
    try {
      await withHeaders(
        async (file) => {
          const args =
            kind === "unknown-option"
              ? [host.url, "--unknown-option"]
              : [
                  host.url,
                  "--headers-file",
                  kind === "missing" ? file + ".missing" : file,
                ];
          const output = await execute(args);
          expect(output.code !== 0).toBe(true);
          expect(
            host.seen.requests,
            "invalid inputs never contact the service",
          ).toBe(0);
          noCredentials(output.stdout, output.stderr);
        },
        kind === "malformed"
          ? "{"
          : kind === "invalid-header"
            ? JSON.stringify({ "Bad Header": BOOTSTRAP })
            : JSON.stringify(HEADERS),
      );
    } finally {
      await host.close();
    }
  },
  20000,
);

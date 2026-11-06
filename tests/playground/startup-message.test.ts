import { expect, it } from "vitest";
import { createServer, type AddressInfo } from "node:net";
import { spawnSync } from "node:child_process";
import { startupMessage } from "../../playground/startup";

it("adds a port hint only for an address conflict", () => {
  expect(
    startupMessage(
      Object.assign(new Error("listen failed"), { code: "EADDRINUSE" }),
      43301,
    ),
  ).toBe("The playground could not start. Check that port 43301 is available.");
});
it("preserves a non-port startup failure message", () => {
  expect(startupMessage(new Error("Preview data unavailable"), 43301)).toBe(
    "The playground could not start: Preview data unavailable",
  );
});

it("reports the selected port when a real listener already occupies it", async () => {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  try {
    const port = (listener.address() as AddressInfo).port;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/playground.mjs"],
      {
        env: { ...process.env, PLAYGROUND_PORT: String(port) },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `The playground could not start. Check that port ${port} is available.`,
    );
    expect(result.stdout).not.toContain("Playground:");
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

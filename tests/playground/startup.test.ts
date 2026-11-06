import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";

for (const value of ["invalid", "43301.5", "1023", "65536", ""]) {
  it(`rejects invalid playground port ${JSON.stringify(value)}`, () => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/playground.mjs"],
      {
        env: { ...process.env, PLAYGROUND_PORT: value },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "The playground could not start: PLAYGROUND_PORT must be an integer from 1024 to 65535\n",
    );
    expect(result.stdout).not.toContain("Playground:");
  });
}

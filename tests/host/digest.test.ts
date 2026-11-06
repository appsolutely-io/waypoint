import { it, expect } from "vitest";
import { createHash } from "node:crypto";
import { sha256Base64Url } from "../../src/host/digest";

it("matches SHA-256 for padding boundaries, several blocks and non-ASCII text", () => {
  const inputs = [
    "",
    "abc",
    "a".repeat(55),
    "a".repeat(56),
    "a".repeat(64),
    "a".repeat(1000),
    "étape ✓ 步骤",
  ];
  for (const input of inputs)
    expect(sha256Base64Url(input), input.slice(0, 8)).toBe(
      createHash("sha256").update(input, "utf8").digest("base64url"),
    );
  expect(sha256Base64Url("abc")).toBe(
    "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0",
  );
});

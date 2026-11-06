import { test } from "node:test";
import assert from "node:assert/strict";
import { forbiddenText } from "../../scripts/privacy.mjs";
test("rejects private vocabulary and numbered work references", () => {
  for (const word of [
    "cl" + "oud",
    "ten" + "ant",
    "host" + "ing",
    "mind" + "cue",
    "the" + "mes",
    "plan " + "123",
  ])
    assert.equal(forbiddenText(word), true);
  assert.equal(forbiddenText("A confirmed request and its inverse"), false);
});

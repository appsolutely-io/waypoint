import { describe, expect, it } from "vitest";
import {
  checkConfirmation,
  confirmationRecord,
  issueConfirmation,
  refusalBody,
  type IssuedConfirmation,
} from "../../src/host/confirmation";

const now = 1_000_000;
const issue = (previous?: IssuedConfirmation, token = "t1") =>
  issueConfirmation(previous, {
    planId: "p",
    conversationId: "c",
    revision: 3,
    now,
    ttl: 600_000,
    token,
  });
const current = { planId: "p", conversationId: "c", revision: 3 };
const check = (
  issued: IssuedConfirmation | undefined,
  token: unknown,
  at = now,
  over: Partial<typeof current> = {},
) => checkConfirmation(issued, { token }, { ...current, ...over }, at);

describe("host-issued confirmations", () => {
  it("CK-H1 a valid token is consumed", () => {
    expect(check(issue(), "t1")).toEqual({ result: "consume" });
  });
  it("CK-H3 a consumed token is refused as used, whichever confirmation presents it", () => {
    expect(check({ ...issue(), consumedBy: "r1" }, "t1")).toEqual({
      result: "refused",
      reason: "used",
    });
  });
  it("CK-H2 an expired token is refused at and after its expiry", () => {
    expect(check(issue(), "t1", now + 599_999)).toEqual({ result: "consume" });
    expect(check(issue(), "t1", now + 600_000)).toEqual({
      result: "refused",
      reason: "expired",
    });
  });
  it("CK-H4 a token for an older revision is refused as stale", () => {
    expect(check(issue(), "t1", now, { revision: 4 })).toEqual({
      result: "refused",
      reason: "stale",
    });
  });
  it("CK-H5 a token for another plan or conversation is refused as mismatched", () => {
    expect(check(issue(), "t1", now, { planId: "q" })).toEqual({
      result: "refused",
      reason: "mismatch",
    });
    expect(check(issue(), "t1", now, { conversationId: "d" })).toEqual({
      result: "refused",
      reason: "mismatch",
    });
    expect(check(issue(), "unknown")).toEqual({
      result: "refused",
      reason: "mismatch",
    });
  });
  it("CK-H5b a confirmation without a token, or with nothing issued, is refused as missing", () => {
    for (const token of [undefined, "", 7])
      expect(check(issue(), token)).toEqual({
        result: "refused",
        reason: "missing",
      });
    expect(check(undefined, "t1")).toEqual({
      result: "refused",
      reason: "missing",
    });
  });
  it("CK-H-reissue a reissue revokes the earlier token (stale) and the new one works", () => {
    const first = issue();
    const second = issue(first, "t2");
    expect(check(second, "t1")).toEqual({ result: "refused", reason: "stale" });
    expect(check(second, "t2")).toEqual({ result: "consume" });
    expect(issue(second, "t3").revoked).toEqual(["t1", "t2"]);
  });
  it("CK-H-order expiry wins over a late consumption, and a consumed token stays used after its expiry", () => {
    expect(check(issue(), "t1", now + 700_000)).toEqual({
      result: "refused",
      reason: "expired",
    });
    expect(
      check({ ...issue(), consumedBy: "r1" }, "t1", now + 700_000),
    ).toEqual({ result: "refused", reason: "used" });
  });
  it("CK-H-lifetime a new record lifetime with the same ids refuses the old token", () => {
    const replaced = issueConfirmation(undefined, {
      planId: "p",
      conversationId: "c",
      revision: 3,
      now,
      ttl: 600_000,
      token: "fresh",
    });
    expect(check(replaced, "t1")).toEqual({
      result: "refused",
      reason: "mismatch",
    });
  });
  it("CK-I-record the record carries the token, its bindings and the host's wording, as copies", () => {
    const wording = {
      heading: "Update 1 record",
      items: [{ label: "a · title", before: '"Before"', after: '"After"' }],
      irreversible: false,
      undo: "No Undo in this version.",
      verificationCount: 0,
    };
    const record = confirmationRecord(issue(), wording);
    expect(record).toEqual({
      token: "t1",
      expiresAt: new Date(now + 600_000).toISOString(),
      planId: "p",
      conversationId: "c",
      revision: 3,
      ...wording,
    });
    wording.items[0]!.label = "changed";
    expect(record.items[0]!.label).toBe("a · title");
  });
  it("CK-H-body a refusal uses the existing problem shape with its typed reason", () => {
    expect(refusalBody("reply-1", "used")).toEqual({
      code: "refused",
      id: "reply-1",
      confirmation: { reason: "used" },
    });
  });
});

import { it, expect, describe } from "vitest";
import {
  createProtectedFixture,
  REPLACEMENT_HISTORY,
} from "../../fixtures/server/protected";
import { pendingAdmissions } from "../../src/host/plan-intents";
import { protectedHost, until } from "../support/protected";

const owner = { principal: "owner" };
function fixture() {
  const host = createProtectedFixture();
  const control = (body: Record<string, unknown>) =>
    host.handle(
      "/__conformance/protected",
      "POST",
      { planId: "p", ...body },
      owner,
      {},
    );
  const create = () =>
    control({ operation: "create", rows: ["a"], conversationId: "c" });
  const accept = async () => {
    const record = (await host.handle("/plans/p", "GET", {}, owner, {}))!
      .body as { confirmation?: { token: string } };
    const reply = await host.handle(
      "/conversations/c/replies",
      "POST",
      {
        kind: "confirm",
        protocol: "1.0",
        clientReplyId: `confirm-${Math.random()}`,
        planId: "p",
        digest: "p-digest-1",
        confirmationToken: record.confirmation?.token,
      },
      owner,
      {},
    );
    return (
      reply!.body as { acceptance: { executionId: string; fence: number } }
    ).acceptance;
  };
  const patch = (acceptance: { executionId: string; fence: number }) =>
    host.handle("/protected-items/a", "PATCH", { title: "After" }, owner, {
      "waypoint-step": "p.0",
      "waypoint-execution": acceptance.executionId,
      "waypoint-fence": String(acceptance.fence),
    });
  const admitted = async () =>
    (
      (await control({ operation: "admitted", stepId: "step-a" }))!.body as {
        admitted: boolean;
      }
    ).admitted;
  return { host, control, create, accept, patch, admitted };
}

describe("the reference host releases the records it drops", () => {
  it("replacing a record with a held admission releases the old one, and the replacement still commits and retries", async () => {
    const f = fixture();
    await f.create();
    const oldAcceptance = await f.accept();
    await f.control({ operation: "hold", boundary: "commit:p" });
    const held = f.patch(oldAcceptance);
    await until(f.admitted);
    const old = f.host.state("p")!;
    expect(pendingAdmissions(old)).toBe(1);
    await f.create();
    expect(pendingAdmissions(old)).toBe(0);
    const acceptance = await f.accept();
    const replacement = f.patch(acceptance);
    await until(f.admitted);
    expect(pendingAdmissions(f.host.state("p")!)).toBe(1);
    await f.control({ operation: "release", boundary: "commit:p" });
    expect((await held)!.status).toBe(409);
    expect(await replacement).toMatchObject({
      status: 200,
      body: { title: "After" },
    });
    expect(pendingAdmissions(f.host.state("p")!)).toBe(0);
    expect(await f.patch(acceptance)).toMatchObject({
      status: 200,
      body: { title: "After" },
    });
    f.host.dispose();
  });
  it("disposal releases a record whose admission is still held, and the held request is refused", async () => {
    const f = fixture();
    await f.create();
    const acceptance = await f.accept();
    await f.control({ operation: "hold", boundary: "commit:p" });
    const held = f.patch(acceptance);
    await until(f.admitted);
    const record = f.host.state("p")!;
    expect(pendingAdmissions(record)).toBe(1);
    f.host.dispose();
    expect(pendingAdmissions(record)).toBe(0);
    await f.control({ operation: "release", boundary: "commit:p" });
    expect((await held)!.status).toBe(409);
    expect(f.host.value("a")).toBe("Before");
  });
});

describe("a committed operation keeps its own result and its own record", () => {
  it("an exact retry returns the stored committed response after the item changed", async () => {
    const f = fixture();
    await f.create();
    const acceptance = await f.accept();
    const first = await f.patch(acceptance);
    expect(first).toMatchObject({ status: 200, body: { title: "After" } });
    const record = f.host.state("p")!;
    // Another plan over the same row resets the item.
    await f.control({
      operation: "create",
      planId: "q",
      rows: ["a"],
      conversationId: "c",
    });
    expect(f.host.value("a")).toBe("Before");
    const again = await f.patch(acceptance);
    expect(again!.status).toBe(200);
    expect(again!.raw ?? JSON.stringify(again!.body)).toBe(
      first!.raw ?? JSON.stringify(first!.body),
    );
    expect(JSON.parse(again!.raw!)).toEqual({ title: "After" });
    expect(f.host.state("p")).toBe(record);
    expect(f.host.value("a")).toBe("Before");
    f.host.dispose();
  });
  it("a request of a replaced record is refused with the replacement's identity", async () => {
    const f = fixture();
    await f.create();
    const old = await f.accept();
    expect((await f.patch(old))!.status).toBe(200);
    await f.create();
    const acceptance = await f.accept();
    expect(acceptance.executionId).not.toBe(old.executionId);
    const before = JSON.stringify(f.host.state("p"));
    const value = f.host.value("a");
    expect(await f.patch(old)).toEqual({
      status: 409,
      body: {
        code: "refused",
        id: "recordReplaced",
        replacement: { planId: "p", generation: f.host.state("p")!.generation },
      },
    });
    expect(f.host.state("p")!.generation).not.toBe("p.g1");
    expect(JSON.stringify(f.host.state("p"))).toBe(before);
    expect(f.host.value("a")).toBe(value);
    expect(await f.patch(acceptance)).toMatchObject({
      status: 200,
      body: { title: "After" },
    });
    f.host.dispose();
  });
});

describe("replacement history is bounded and freed", () => {
  it("keeps the last replacements, refuses older ones as stale and forgets all on disposal", async () => {
    const f = fixture();
    const issued: { executionId: string; fence: number }[] = [];
    for (let i = 0; i <= REPLACEMENT_HISTORY + 1; i++) {
      await f.create();
      issued.push(await f.accept());
    }
    await f.create();
    const replaced = (acceptance: { executionId: string; fence: number }) =>
      f.patch(acceptance).then((reply) => (reply!.body as { id: string }).id);
    // The newest replacements still name their replacement.
    const recent = issued.slice(-REPLACEMENT_HISTORY);
    for (const acceptance of recent)
      expect(await replaced(acceptance)).toBe("recordReplaced");
    // Older ones fall outside the bound and get the stale refusal.
    for (const acceptance of issued.slice(0, -REPLACEMENT_HISTORY))
      expect(await replaced(acceptance)).toBe("staleFence");
    f.host.dispose();
    await f.create();
    for (const acceptance of recent)
      expect(await replaced(acceptance)).toBe("staleFence");
    expect(f.host.state("p")!.generation).toBe("p.g1");
    f.host.dispose();
  });
});

describe("an issued confirmation record never changes", () => {
  it("CK-H-immutable every read returns the record as issued; a change to what it describes revokes it and issues a new one", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["a"],
        conversationId: h.conversation,
      });
      const issued = (await h.read()).confirmation!;
      expect((await h.read()).confirmation).toEqual(issued);
      // Another plan changes the item that this record describes.
      const q = await h.read("plan-q");
      const route = `/conversations/${h.conversation}/replies`;
      const confirm = (record: typeof q, clientReplyId: string) =>
        h.post(route, {
          kind: "confirm",
          protocol: "1.0",
          clientReplyId,
          planId: record.id,
          digest: (record.plan as { digest: string }).digest,
          confirmationToken: record.confirmation?.token,
        });
      const accepted = (await confirm(q, "confirm-q")).body as {
        acceptance: { executionId: string; fence: number };
      };
      await h.request("/protected-items/a", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Step": "plan-q.0",
          "Waypoint-Execution": accepted.acceptance.executionId,
          "Waypoint-Fence": String(accepted.acceptance.fence),
        },
        body: '{"title":"After"}',
      });
      const current = await h.read();
      const reissued = current.confirmation!;
      expect(reissued.token).not.toBe(issued.token);
      expect(reissued.items).toEqual([
        { label: "Item a: title", before: '"After"', after: '"After"' },
      ]);
      expect((await h.read()).confirmation).toEqual(reissued);
      // The revoked record's token no longer confirms anything.
      const old = await confirm(
        { ...current, confirmation: issued },
        "confirm-old",
      );
      expect(old).toMatchObject({
        status: 409,
        body: { confirmation: { reason: "stale" } },
      });
      expect((await h.read()).recovery?.phase).toBe("initial-review");
      // The new record's token accepts the work it describes.
      const fresh = await confirm(current, "confirm-new");
      expect(fresh.status).toBe(200);
      expect(
        (current.plan as { steps: { request: { body: string } }[] }).steps[0]!
          .request.body,
      ).toBe('{"title":"After"}');
    } finally {
      await h.close();
    }
  });
});

describe("a token accepts only the work its record described", () => {
  it("CK-H-apply-stale values changed since issue refuse the token at acceptance, with no read in between; the new record's token accepts exactly the work it words", async () => {
    const h = await protectedHost(["a"]);
    try {
      await h.control({
        operation: "create",
        planId: "plan-q",
        rows: ["a"],
        conversationId: h.conversation,
      });
      const shown = await h.read();
      const q = await h.read("plan-q");
      const route = `/conversations/${h.conversation}/replies`;
      const confirm = (record: typeof q, clientReplyId: string) =>
        h.post(route, {
          kind: "confirm",
          protocol: "1.0",
          clientReplyId,
          planId: record.id,
          digest: (record.plan as { digest: string }).digest,
          confirmationToken: record.confirmation?.token,
        });
      const accepted = (await confirm(q, "confirm-q")).body as {
        acceptance: { executionId: string; fence: number };
      };
      await h.request("/protected-items/a", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Waypoint-Step": "plan-q.0",
          "Waypoint-Execution": accepted.acceptance.executionId,
          "Waypoint-Fence": String(accepted.acceptance.fence),
        },
        body: '{"title":"After"}',
      });
      // Nobody reads plan-p before its old token is presented.
      expect(await confirm(shown, "confirm-old")).toMatchObject({
        status: 409,
        body: { confirmation: { reason: "stale" } },
      });
      const current = await h.read();
      expect(current.recovery?.phase).toBe("initial-review");
      expect(current.confirmation!.items[0]!.before).toBe('"After"');
      expect((await confirm(current, "confirm-new")).status).toBe(200);
    } finally {
      await h.close();
    }
  });
});

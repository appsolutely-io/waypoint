// The runtime the tests run in, as the library's target browsers provide
// it: Web Locks are present (Node 22 has none; the tests' setup supplies a
// minimal manager there), and that manager behaves as Web Locks do for
// exclusive requests. Tests that check the no-locks path remove it
// themselves.
import { describe, expect, it } from "vitest";
import { webLocks } from "../support/web-locks";

describe("the test runtime", () => {
  it("provides Web Locks, as the target browsers do", () => {
    const locks = (
      globalThis as { navigator?: { locks?: { request?: unknown } } }
    ).navigator?.locks;
    expect(typeof locks?.request).toBe("function");
  });
});
describe("the minimal Web Locks manager", () => {
  const later = () => new Promise((resolve) => setTimeout(resolve, 5));
  it("runs requests for one name one at a time, in order, and resolves with each callback's result", async () => {
    const locks = webLocks();
    const order: string[] = [];
    const first = locks.request("a", async () => {
      order.push("first starts");
      await later();
      order.push("first ends");
      return 1;
    });
    const second = locks.request("a", async () => {
      order.push("second starts");
      return 2;
    });
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(order).toEqual(["first starts", "first ends", "second starts"]);
  });
  it("releases the lock when a callback rejects, and passes the rejection on", async () => {
    const locks = webLocks();
    const failed = locks.request("a", async () => {
      throw new Error("callback failed");
    });
    await expect(failed).rejects.toThrow("callback failed");
    expect(await locks.request("a", () => "next")).toBe("next");
  });
  it("lets requests for other names run at once", async () => {
    const locks = webLocks();
    const order: string[] = [];
    const held = locks.request("a", async () => {
      await later();
      order.push("a");
    });
    await locks.request("b", () => {
      order.push("b");
    });
    await held;
    expect(order).toEqual(["b", "a"]);
  });
  it("refuses options it does not implement", () => {
    const locks = webLocks();
    expect(() =>
      locks.request("a", { ifAvailable: true }, () => undefined),
    ).toThrow();
  });
});

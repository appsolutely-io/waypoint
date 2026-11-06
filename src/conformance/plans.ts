import type { HttpRequest, ConformanceResult } from "./index";
import type { PlanRecord, ImmediatePlan } from "../protocol/generated";
import { createPlanRunner } from "../core/runner";
export async function runPlanConformance(
  request: HttpRequest,
): Promise<ConformanceResult> {
  const failures: string[] = [];
  const scenarios: string[] = [];
  const session = await request("/__conformance/session", { method: "POST" });
  const credentials = session.body as { session: string; csrf: string };
  const headers = {
    "Content-Type": "application/json",
    Cookie: `waypoint=${credentials.session}`,
    "X-CSRF-Token": credentials.csrf,
  };
  const post = (path: string, body: unknown) =>
    request(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "1.0", ...(body as object) }),
    });
  for (const mode of ["run", "refuse"]) {
    scenarios.push(`plan ${mode}`);
    try {
      await post("/__conformance/script", { planScenario: mode });
      const created = await post("/conversations", { title: "Plan" });
      const id = (created.body as { id: string }).id;
      const replies = `/conversations/${id}/replies`;
      const read = async (id: string) =>
        (await request(`/plans/${id}`, { headers })).body as PlanRecord;
      const draft = await read("plan-a");
      if (draft.plan.kind !== "immediate" || draft.plan.stage !== "draft")
        throw new Error("Missing draft");
      const values = await request("/items/a", { headers });
      await post(replies, {
        kind: "plan.values",
        clientReplyId: "values-a",
        planId: "plan-a",
        steps: [{ stepId: "step-a", ...(values.body as object) }],
      });
      const final = await read("plan-a");
      const plan = final.plan as ImmediatePlan;
      if (plan.stage !== "final" || !plan.digest)
        throw new Error("Missing final");
      // The host issues the confirmation the user approves; only its
      // single-use token confirms.
      const token = final.confirmation?.token;
      if (!token) throw new Error("Missing confirmation record");
      const confirmWith = (clientReplyId: string, extra: object) =>
        post(replies, {
          kind: "confirm",
          clientReplyId,
          planId: "plan-a",
          digest: plan.digest,
          ...extra,
        });
      for (const [id, extra] of [
        ["no-token", {}],
        ["wrong-token", { confirmationToken: `${token}x` }],
      ] as const)
        if ((await confirmWith(id, extra)).status !== 409)
          throw new Error("Confirmation without its token accepted");
      if (
        (await confirmWith("confirm-a", { confirmationToken: token }))
          .status !== 200
      )
        throw new Error("Confirmation refused");
      if (
        (await confirmWith("confirm-b", { confirmationToken: token }))
          .status !== 409
      )
        throw new Error("Confirmation token used twice");
      const runner = createPlanRunner({
        read,
        heartbeat: async (id) => {
          await post(`/plans/${id}/heartbeat`, {});
        },
        request: async (canonical, context) => {
          const result = await request(canonical.path, {
            method: canonical.method,
            headers: { ...headers, ...context.headers },
            body: canonical.body,
          });
          if (result.status >= 400) throw new Error("Step refused");
        },
      });
      await runner.run("plan-a", plan.digest);
      const result = await read("plan-a");
      if (mode === "run" && result.state !== "completed")
        throw new Error("Not completed");
      // A refused step stops the run; nothing asks the host for an undo.
      if (
        mode === "refuse" &&
        (result.state === "undoing" || result.undoPlanId !== undefined)
      )
        throw new Error("Undo requested automatically");
      if (mode === "run") {
        await post("/plans/plan-a/stop", {});
        await runner.run(
          "undo-a",
          ((await read("undo-a")).plan as ImmediatePlan).digest,
        );
        const restored = await request("/items/a", { headers });
        if (JSON.stringify(restored.body).includes("After"))
          throw new Error("Not restored");
      }
      runner.dispose();
    } catch {
      failures.push(`plan ${mode}`);
    }
  }
  return { passed: failures.length === 0, failures, scenarios };
}

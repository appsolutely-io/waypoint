import type {
  ImmediatePlan,
  PlanRecord,
  Step,
} from "../../src/protocol/generated";
import {
  checkConfirmation,
  confirmationRecord,
  issueConfirmation,
  refusalBody,
  type ConfirmationWording,
  type IssuedConfirmation,
} from "../../src/host/confirmation";
/** How long an issued confirmation stays valid. */
const CONFIRMATION_TTL = 10 * 60_000;
export function createPlanFixture(conversationId = "conversation-a") {
  let value = "Before";
  let version = "v1";
  let refuse = false;
  let record: PlanRecord;
  let undo: PlanRecord | undefined;
  // The host's record revision and the confirmation it issued for it.
  let revision = 0;
  let issued: IssuedConfirmation | undefined;
  // Issues a new record for the current plan, revoking the earlier token,
  // and stores it whole on the plan record as issued.
  const issue = (wording: ConfirmationWording) => {
    issued = issueConfirmation(issued, {
      planId: "plan-a",
      conversationId,
      revision,
      now: Date.now(),
      ttl: CONFIRMATION_TTL,
      token: globalThis.crypto.randomUUID(),
    });
    record.confirmation = confirmationRecord(issued, wording);
  };
  const step: Step = {
    id: "step-a",
    operation: "items.update",
    resource: "items",
    rows: ["a"],
    fields: ["title"],
    view: "/items/a",
    tier: "low",
    undo: "compare-and-set",
    stepUp: false,
  };
  const reset = (failure = false, timed = false) => {
    value = "Before";
    version = "v1";
    refuse = failure;
    undo = undefined;
    issued = undefined;
    revision++;
    if (timed) {
      // A timed plan the host has finalized: awaiting confirmation with
      // its record, which schedules it instead of applying it now.
      record = {
        protocol: "1.0",
        id: "plan-a",
        state: "awaiting-confirmation",
        outcomes: [],
        plan: {
          kind: "timed",
          id: "plan-a",
          values: { a: { title: "After" } },
          start: "2026-12-01T10:30:00.000Z",
          end: null,
        },
      };
      issue({
        heading: "Schedule 1 change in items",
        items: [
          { label: "Item a: title", before: '"Before"', after: '"After"' },
        ],
        schedule: {
          start: "2026-12-01T10:30:00.000Z",
          end: null,
          startText: "1 Dec 2026, 10:30 UTC",
          endText: "No end date",
        },
        irreversible: false,
        undo: "Undoing this change is not available in this version.",
        verificationCount: 0,
        actionLabel: "Schedule 1 change",
      });
      return;
    }
    record = {
      protocol: "1.0",
      id: "plan-a",
      state: "proposed",
      outcomes: [],
      plan: {
        kind: "immediate",
        stage: "draft",
        id: "plan-a",
        steps: [
          {
            ...step,
            planningRead: {
              method: "GET",
              path: "/items/a",
              rows: ["a"],
              fields: ["title"],
            },
          },
        ],
      },
    };
  };
  reset();
  return {
    reset,
    handle(
      path: string,
      method: string,
      body: Record<string, unknown>,
      headers: Record<string, string | undefined>,
    ): { status: number; body: unknown } | undefined {
      if (path === "/items/a" && method === "GET")
        return {
          status: 200,
          body: { rows: { a: { title: value } }, versions: { a: version } },
        };
      if (path === "/plans/plan-a") return { status: 200, body: record };
      if (path === "/plans/undo-a") return { status: 200, body: undo };
      if (path.endsWith("/replies") && body.kind === "plan.values") {
        const input = body.steps as {
          stepId: string;
          rows: Record<string, { title: string }>;
          versions: Record<string, string>;
        }[];
        if (
          input.length !== 1 ||
          input[0]?.stepId !== "step-a" ||
          input[0].rows.a?.title !== value ||
          input[0].versions.a !== version
        )
          return { status: 409, body: { id: "values", code: "invalid-plan" } };
        record.plan = {
          kind: "immediate",
          stage: "final",
          id: "plan-a",
          digest: "fixture-digest",
          stepUpCount: 0,
          steps: [
            {
              ...step,
              before: { title: value },
              after: { title: "After" },
              request: {
                method: "PATCH",
                path: "/items/a",
                body: '{"title":"After"}',
                headers: { "If-Match": version },
                digest: "fixture-step",
              },
            },
          ],
        };
        record.state = "awaiting-confirmation";
        revision++;
        issue({
          heading: "Update 1 record in items",
          items: [
            {
              label: "Item a: title",
              before: JSON.stringify(value),
              after: JSON.stringify("After"),
            },
          ],
          irreversible: false,
          undo: "Undoing this change is not available in this version.",
          verificationCount: 0,
          actionLabel: "Apply 1 change",
        });
        return { status: 200, body: record };
      }
      if (path.endsWith("/replies") && body.kind === "confirm") {
        // Only the issued token confirms, once; the token check and the
        // state change are one step.
        const check = checkConfirmation(
          issued,
          { token: body.confirmationToken },
          { planId: String(body.planId), conversationId, revision },
          Date.now(),
        );
        if (check.result === "refused")
          return {
            status: 409,
            body: refusalBody(String(body.clientReplyId), check.reason),
          };
        if (record.plan.kind === "timed") {
          // Consuming the token is the enrollment: the plan is scheduled.
          issued = { ...issued!, consumedBy: String(body.clientReplyId) };
          delete record.confirmation;
          record.state = "submitted";
          return { status: 200, body: { id: String(body.clientReplyId) } };
        }
        if (
          record.plan.kind !== "immediate" ||
          record.plan.stage !== "final" ||
          body.digest !== record.plan.digest
        )
          return { status: 409, body: { id: "digest", code: "invalid-plan" } };
        issued = { ...issued!, consumedBy: String(body.clientReplyId) };
        delete record.confirmation;
        record.state = "running";
        return { status: 200, body: record };
      }
      if (
        path === "/plans/plan-a/heartbeat" ||
        path === "/plans/undo-a/heartbeat"
      )
        return { status: 200, body: {} };
      if (path === "/plans/plan-a/stop") {
        record.state = "undoing";
        record.undoPlanId = "undo-a";
        const forward = record.plan as ImmediatePlan;
        const completed = record.outcomes.some((o) => o.status === 200);
        undo = {
          protocol: "1.0",
          id: "undo-a",
          state: completed ? "running" : "completed",
          outcomes: [],
          plan: {
            kind: "immediate",
            stage: "final",
            id: "undo-a",
            digest: "undo-digest",
            stepUpCount: 0,
            steps: completed
              ? [
                  {
                    ...step,
                    before: { title: value },
                    after: forward.steps[0]!.before!,
                    request: {
                      method: "PATCH",
                      path: "/items/a",
                      body: JSON.stringify(forward.steps[0]!.before),
                      headers: { "If-Match": version },
                      digest: "undo-step",
                    },
                  },
                ]
              : [],
          },
        };
        return { status: 200, body: record };
      }
      if (path === "/items/a" && method === "PATCH") {
        const target = headers["waypoint-step"] === "undo-a.0" ? undo : record;
        const final = target?.plan as ImmediatePlan | undefined;
        const request = final?.steps[0]?.request;
        if (
          !request ||
          target?.state !== "running" ||
          headers["if-match"] !== version ||
          JSON.stringify(body) !== request.body
        )
          return { status: 412, body: { id: "match", code: "mismatch" } };
        const status = refuse && target === record ? 412 : 200;
        target.outcomes = [
          { stepId: "step-a", status, attributed: true, version },
        ];
        if (status === 200) {
          value = String(body.title);
          version = version === "v1" ? "v2" : "v3";
          target.state = "completed";
        }
        return { status, body: { title: value, version } };
      }
      return undefined;
    },
  };
}

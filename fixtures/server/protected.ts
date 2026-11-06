// Protected plans in the reference host: the terminal-intent resolver's
// state per plan, kept in memory, with one queue per plan so every writer
// (confirmation, intents, step admission and commit, renewal) runs as one
// atomic transition. Test controls can hold a named boundary to order races.
// Host safety state here is not durable; a real host persists it.
import type {
  ConfirmationRecord,
  ImmediatePlan,
  PlanRecord,
  PlanState,
} from "../../src/protocol/generated";
import {
  completeExecution,
  confirm,
  createProtectedPlan,
  parseConfirm,
  parseIntentRequest,
  readback,
  recordContradiction,
  recoveryView,
  releasePlan,
  replaceReview,
  resolveIntent,
  stepEvent,
  type ProtectedPlan,
  type RecoveryPhase,
} from "../../src/host/plan-intents";
import {
  checkConfirmation,
  confirmationRecord,
  issueConfirmation,
  refusalBody,
  type IssuedConfirmation,
} from "../../src/host/confirmation";

const STATES: Record<RecoveryPhase, PlanState> = {
  proposal: "proposed",
  "initial-review": "awaiting-confirmation",
  "forward-active": "running",
  readback: "needs-attention",
  completed: "completed",
  cancelled: "cancelled",
  "left-known": "completed",
  "left-unconfirmed": "needs-attention",
  "left-reopened": "needs-attention",
};
// `raw`, when present, is the exact response body the server writes.
type Reply = { status: number; body: unknown; raw?: string };

/** How long an issued confirmation stays valid. */
export const CONFIRMATION_TTL = 10 * 60_000;
/** Replaced records per plan whose requests still name their replacement. */
export const REPLACEMENT_HISTORY = 4;

export function createProtectedFixture() {
  const plans = new Map<string, ProtectedPlan>();
  // Records created per plan id, so each replacement has its own generation.
  const created = new Map<string, number>();
  // Execution ids of the most recently replaced records of each plan,
  // oldest first, at most REPLACEMENT_HISTORY records; older requests get
  // the plain stale refusal.
  const retired = new Map<string, string[][]>();
  const definitions = new Map<string, { digest: string; rows: string[] }>();
  const values = new Map<string, string>();
  // The confirmation issued for each plan in initial review, stored whole
  // as issued: one live token per plan. Reads return the stored record and
  // never rebuild it; when what it describes changes (a new revision or
  // record, or other values), the token is revoked and a new record issued.
  const issued = new Map<
    string,
    { token: IssuedConfirmation; record: ConfirmationRecord }
  >();
  const currentConfirmation = (plan: ProtectedPlan) => {
    if (plan.phase !== "initial-review") return undefined;
    const known = issued.get(plan.planId);
    const words = wording(plan.planId);
    if (
      known &&
      known.token.revision === plan.revision &&
      known.token.consumedBy === undefined &&
      known.token.token.startsWith(plan.recordId) &&
      JSON.stringify(confirmationRecord(known.token, words)) ===
        JSON.stringify(known.record)
    )
      return known.record;
    const token = issueConfirmation(
      known?.token.token.startsWith(plan.recordId) ? known.token : undefined,
      {
        planId: plan.planId,
        conversationId: plan.conversationId,
        revision: plan.revision,
        now: Date.now(),
        ttl: CONFIRMATION_TTL,
        token: `${plan.recordId}.${globalThis.crypto.randomUUID()}`,
      },
    );
    const record = confirmationRecord(token, words);
    issued.set(plan.planId, { token, record });
    return record;
  };
  // The host's own wording of what it will apply.
  const wording = (planId: string) => {
    const rows = definitions.get(planId)!.rows;
    const count = rows.length;
    return {
      heading: `Update ${count} ${count === 1 ? "record" : "records"} in items`,
      items: rows.map((row) => ({
        label: `Item ${row}: title`,
        before: JSON.stringify(values.get(row) ?? "Before"),
        after: JSON.stringify("After"),
      })),
      irreversible: false,
      undo: "Undoing these changes is not available in this version.",
      verificationCount: 0,
      actionLabel: `Apply ${count} ${count === 1 ? "change" : "changes"}`,
    };
  };
  const queues = new Map<string, Promise<unknown>>();
  const holds = new Map<string, { wait: Promise<void>; release(): void }>();
  // Whether this host offers Leave and Keep on the safety-control route.
  let leaveOffered = true;
  let keepOffered = true;
  // Scoped permission: the principals allowed to act on each plan.
  const access = new Map<string, Set<string>>();
  // One queue per plan: each transition reads, decides and writes alone.
  const atomic = <T>(planId: string, work: () => T | Promise<T>) => {
    const previous = queues.get(planId) ?? Promise.resolve();
    const next = previous.then(work, work);
    queues.set(
      planId,
      next.catch(() => undefined),
    );
    return next;
  };
  const hold = async (name: string) => {
    await holds.get(name)?.wait;
  };
  const final = (planId: string): ImmediatePlan => {
    const definition = definitions.get(planId)!;
    return {
      kind: "immediate",
      stage: "final",
      id: planId,
      digest: definition.digest,
      stepUpCount: 0,
      steps: definition.rows.map((row) => ({
        id: `step-${row}`,
        operation: "items.update",
        resource: "items",
        rows: [row],
        fields: ["title"],
        view: `/protected-items/${row}`,
        tier: "low",
        undo: "compare-and-set",
        stepUp: false,
        before: { title: values.get(row) ?? "Before" },
        after: { title: "After" },
        request: {
          method: "PATCH",
          path: `/protected-items/${row}`,
          body: '{"title":"After"}',
          headers: {},
          digest: `step-${row}`,
        },
      })),
    };
  };
  const project = (plan: ProtectedPlan): PlanRecord => {
    const definition = definitions.get(plan.planId)!;
    const execution = plan.acceptance
      ? plan.executions[plan.acceptance.executionId]
      : undefined;
    const stepIds = definition.rows.map((row) => `step-${row}`);
    const confirmation = currentConfirmation(plan);
    return {
      protocol: "1.0",
      id: plan.planId,
      state: STATES[plan.phase],
      outcomes: execution
        ? stepIds
            .filter((id) => execution.steps[id]?.applied)
            .map((stepId) => ({ stepId, status: 200, attributed: true }))
        : [],
      plan: final(plan.planId),
      ...(confirmation && { confirmation: structuredClone(confirmation) }),
      recovery: {
        ...recoveryView(plan),
        ...(execution ? { steps: readback(plan, execution.id, stepIds) } : {}),
      },
    };
  };
  const create = (planId: string, rows: string[], conversationId: string) => {
    definitions.set(planId, { digest: `${planId}-digest-1`, rows });
    for (const row of rows) values.set(row, "Before");
    access.set(planId, new Set(["owner"]));
    // A replaced record is dropped, with everything kept for it.
    const previous = plans.get(planId);
    if (previous) {
      releasePlan(previous);
      const history = retired.get(planId) ?? [];
      history.push(Object.keys(previous.executions));
      retired.set(planId, history.slice(-REPLACEMENT_HISTORY));
    }
    const count = (created.get(planId) ?? 0) + 1;
    created.set(planId, count);
    plans.set(
      planId,
      createProtectedPlan({
        planId,
        conversationId,
        generation: `${planId}.g${count}`,
        steps: rows.map((row) => `step-${row}`),
        review: {
          id: `${planId}.r1`,
          revision: 1,
          digest: `${planId}-digest-1`,
          state: "current",
        },
      }),
    );
  };
  return {
    async handle(
      path: string,
      method: string,
      body: Record<string, unknown>,
      caller: { principal: string },
      headers: Record<string, string | undefined>,
    ): Promise<Reply | undefined> {
      const refused = (id: string, status = 409): Reply => ({
        status,
        body: { code: "refused", id },
      });
      // A committed operation's stored response, written as stored.
      const stored = (raw: string): Reply => ({
        status: 200,
        body: JSON.parse(raw),
        raw,
      });
      // Every protected command needs the principal's scoped permission on
      // the plan the host itself selected.
      const permitted = (planId: string) =>
        access.get(planId)?.has(caller.principal) === true;
      if (path === "/__conformance/protected") {
        const planId = String(body.planId ?? "");
        if (body.operation === "create") {
          create(
            planId,
            (body.rows as string[] | undefined) ?? ["a"],
            String(body.conversationId ?? "conversation-a"),
          );
          return { status: 200, body: project(plans.get(planId)!) };
        }
        if (body.operation === "hold") {
          let release!: () => void;
          const wait = new Promise<void>((resolve) => (release = resolve));
          holds.set(String(body.boundary), { wait, release });
          return { status: 200, body: {} };
        }
        if (body.operation === "release") {
          holds.get(String(body.boundary))?.release();
          holds.delete(String(body.boundary));
          return { status: 200, body: {} };
        }
        const plan = plans.get(planId);
        if (!plan) return { status: 404, body: {} };
        if (body.operation === "admitted") {
          // Test-only view: whether a step of the accepted execution was
          // admitted, so a race test can wait for that moment.
          const run = plan.acceptance
            ? plan.executions[plan.acceptance.executionId]
            : undefined;
          const stepId = String(body.stepId);
          return {
            status: 200,
            body: {
              admitted:
                run !== undefined &&
                Object.hasOwn(run.steps, stepId) &&
                run.steps[stepId]!.admitted,
            },
          };
        }
        if (body.operation === "grant") {
          access.get(planId)!.add(String(body.principal));
          return { status: 200, body: {} };
        }
        if (body.operation === "replace-review") {
          const definition = definitions.get(planId)!;
          const revision = plan.reviews.length + 1;
          definition.digest = `${planId}-digest-${revision}`;
          plans.set(
            planId,
            replaceReview(plan, {
              id: `${planId}.r${revision}`,
              revision: 1,
              digest: definition.digest,
              state: "current",
            }),
          );
          return { status: 200, body: project(plans.get(planId)!) };
        }
        if (body.operation === "seed-left") {
          // A genuine prior closure through the real writers: acceptance, a
          // connection-lost Stop, then an informed Leave; one admitted step
          // stays unknown for left-unconfirmed, and a later contradictory
          // receipt reopens a known closure.
          const phase = body.phase as RecoveryPhase;
          let next = confirm(plan, {
            clientReplyId: "seed",
            digest: plan.reviews[0]!.digest,
            protocol: "1.0",
          }).plan;
          const run = next.executions[next.acceptance!.executionId]!;
          const first = next.stepIds[0]!;
          if (phase === "left-unconfirmed")
            next = stepEvent(next, {
              executionId: run.id,
              fence: run.fence,
              event: "admission",
              stepId: first,
              operationId: first,
            }).plan;
          const terminal = (kind: "stop" | "leave") => {
            const view = recoveryView(next);
            return {
              kind,
              planId,
              target: { type: "execution" as const, id: run.id },
              capturedRound: view.round,
              expectedSlotVersion: view.slots[kind],
              correlation: `seed-${kind}`,
              cause:
                kind === "stop"
                  ? ("connection-lost" as const)
                  : ("user" as const),
              ...(kind === "leave"
                ? {
                    acknowledgment: {
                      sourceDecisionKey: view.decisionKey!,
                      evidenceVersion: view.versions.evidence,
                      winnerVersion: view.versions.winner,
                      decisionResolutionVersion:
                        view.versions.decisionResolution,
                      evidenceDigest: view.evidenceDigest!,
                      unknownCount: view.unknownCount!,
                    },
                  }
                : {}),
            };
          };
          next = resolveIntent(next, terminal("stop")).plan;
          next = resolveIntent(next, terminal("leave"), { leave: true }).plan;
          if (phase === "left-reopened")
            next = recordContradiction(next, run.id, first);
          plans.set(planId, next);
          return { status: 200, body: project(next) };
        }
        if (body.operation === "leave-offered") {
          leaveOffered = body.offered === true;
          return { status: 200, body: {} };
        }
        if (body.operation === "keep-offered") {
          keepOffered = body.offered === true;
          return { status: 200, body: {} };
        }
        return { status: 400, body: {} };
      }
      const match =
        /^\/plans\/([^/]+)(?:\/(safety-control|stop|heartbeat))?$/.exec(path);
      if (match && plans.has(match[1]!)) {
        // The route selects the plan; nothing in the body does.
        const planId = match[1]!;
        if (!permitted(planId)) return refused("permission", 403);
        if (!match[2] && method === "GET")
          return atomic(planId, () => ({
            status: 200,
            body: project(plans.get(planId)!),
          }));
        if (match[2] === "stop")
          // A protected plan never stops through the legacy route.
          return refused("protected-plan");
        if (match[2] === "heartbeat")
          return atomic(planId, () => {
            const result = stepEvent(plans.get(planId)!, {
              executionId: String(body.executionId),
              fence: Number(body.fence),
              event: "renewal",
            });
            return result.reply.result === "allowed"
              ? { status: 200, body: {} }
              : refused("renewal");
          });
        if (match[2] === "safety-control" && method === "POST") {
          // The body was bounded while it streamed in; it is validated here
          // before the resolver sees it.
          const intent = parseIntentRequest(body);
          if (!intent) return refused("intent-invalid", 400);
          if (intent.planId !== planId) return refused("plan-mismatch", 400);
          // A hold here orders arrival; the transition itself is atomic.
          await hold(`intent:${planId}`);
          const reply = await atomic(planId, () => {
            const result = resolveIntent(plans.get(planId)!, intent, {
              leave: leaveOffered,
              keep: keepOffered,
              principal: caller.principal,
              now: Date.now(),
            });
            plans.set(planId, result.plan);
            return result.reply;
          });
          await hold(`intent-response:${planId}`);
          return { status: 200, body: reply };
        }
      }
      const replies = /^\/conversations\/([^/]+)\/replies$/.exec(path);
      if (
        replies &&
        body.kind === "confirm" &&
        typeof body.planId === "string" &&
        plans.has(body.planId)
      ) {
        const planId = body.planId;
        const plan = plans.get(planId)!;
        // The plan must belong to the conversation of the route.
        // A token presented for another conversation is a mismatch.
        if (plan.conversationId !== decodeURIComponent(replies[1]!))
          return {
            status: 409,
            body: refusalBody(String(body.clientReplyId), "mismatch"),
          };
        if (!permitted(planId)) return refused("permission", 403);
        await hold(`confirm:${planId}`);
        // Validated as exactly a confirmation of this plan first.
        const command = parseConfirm(body, planId);
        if (!command) return refused("confirm-invalid", 400);
        // The token check, its consumption and the first acceptance are
        // one transition.
        const reply = await atomic(planId, () => {
          const at = plans.get(planId)!;
          const known = issued.get(planId)?.token;
          const check = checkConfirmation(
            known?.token.startsWith(at.recordId) ? known : undefined,
            { token: body.confirmationToken },
            {
              planId,
              conversationId: at.conversationId,
              revision: at.revision,
            },
            Date.now(),
          );
          if (check.result === "refused") return check;
          // The token accepts only the work its stored record words: if the
          // values it describes changed since it was issued, it is stale,
          // whether or not anyone read the plan in between.
          const stored = issued.get(planId)!;
          if (
            JSON.stringify(confirmationRecord(known!, wording(planId))) !==
            JSON.stringify(stored.record)
          )
            return { result: "refused" as const, reason: "stale" as const };
          const result = confirm(at, command);
          if (result.reply.result === "accepted")
            issued.set(planId, {
              ...issued.get(planId)!,
              token: { ...known!, consumedBy: command.clientReplyId },
            });
          plans.set(planId, result.plan);
          return result.reply;
        });
        if (reply.result === "refused" && "reason" in reply)
          return {
            status: 409,
            body: refusalBody(String(body.clientReplyId), reply.reason),
          };
        await hold(`confirm-response:${planId}`);
        if (reply.result === "accepted")
          return {
            status: 200,
            body: {
              id: String(body.clientReplyId),
              acceptance: {
                planId,
                executionId: reply.executionId,
                fence: reply.fence,
              },
            },
          };
        if (reply.result === "replayed")
          return { status: 200, body: { id: String(body.clientReplyId) } };
        return refused((reply as { key: string }).key);
      }
      const item = /^\/protected-items\/([^/]+)$/.exec(path);
      if (item && method === "PATCH") {
        // The execution id selects the host's own record; the request must
        // then be exactly the accepted operation at its step.
        const executionId = headers["waypoint-execution"] ?? "";
        const planId = [...plans.entries()].find(([, plan]) =>
          Object.hasOwn(plan.executions, executionId),
        )?.[0];
        if (!planId) {
          // A request of a replaced record names the record that replaced it.
          const replacedBy = [...retired.entries()].find(([, history]) =>
            history.some((ids) => ids.includes(executionId)),
          )?.[0];
          const current = replacedBy ? plans.get(replacedBy) : undefined;
          if (!replacedBy || !current || !permitted(replacedBy))
            return refused("staleFence");
          return {
            status: 409,
            body: {
              code: "refused",
              id: "recordReplaced",
              replacement: {
                planId: replacedBy,
                generation: current.generation,
              },
            },
          };
        }
        if (!permitted(planId)) return refused("permission", 403);
        const definition = definitions.get(planId)!;
        const [stepPlan, position, ...rest] = (
          headers["waypoint-step"] ?? ""
        ).split(".");
        const index = Number(position);
        const row = Number.isInteger(index)
          ? definition.rows[index]
          : undefined;
        const operation = row ? final(planId).steps[index]?.request : undefined;
        if (
          stepPlan !== planId ||
          rest.length > 0 ||
          !row ||
          !operation ||
          operation.method !== method ||
          operation.path !== path ||
          JSON.stringify(body) !== operation.body
        )
          return refused("operation-mismatch");
        const token = {
          executionId,
          fence: Number(headers["waypoint-fence"]),
        };
        const stepId = `step-${row}`;
        const admitted = await atomic(planId, () => {
          const current = plans.get(planId);
          if (!current) return undefined;
          const result = stepEvent(current, {
            ...token,
            event: "admission",
            stepId,
            operationId: stepId,
          });
          plans.set(planId, result.plan);
          // An exact retry of a committed operation is acknowledged from
          // the record's receipt, without a second effect.
          if (result.reply.result === "existing" && result.reply.receipt)
            return { acknowledged: result.reply.response };
          return result.reply;
        });
        if (!admitted) return refused("staleFence");
        if ("acknowledged" in admitted)
          return admitted.acknowledged === undefined
            ? refused("notAdmitted")
            : stored(admitted.acknowledged);
        if (admitted.result === "refused") return refused(admitted.key);
        const admission = admitted.admission;
        if (!admission) return refused("notAdmitted");
        await hold(`commit:${planId}`);
        return atomic(planId, () => {
          // The host may have dropped the record while this request waited.
          const current = plans.get(planId);
          if (!current) return refused("staleFence");
          const result = stepEvent(current, {
            ...token,
            event: "commit",
            stepId,
            operationId: stepId,
            admission,
            receipt: `${stepId}-applied`,
            response: JSON.stringify({ title: "After" }),
          });
          if (result.reply.result === "refused")
            return refused(result.reply.key);
          if (result.reply.result === "existing")
            return result.reply.response === undefined
              ? refused("notAdmitted")
              : stored(result.reply.response);
          values.set(row, "After");
          let next = result.plan;
          const run = next.executions[executionId]!;
          if (
            definition.rows.every(
              (name) =>
                Object.hasOwn(run.steps, `step-${name}`) &&
                run.steps[`step-${name}`]!.applied !== undefined,
            )
          )
            next = completeExecution(next, Date.now());
          plans.set(planId, next);
          return stored(next.executions[executionId]!.steps[stepId]!.response!);
        });
      }
      return undefined;
    },
    // Drops this host's plan records and what the resolver keeps for them.
    dispose() {
      for (const plan of plans.values()) releasePlan(plan);
      plans.clear();
      retired.clear();
      created.clear();
    },
    value: (row: string) => values.get(row),
    state: (planId: string) => plans.get(planId),
  };
}

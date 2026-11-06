// Client actions that wait on the client or a host first and are never
// needed for the first render: message versions, flow lists, favourites
// and runs, plan resume and undo retry, and reading a plan again. Loaded
// the first time one is used.
import {
  asProblem,
  type ClientConfig,
  type ClientSnapshot,
  type ConversationReadResult,
  type ReplyDelivery,
  type ReplyInput,
  DEFAULT_FLOW_TABS,
  flowTabId,
  type WaypointClient,
  type WaypointEvent,
} from "./client";
import { validateFlowDocument } from "./flows";
import type { ExecutionAcceptance, Flow, Problem } from "../protocol/generated";
import type { Scope, ScopeSignal } from "./scope";

/** What the client lends these actions: its own state and ownership. */
export interface OnDemandContext {
  ready: Promise<unknown>;
  config: ClientConfig;
  client: WaypointClient;
  state(): ClientSnapshot;
  // Negotiated and not disposed.
  live(): boolean;
  disposed(): boolean;
  restricted(): boolean;
  formMode(): boolean;
  report(problem: Problem): void;
  emit(event: WaypointEvent): void;
  refresh(): Promise<unknown>;
  stopped(planId: string): boolean;
  refusedPending(planId: string): boolean;
  // A plan shown but not controllable here: nothing is sent for it.
  readOnly(planId: string): boolean;
  confirmedDigest(planId: string): string | undefined;
  finishPlanRead(read: Scope): boolean;
  // Reads a plan's record for the scope and shows it unless superseded.
  showPlan(planId: string, scope: ScopeSignal): Promise<void>;
  switchTo(
    id: string,
    owners: readonly ScopeSignal[],
  ): Promise<ConversationReadResult>;
  update(patch: Partial<ClientSnapshot>): void;
  // Whether the user chose a flow tab, which a load then keeps.
  tabSelected(): boolean;
  sendReply(
    owner: ScopeSignal | undefined,
    reply: ReplyInput,
    delivered?: (delivery: ReplyDelivery) => void,
  ): Promise<boolean>;
  // Records the digest a confirmation was accepted for.
  confirmed(planId: string, digest: string): void;
  // Starts the run of a confirmed plan, under its acceptance if protected.
  run(
    scope: ScopeSignal,
    planId: string,
    digest: string,
    acceptance?: ExecutionAcceptance,
  ): Promise<void> | void;
}
export type OnDemand = ReturnType<typeof createOnDemand>;

export function createOnDemand(context: OnDemandContext) {
  const { config, client, report } = context;
  const versionAttempts = new Map<
    string,
    { id: string; active?: Promise<void> }
  >();
  // One prepared flow document, for the conversation it was prepared in;
  // each preparation supersedes the ones still loading.
  let prepared: { id: string; document: Flow; scope: ScopeSignal } | undefined;
  let preparation = 0;
  return {
    // Asks the host to stop writing a reply the client already shows
    // stopped; the reply id is the message's, so a repeat is a replay.
    async stopReply(messageId: string) {
      await context.sendReply(undefined, {
        kind: "stop",
        clientReplyId: `stop-${messageId}`,
        messageId,
      });
    },
    // Edits, regenerates or selects a message version, once per identical
    // request while it is in flight.
    async version(
      scope: ScopeSignal,
      operation: "edit" | "regenerate" | "select",
      messageId: string,
      content?: string,
      index?: number,
    ): Promise<void> {
      await context.ready;
      if (!context.live() || context.formMode() || scope.aborted) return;
      const state = context.state();
      const message = state.conversation?.messages.find(
        (message) => message.id === messageId,
      );
      if (
        !config.versions ||
        !message ||
        (operation === "edit" && message.role !== "user") ||
        (operation === "regenerate" && message.role !== "assistant") ||
        (operation === "select" &&
          (!Number.isInteger(index) ||
            index! < 1 ||
            index! > (message.versionCount ?? 1)))
      ) {
        report({ code: "refused", id: "message-version" });
        return;
      }
      const key = JSON.stringify([
        state.conversationId,
        operation,
        messageId,
        content,
        index,
      ]);
      const previous = versionAttempts.get(key);
      if (previous?.active) return previous.active;
      const attempt = previous ?? { id: config.platform.ids() };
      versionAttempts.set(key, attempt);
      const input = {
        conversationId: state.conversationId,
        messageId,
        clientReplyId: attempt.id,
      };
      attempt.active = (async () => {
        context.emit({
          type: "reply",
          conversationId: input.conversationId,
          replyId: input.clientReplyId,
        });
        try {
          if (operation === "edit")
            await config.versions!.edit({ ...input, content: content ?? "" });
          else if (operation === "regenerate")
            await config.versions!.regenerate(input);
          else await config.versions!.select({ ...input, index: index! });
          versionAttempts.delete(key);
          if (!scope.aborted) await context.refresh();
        } catch (error) {
          if (!scope.aborted) report(asProblem(error, input.clientReplyId));
        } finally {
          delete attempt.active;
        }
      })();
      return attempt.active;
    },
    // Sends a confirmation pressed in the chat and, when it is accepted and
    // nothing stopped or superseded it on the way, starts the run.
    async confirm(input: {
      scope: ScopeSignal;
      planId: string;
      token: string;
      digest?: string;
      replyId: string;
      current(): boolean;
      // The plan turned read-only since the press.
      stale(): boolean;
      refused(acceptance?: ExecutionAcceptance): boolean;
    }): Promise<void> {
      const { scope, planId, token, digest } = input;
      await context.ready;
      if (!context.live() || scope.aborted || context.restricted()) return;
      if (input.stale()) {
        report({ code: "refused", id: planId });
        return;
      }
      let acceptance: ExecutionAcceptance | undefined;
      const accepted = await context.sendReply(
        undefined,
        {
          kind: "confirm",
          clientReplyId: input.replyId,
          planId,
          confirmationToken: token,
          ...(digest && { digest }),
        },
        (delivery) => {
          if (delivery.acceptance?.planId === planId)
            acceptance = delivery.acceptance;
        },
      );
      // An answer other than acceptance is recorded under this attempt's
      // reply id; only a problem with that id is its refusal.
      if (!accepted)
        context.update({
          confirmationRefusal: { token, problemId: input.replyId },
        });
      if (
        input.refused(acceptance) ||
        !accepted ||
        !digest ||
        scope.aborted ||
        context.disposed() ||
        context.stopped(planId) ||
        !input.current()
      )
        return;
      context.confirmed(planId, digest);
      const problem = context.state().problem;
      if (problem?.code === "plan-changed" && problem.id === planId)
        context.update({ problem: null });
      await context.run(scope, planId, digest, acceptance);
    },
    async resumePlan(scope: ScopeSignal): Promise<void> {
      await context.ready;
      if (context.restricted()) return;
      const plan = context.state().plan;
      if (!context.live() || scope.aborted || !plan || !config.plans?.resume)
        return;
      if (context.stopped(plan.id)) {
        report({ code: "stopped", id: plan.id });
        return;
      }
      if (context.refusedPending(plan.id)) return;
      if (context.readOnly(plan.id)) {
        report({ code: "refused", id: plan.id });
        return;
      }
      try {
        const record = await config.plans.resume(plan.id);
        if (scope.aborted || context.disposed()) return;
        if (record.id !== plan.id) {
          client.setPlan(
            record.plan.kind === "immediate" && record.plan.stage === "final"
              ? { ...record, state: "awaiting-confirmation" }
              : record,
          );
          report({ code: "plan-changed", id: record.id });
          return;
        }
        if (record.plan.kind === "timed") {
          client.setPlan(record);
          return;
        }
        if (record.plan.stage !== "final") {
          client.setPlan(record);
          report({ code: "invalid-plan", id: record.id });
          return;
        }
        const digest = context.confirmedDigest(plan.id);
        if (!digest || record.plan.digest !== digest) {
          client.setPlan({ ...record, state: "awaiting-confirmation" });
          report({ code: "plan-changed", id: record.id });
          return;
        }
        client.setPlan(record);
        await client.runPlan(record.id, digest);
      } catch (error) {
        if (!scope.aborted && !context.disposed())
          report(asProblem(error, plan.id));
      }
    },
    // Retries an undo for the plan and conversation of its press only; the
    // caller releases the read on every outcome.
    async retryUndo(
      scope: ScopeSignal,
      read: Scope,
      planId: string | undefined,
    ): Promise<void> {
      await context.ready;
      if (
        context.restricted() ||
        !context.live() ||
        scope.aborted ||
        read.signal.aborted ||
        !planId ||
        context.state().plan?.id !== planId ||
        !config.plans?.retryUndo
      )
        return;
      if (context.readOnly(planId)) {
        report({ code: "refused", id: planId });
        return;
      }
      const record = await config.plans.retryUndo(planId);
      if (context.finishPlanRead(read) && !scope.aborted)
        client.setPlan(record);
    },
    // Runs a flow under the run scope its press created: a newer run,
    // dispose or leaving its conversation retires it before it dispatches
    // or navigates.
    async runFlow(
      run: Scope,
      origin: ScopeSignal,
      id: string,
      values: Record<string, unknown>,
    ): Promise<string | void> {
      const live = () => !run.signal.aborted && !origin.aborted;
      await context.ready;
      if (context.restricted() || !live()) return;
      const kept = prepared?.id === id && !prepared.scope.aborted;
      const loaded = kept
        ? prepared!.document
        : await config.flowSource?.load?.(id);
      if (!live()) return;
      const document = kept
        ? prepared!.document
        : loaded
          ? validateFlowDocument(loaded, config.flowOperations ?? [])
          : undefined;
      const result = await config.flowSource?.run(id, values, document);
      // A run that went through uses up its prepared document; a failed one
      // keeps it for its Retry.
      if (kept && prepared?.document === document) prepared = undefined;
      if (!result || !live()) return;
      const switched = await context.switchTo(result.conversationId, [
        run.signal,
        origin,
      ]);
      // The flow's own navigation retired its origin; from here the switch
      // it made must still be current and the run not superseded.
      if (
        run.signal.aborted ||
        switched.kind === "superseded" ||
        context.state().conversationId !== result.conversationId
      )
        return;
      run.end();
      if (result.plan) client.setPlan(result.plan);
      // Opened only once its authoritative read loaded it and it is shown.
      if (
        switched.kind === "loaded" &&
        context.state().conversation?.id === result.conversationId
      )
        return result.conversationId;
    },
    // Loads and validates a flow's document and keeps it for the next run
    // of that flow in this conversation; without an id, forgets it.
    async prepareFlow(scope: ScopeSignal, id?: string): Promise<Flow | void> {
      prepared = undefined;
      const ticket = ++preparation;
      const load = config.flowSource?.load;
      if (!id || !load) return;
      await context.ready;
      const document = validateFlowDocument(
        await load(id),
        config.flowOperations ?? [],
      );
      // A document for a conversation no longer shown, or one a later
      // preparation (or forgetting) superseded, is kept by no one.
      if (scope.aborted || ticket !== preparation)
        throw { code: "refused", id: "flow-prepare" } satisfies Problem;
      prepared = { id, document, scope };
      return document;
    },
    // Lists every flow tab under the load scope its call created; a newer
    // load supersedes it.
    async loadFlows(load: Scope): Promise<void> {
      const flows: ClientSnapshot["flows"] = {};
      const tabs = config.tabs ?? DEFAULT_FLOW_TABS;
      for (const tab of tabs) {
        if (load.signal.aborted) return;
        flows[flowTabId(tab)] = await config.flowSource!.list(tab);
      }
      if (load.signal.aborted) return;
      load.end();
      const first = tabs.find((tab) => flows[flowTabId(tab)]?.length);
      context.update({
        flows,
        ...(!context.tabSelected() && first
          ? { flowTab: flowTabId(first) }
          : {}),
      });
    },
    async setFavourite(id: string, favourite: boolean): Promise<void> {
      await config.flowSource?.setFavourite(id, favourite);
      await client.loadFlows();
    },
    // Reads the plan's record from the host again and shows its facts.
    async readPlan(scope: ScopeSignal, planId?: string): Promise<void> {
      await context.ready;
      if (
        !planId ||
        !config.plans ||
        !context.live() ||
        context.restricted() ||
        scope.aborted
      )
        return;
      await context.showPlan(planId, scope);
    },
  };
}

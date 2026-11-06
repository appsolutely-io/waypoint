// The hook every renderer uses to read the current plan's view and press
// its actions. What is shown is computed by plan-view; every press goes
// through the client.
import { useCallback, useEffect, useState } from "react";
import {
  confirmationOf,
  type KeepChangesReview,
  type WaypointClient,
} from "../core/client";
import type { IntentKind } from "../protocol/generated";
import {
  keepSheet,
  planView,
  type ActionId,
  type ViewMessage,
} from "./plan-view";
import { clientOf, useWaypointSnapshot } from "./headless";

export interface KeepSheet {
  messages: ViewMessage[];
  proceed: { available: boolean; reasonKey?: ViewMessage["key"] };
  onProceed(): void;
  onCancel(): void;
}

/**
 * The plan view of the current plan and its presses, for every renderer.
 * Presses go through the client; this hook only tracks a press that has no
 * overlay yet, so the view can show it as pending.
 */
export function usePlanView(client?: WaypointClient) {
  const store = clientOf(client);
  const snapshot = useWaypointSnapshot(store);
  const plan = snapshot.plan;
  const [pending, setPending] = useState<IntentKind[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [captured, setCaptured] = useState<KeepChangesReview | null>(null);
  const planId = plan?.id;
  useEffect(() => {
    setPending([]);
    setCaptured(null);
  }, [planId]);
  const overlay = planId ? snapshot.intentOverlays[planId] : undefined;
  // Re-render once when a rate-limit wait ends.
  const retryAt = overlay?.retryAt;
  useEffect(() => {
    if (retryAt === undefined) return;
    const wait = retryAt - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [retryAt]);
  // Re-render once when the shown confirmation expires.
  const expiresAt = confirmationOf(plan, snapshot.conversationId)?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Date.parse(expiresAt) - Date.now();
    if (!(wait > 0)) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 1);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const view = planView({
    plan,
    capabilities: snapshot.capabilities,
    conversationUnavailable: snapshot.conversationUnavailable,
    overlay,
    notice: snapshot.intentNotice,
    alert: snapshot.intentAlert,
    keepReview: plan
      ? store.keepChangesReview(plan.id)
      : { disabled: "keepNoDecision" },
    pending,
    now: Math.max(now, Date.now()),
    conversationId: snapshot.conversationId,
    readOnly: snapshot.planReadOnly,
  });
  const hold = useCallback((kind: IntentKind, work: Promise<unknown>) => {
    setPending((current) => [...current, kind]);
    void work.finally(() =>
      setPending((current) => current.filter((item) => item !== kind)),
    );
  }, []);
  const press = useCallback(
    (id: ActionId | "retry") => {
      if (!planId) return;
      switch (id) {
        case "confirm":
          void store.confirmPlan();
          return;
        case "stop": {
          store.stopPlan(planId);
          // A plan this client cannot control was refused just now, and
          // nothing is reserved. With the intent chunk loaded the overlay
          // exists at once; until then the press joins the client's
          // reservation (nothing is sent).
          const after = store.getSnapshot();
          if (!after.planReadOnly && !after.intentOverlays[planId])
            hold("stop", store.checkIntentStatus(planId));
          return;
        }
        case "decline":
          hold("cancel-initial", store.declinePlan());
          return;
        case "leave":
          hold("leave", store.leavePlan(planId));
          return;
        case "keep": {
          const review = store.keepChangesReview(planId);
          if (!("disabled" in review)) setCaptured(review);
          return;
        }
        case "status":
        case "retry":
          void store.checkIntentStatus(planId);
          return;
      }
    },
    [planId, store, hold],
  );
  const sheet: KeepSheet | null =
    captured && view
      ? {
          ...keepSheet(captured, view),
          onProceed: () => {
            const review = captured;
            setCaptured(null);
            hold("keep", store.keepChanges(review));
          },
          onCancel: () => setCaptured(null),
        }
      : null;
  return { view, press, sheet };
}

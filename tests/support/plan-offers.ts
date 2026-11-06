import type { WaypointClient } from "../../src/core/client";
import { planView } from "../../src/react/plan-view";

// Whether the plan view, built from the snapshot as the chat builds it,
// offers Confirm.
export const offersConfirm = (client: WaypointClient) => {
  const snapshot = client.getSnapshot();
  const view = planView({
    plan: snapshot.plan,
    capabilities: snapshot.capabilities,
    conversationUnavailable: snapshot.conversationUnavailable,
    overlay: undefined,
    notice: null,
    alert: null,
    keepReview: client.keepChangesReview(),
    pending: [],
    now: Date.now(),
    conversationId: snapshot.conversationId,
    readOnly: snapshot.planReadOnly,
  });
  return !!view?.actions.some(
    (action) => action.id === "confirm" && action.available,
  );
};

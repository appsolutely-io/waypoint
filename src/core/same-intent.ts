// The semantic identity of a terminal intent the core itself presses
// (Stop, Cancel of the initial review, Leave), used to decide a press made
// while the intent chunk loads. Two captures have the same key exactly when
// the requests the chunk builds from them carry the same target, round,
// expected slot version and acknowledgment; the revision and every other
// field of the record are left out. A test pins this equivalence against
// the chunk's own request comparison.
import type { IntentKind, PlanRecord } from "../protocol/generated";

export type CoreIntentKind = Extract<
  IntentKind,
  "stop" | "cancel-initial" | "leave"
>;
export const semanticKey = (record: PlanRecord, kind: CoreIntentKind) => {
  const view = record.recovery!;
  const versions = view.versions;
  return JSON.stringify([
    kind,
    view.executionId ? [1, view.executionId] : [2, view.generation],
    view.round,
    view.slots[kind],
    kind === "leave" && [
      view.decisionKey,
      versions.evidence,
      versions.winner,
      versions.decisionResolution,
      view.evidenceDigest,
      view.unknownCount,
    ],
  ]);
};

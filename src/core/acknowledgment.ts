import type { LeaveAcknowledgment, PlanRecord } from "../protocol/generated";

/** What a Leave or Keep acknowledges: the decision facts the record shows. */
export function acknowledgmentOf(record: PlanRecord): LeaveAcknowledgment {
  const view = record.recovery!;
  return {
    sourceDecisionKey: view.decisionKey!,
    evidenceVersion: view.versions.evidence,
    winnerVersion: view.versions.winner,
    decisionResolutionVersion: view.versions.decisionResolution,
    evidenceDigest: view.evidenceDigest!,
    unknownCount: view.unknownCount!,
  };
}

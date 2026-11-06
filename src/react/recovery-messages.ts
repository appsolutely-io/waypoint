// The recovery panel's whole messages, en and zh-CN, loaded with the panel.
// Every key of the recovery panel's messages.
export type RecoveryMessageKey =
  | "chat.recovery.heading"
  | "chat.recovery.updateToControl"
  | "chat.recovery.stopping"
  | "chat.recovery.cancelling"
  | "chat.recovery.leavePending"
  | "chat.recovery.currentRunning"
  | "chat.recovery.currentStopped"
  | "chat.recovery.cancelledNoChanges"
  | "chat.recovery.leftKnown"
  | "chat.recovery.leftUnconfirmed"
  | "chat.recovery.keptKnown"
  | "chat.recovery.done"
  | "chat.recovery.notDone"
  | "chat.recovery.unknown"
  | "chat.recovery.stopped"
  | "chat.recovery.capabilityMissing"
  | "chat.recovery.intentPendingReason"
  | "chat.recovery.refreshConversation"
  | "chat.recovery.hostGuidance"
  | "chat.recovery.checkIntentStatus"
  | "chat.recovery.checkSavedChoice"
  | "chat.recovery.checkKeepStatus"
  | "chat.recovery.keepChanges"
  | "chat.recovery.leave"
  | "chat.recovery.confirmKeepForwardOnly"
  | "chat.recovery.confirmEndRetention"
  | "chat.recovery.keepReasonActive"
  | "chat.recovery.keepReasonUnknown"
  | "chat.recovery.keepReasonUnavailable"
  | "chat.recovery.keepReasonChanged"
  | "chat.recovery.keepReasonPreview"
  | "chat.recovery.keepReasonNoSource"
  | "chat.recovery.alreadyKept"
  | "chat.recovery.stopNotSent"
  | "chat.recovery.stopNotSentElsewhere"
  | "chat.recovery.stopUnconfirmed"
  | "chat.recovery.cancelNotSent"
  | "chat.recovery.cancelUnconfirmed"
  | "chat.recovery.reviewCancelNotSent"
  | "chat.recovery.reviewCancelUnconfirmed"
  | "chat.recovery.leaveNotSent"
  | "chat.recovery.leaveUnconfirmed"
  | "chat.recovery.keepNotSent"
  | "chat.recovery.keepUnconfirmed"
  | "chat.recovery.requestAlreadyStopped"
  | "chat.recovery.requestTargetStopped"
  | "chat.recovery.requestedIntentApplied"
  | "chat.recovery.requestedIntentNotApplied"
  | "chat.recovery.intentSuperseded"
  | "chat.recovery.intentTargetChanged"
  | "chat.recovery.alreadyClosedByWinner"
  | "chat.recovery.alreadyStoppedNeedsDecision"
  | "chat.recovery.cancelStarted"
  | "chat.recovery.stoppedNoChanges"
  | "chat.recovery.initialTargetSettled"
  | "chat.recovery.initialTargetStopped"
  | "chat.recovery.reviewTargetSettled"
  | "chat.recovery.reviewTargetStopped"
  | "chat.recovery.planClosedKept"
  | "chat.recovery.keptForwardClosed"
  | "chat.recovery.keptAlready"
  | "chat.recovery.leaveCompletedByKeep"
  | "chat.recovery.leaveCoveredByKeep"
  | "chat.recovery.leaveNeedsReview"
  | "chat.recovery.leaveSafetyNeedsReview"
  | "chat.recovery.laterReceiptAfterKeep"
  | "chat.recovery.undoSelected"
  | "chat.recovery.continue"
  | "chat.recovery.statusProposal"
  | "chat.recovery.statusCompleted"
  | "chat.recovery.stepsNotKnownYet"
  | "chat.recovery.stepsUnknown"
  | "chat.recovery.stepsNotDone"
  | "chat.recovery.laterReportAfterKeep"
  | "chat.recovery.reportedDifferently"
  | "chat.recovery.notAvailableYet"
  | "chat.recovery.actionLoading"
  | "chat.recovery.retryAfterSeconds"
  | "chat.recovery.keepPending"
  | "chat.recovery.keepRemainingSteps"
  | "chat.recovery.signInRequired"
  | "chat.recovery.requestRefused"
  | "chat.recovery.acknowledgmentAhead"
  | "chat.recovery.cancelCoveredByLeaveSafety"
  | "chat.recovery.cancelCoveredByStopNoChanges"
  | "chat.recovery.cancelDefeatedByStop"
  | "chat.recovery.choiceReplacedByStop"
  | "chat.recovery.initialTargetClosed"
  | "chat.recovery.keepDefeatedByWinner"
  | "chat.recovery.leaveDefeatedByWinner"
  | "chat.recovery.leaveNoDecision"
  | "chat.recovery.leaveSafetyAlreadyStopped"
  | "chat.recovery.reopenedEvidence"
  | "chat.recovery.winnerStopUser"
  | "chat.recovery.winnerStopConnection"
  | "chat.recovery.winnerStopRenewal"
  | "chat.recovery.winnerStopStep"
  | "chat.recovery.winnerStopStepUp"
  | "chat.recovery.winnerStopIdentity"
  | "chat.recovery.winnerStopAttribution"
  | "chat.recovery.winnerStopChanged"
  | "chat.recovery.winnerStopAdapter"
  | "chat.recovery.winnerCancel"
  | "chat.recovery.winnerLeave"
  | "chat.recovery.winnerKeep"
  | "chat.recovery.stepStatusChanged"
  | "chat.recovery.stepNotKnownYet";
export type RecoveryCatalogue = Readonly<Record<RecoveryMessageKey, string>>;
export const recoveryEnglish: RecoveryCatalogue = {
  "chat.recovery.heading": "Review the plan's status",
  "chat.recovery.updateToControl":
    "Update the app to control this plan. Its recorded status is shown here.",
  "chat.recovery.stopping": "Stopping further steps…",
  "chat.recovery.cancelling": "Cancelling…",
  "chat.recovery.leavePending":
    "Saving your choice to leave changes as they are…",
  "chat.recovery.currentRunning":
    "The plan is running now. Stop it before reviewing another action.",
  "chat.recovery.currentStopped":
    "The plan is stopped. Recorded results may include changes already made.",
  "chat.recovery.cancelledNoChanges": "Cancelled; nothing was changed.",
  "chat.recovery.leftKnown":
    "Left as is. Existing changes are kept; no further steps will run from this plan.",
  "chat.recovery.leftUnconfirmed":
    "Left as is; {count, plural, one {# step could not be confirmed} other {# steps could not be confirmed}}.",
  "chat.recovery.keptKnown":
    "Current results kept; no further steps will run from this plan.",
  "chat.recovery.done": "Done",
  "chat.recovery.notDone": "Not done",
  "chat.recovery.unknown": "Could not be confirmed",
  "chat.recovery.stopped": "Stopped. Some changes may already have been made.",
  "chat.recovery.capabilityMissing":
    "This site does not support this recovery action.",
  "chat.recovery.intentPendingReason":
    "Wait for this request to be resolved before confirming another action.",
  "chat.recovery.refreshConversation": "Refresh conversation",
  "chat.recovery.hostGuidance":
    "Contact the site administrator if this problem continues.",
  "chat.recovery.checkIntentStatus": "Check request status",
  "chat.recovery.checkSavedChoice": "Check saved choice",
  "chat.recovery.checkKeepStatus": "Check Keep status",
  "chat.recovery.keepChanges": "Keep these changes",
  "chat.recovery.leave": "Leave as is",
  "chat.recovery.confirmKeepForwardOnly":
    "Keep the current results and close this plan? Remaining planned steps will not run. This plan has no Undo choice to end, and site values will not change.",
  "chat.recovery.confirmEndRetention":
    "Keep the current results and close this plan's retained record? No planned steps or Undo choices remain. Site values will not change.",
  "chat.recovery.keepReasonActive":
    "A confirmed action is still in progress or paused. Review that action first.",
  "chat.recovery.keepReasonUnknown":
    "Some results could not be confirmed. Check their status first.",
  "chat.recovery.keepReasonUnavailable":
    "This action is unavailable in the current account or conversation. Review the available status or contact the host.",
  "chat.recovery.keepReasonChanged":
    "The reviewed results changed. Read the current results before choosing again.",
  "chat.recovery.keepReasonPreview":
    "A different review is open. Resolve that review before choosing again.",
  "chat.recovery.keepReasonNoSource":
    'There is no current result that can be closed with "Keep these changes".',
  "chat.recovery.alreadyKept": "The current results are already kept.",
  "chat.recovery.stopNotSent":
    "Stop was not sent. A step already sent may still finish.",
  "chat.recovery.stopNotSentElsewhere":
    "Stop was not sent. The plan may still be running in another window or device.",
  "chat.recovery.stopUnconfirmed":
    "Stop could not be confirmed. Reconnect to check the steps.",
  "chat.recovery.cancelNotSent":
    "Cancellation was not sent. Check the current status before choosing again.",
  "chat.recovery.cancelUnconfirmed":
    "Cancellation could not be confirmed. Check the request status.",
  "chat.recovery.reviewCancelNotSent":
    "Review cancellation was not sent. Check the current status before choosing again.",
  "chat.recovery.reviewCancelUnconfirmed":
    "Review cancellation could not be confirmed. Check the request status.",
  "chat.recovery.leaveNotSent":
    "Your choice was not saved. Check the current status before choosing again.",
  "chat.recovery.leaveUnconfirmed":
    "Your choice could not be confirmed. Check the request status.",
  "chat.recovery.keepNotSent":
    'Your "Keep these changes" choice could not be sent. Check any earlier pending choice before trying again.',
  "chat.recovery.keepUnconfirmed":
    'We could not confirm whether "Keep these changes" was saved. Check its status before choosing again.',
  "chat.recovery.requestAlreadyStopped":
    "The run you asked to stop was stopped.",
  "chat.recovery.requestTargetStopped": "The targeted run is stopped.",
  "chat.recovery.requestedIntentApplied":
    "Your earlier request was applied to its original target.",
  "chat.recovery.requestedIntentNotApplied":
    "Your earlier request was not applied to its original target.",
  "chat.recovery.intentSuperseded":
    "A newer independent decision is now current. This request cannot change it.",
  "chat.recovery.intentTargetChanged":
    "A newer run or decision is current. This request did not change it.",
  "chat.recovery.alreadyClosedByWinner":
    "This plan was already stopped or closed. Your request changed nothing.",
  "chat.recovery.alreadyStoppedNeedsDecision":
    "This plan was already stopped. A decision about the recorded changes is still needed.",
  "chat.recovery.cancelStarted":
    "This plan had already started. Further steps were stopped; some changes may have been made.",
  "chat.recovery.stoppedNoChanges":
    "Stopped before execution. Nothing was changed.",
  "chat.recovery.initialTargetSettled":
    "The original action had already finished. Its results are kept; no changes were undone.",
  "chat.recovery.initialTargetStopped":
    "The original action is already stopped. Its step results are kept; no changes were undone.",
  "chat.recovery.reviewTargetSettled":
    "This review had already been confirmed and finished. Its recorded results are kept.",
  "chat.recovery.reviewTargetStopped":
    "This review had already been confirmed. Its execution is stopped; the recorded step results are kept.",
  "chat.recovery.planClosedKept":
    'Your "Keep these changes" choice was saved and this plan was closed. Site values were not changed.',
  "chat.recovery.keptForwardClosed":
    "The remaining planned steps will not run.",
  "chat.recovery.keptAlready":
    "These changes were already kept for this plan; this request did not change them.",
  "chat.recovery.leaveCompletedByKeep":
    'Your choice to leave the current results was saved; "Keep these changes" then closed the remaining choice.',
  "chat.recovery.leaveCoveredByKeep":
    'Your choice to leave the current results is covered by "Keep these changes".',
  "chat.recovery.leaveNeedsReview":
    "Your choice to leave was not saved because the results changed. Review the updated step results.",
  "chat.recovery.leaveSafetyNeedsReview":
    "The run and any remaining scheduled actions were stopped. Your choice to leave was not saved because results changed. Review the updated steps.",
  "chat.recovery.laterReceiptAfterKeep":
    'A step\'s status was confirmed after "Keep these changes" was saved. Review the updated results.',
  "chat.recovery.undoSelected": "Undo selected steps",
  "chat.recovery.continue": "Continue",
  "chat.recovery.statusProposal": "Proposed plan",
  "chat.recovery.statusCompleted": "Completed",
  "chat.recovery.stepsNotKnownYet": "Step results are not known yet.",
  "chat.recovery.stepsUnknown":
    "{count, plural, one {# step could not be confirmed} other {# steps could not be confirmed}}. Check its status before choosing what to do.",
  "chat.recovery.stepsNotDone":
    "{count, plural, one {# step was not done} other {# steps were not done}}. Review the results.",
  "chat.recovery.laterReportAfterKeep":
    'After "Keep these changes" was saved, a step was reported differently. The saved results have not changed; review the newer report below.',
  "chat.recovery.reportedDifferently": "Reported differently later",
  "chat.recovery.notAvailableYet":
    "This action is not available in this version of the app. You can leave the changes as they are, or ask for a new plan.",
  "chat.recovery.actionLoading": "Getting this action ready…",
  "chat.recovery.retryAfterSeconds":
    "{seconds, plural, one {You can try again in # second.} other {You can try again in # seconds.}}",
  "chat.recovery.keepPending": 'Saving "Keep these changes"…',
  "chat.recovery.keepRemainingSteps":
    "{count, plural, one {# planned step will not run.} other {# planned steps will not run.}}",
  "chat.recovery.signInRequired": "Sign in again, then try this request again.",
  "chat.recovery.requestRefused":
    "The site refused this request. Contact the site administrator if this continues.",
  "chat.recovery.acknowledgmentAhead":
    "This choice was based on newer results than the site has. Refresh and choose again.",
  "chat.recovery.cancelCoveredByLeaveSafety":
    "The plan had already been stopped by a choice to leave, so cancellation was not needed.",
  "chat.recovery.cancelCoveredByStopNoChanges":
    "The plan had already stopped before it ran. Nothing was changed.",
  "chat.recovery.cancelDefeatedByStop":
    "The plan had already been stopped, so cancellation was not needed.",
  "chat.recovery.choiceReplacedByStop":
    "The earlier choice was applied; the plan was then stopped.",
  "chat.recovery.initialTargetClosed":
    "The original action is already closed. Its results are kept.",
  "chat.recovery.keepDefeatedByWinner":
    '"Keep these changes" was not saved because another decision was recorded first. Read the current results and choose again.',
  "chat.recovery.leaveDefeatedByWinner":
    "The choice to leave changes as they are was not saved because another decision was recorded first.",
  "chat.recovery.leaveNoDecision":
    "There is no current result to leave as it is.",
  "chat.recovery.leaveSafetyAlreadyStopped":
    "The plan was already stopped. A decision about the recorded changes is still needed.",
  "chat.recovery.reopenedEvidence":
    "A newer step status reopened this decision. Review the updated results.",
  "chat.recovery.winnerStopUser": "A stop was requested for this plan.",
  "chat.recovery.winnerStopConnection":
    "This plan stopped because the connection was lost.",
  "chat.recovery.winnerStopRenewal":
    "This plan stopped because permission to continue could not be renewed.",
  "chat.recovery.winnerStopStep": "This plan stopped after a step failed.",
  "chat.recovery.winnerStopStepUp":
    "This plan stopped because the required verification was not completed.",
  "chat.recovery.winnerStopIdentity":
    "This plan stopped because its execution identity could no longer be verified.",
  "chat.recovery.winnerStopAttribution":
    "This plan stopped because a step's recorded result could not be confirmed.",
  "chat.recovery.winnerStopChanged":
    "This plan stopped because its reviewed steps changed.",
  "chat.recovery.winnerStopAdapter":
    "This plan stopped because required execution details could not be received.",
  "chat.recovery.winnerCancel": "Cancelling this plan was requested.",
  "chat.recovery.winnerLeave":
    "A choice to leave the changes as they are was recorded.",
  "chat.recovery.winnerKeep":
    '"Keep these changes" was recorded for this plan.',
  "chat.recovery.stepStatusChanged": "Step status updated.",
  "chat.recovery.stepNotKnownYet": "Not known yet",
};
export const recoverySimplifiedChinese: Record<
  keyof RecoveryCatalogue,
  string
> = {
  "chat.recovery.heading": "检查计划状态",
  "chat.recovery.updateToControl":
    "请更新应用后再操作此计划。此处仍显示已记录的状态。",
  "chat.recovery.stopping": "正在停止后续步骤…",
  "chat.recovery.cancelling": "正在取消…",
  "chat.recovery.leavePending": "正在保存保持现状的选择…",
  "chat.recovery.currentRunning":
    "此计划目前正在执行。请先停止执行，再审阅其他操作。",
  "chat.recovery.currentStopped":
    "此计划已停止。已记录的结果可能包含已经生效的修改。",
  "chat.recovery.cancelledNoChanges": "已取消，未做任何修改。",
  "chat.recovery.leftKnown":
    "已保持现状。现有修改将予以保留；此计划不会再执行后续步骤。",
  "chat.recovery.leftUnconfirmed":
    "已保持现状；有 {count} 个步骤的状态无法确认。",
  "chat.recovery.keptKnown": "已保留当前结果；此计划不会再执行后续步骤。",
  "chat.recovery.done": "已完成",
  "chat.recovery.notDone": "未完成",
  "chat.recovery.unknown": "无法确认",
  "chat.recovery.stopped": "已停止。部分修改可能已经生效。",
  "chat.recovery.capabilityMissing": "此站点不支持此恢复操作。",
  "chat.recovery.intentPendingReason":
    "请等待此请求处理完成后，再确认其他操作。",
  "chat.recovery.refreshConversation": "刷新对话",
  "chat.recovery.hostGuidance": "如果此问题持续出现，请联系站点管理员。",
  "chat.recovery.checkIntentStatus": "检查请求状态",
  "chat.recovery.checkSavedChoice": "检查选择是否已保存",
  "chat.recovery.checkKeepStatus": "检查保留决定状态",
  "chat.recovery.keepChanges": "保留这些修改",
  "chat.recovery.leave": "保持现状",
  "chat.recovery.confirmKeepForwardOnly":
    "是否保留当前结果并关闭此计划？剩余计划步骤将不再执行。此计划没有可结束的撤销选项，站点中的值也不会更改。",
  "chat.recovery.confirmEndRetention":
    "是否保留当前结果并结束此计划记录的保留？没有剩余计划步骤或撤销选项。站点中的值不会更改。",
  "chat.recovery.keepReasonActive":
    "已确认的动作仍在执行或暂停中。请先查看该动作。",
  "chat.recovery.keepReasonUnknown": "部分结果无法确认。请先检查其状态。",
  "chat.recovery.keepReasonUnavailable":
    "此操作在当前账户或对话中不可用。请查看可访问的状态或联系服务提供方。",
  "chat.recovery.keepReasonChanged":
    "先前审阅的结果已变更。请先查看当前结果，再作选择。",
  "chat.recovery.keepReasonPreview":
    "另一个审阅仍处于打开状态。请先处理该审阅，再作选择。",
  "chat.recovery.keepReasonNoSource":
    "当前没有可通过“保留这些修改”决定关闭的结果。",
  "chat.recovery.alreadyKept": "当前结果已保留。",
  "chat.recovery.stopNotSent": "停止请求未能发送。已发送的步骤仍可能完成。",
  "chat.recovery.stopNotSentElsewhere":
    "停止请求未能发送。此计划可能仍在另一个窗口或设备中执行。",
  "chat.recovery.stopUnconfirmed":
    "无法确认是否已停止。请重新连接后检查各步骤。",
  "chat.recovery.cancelNotSent":
    "取消请求未能发送。请先检查当前状态，再重新选择。",
  "chat.recovery.cancelUnconfirmed": "无法确认是否已取消。请检查请求状态。",
  "chat.recovery.reviewCancelNotSent":
    "取消审阅的请求未能发送。请先检查当前状态，再重新选择。",
  "chat.recovery.reviewCancelUnconfirmed":
    "无法确认是否已取消审阅。请检查请求状态。",
  "chat.recovery.leaveNotSent":
    "您的选择未能保存。请先检查当前状态，再重新选择。",
  "chat.recovery.leaveUnconfirmed":
    "无法确认您的选择是否已保存。请检查请求状态。",
  "chat.recovery.keepNotSent":
    "您的“保留这些修改”选择未能发送。请先检查此前待确认的选择，再重试。",
  "chat.recovery.keepUnconfirmed":
    "无法确认是否已保存“保留这些修改”。请先检查状态，再作选择。",
  "chat.recovery.requestAlreadyStopped": "您要求停止的对应执行已停止。",
  "chat.recovery.requestTargetStopped": "对应执行已停止。",
  "chat.recovery.requestedIntentApplied": "您的先前请求已对原定目标生效。",
  "chat.recovery.requestedIntentNotApplied": "您的先前请求未对原定目标生效。",
  "chat.recovery.intentSuperseded":
    "当前已有新的独立决定。此请求不能更改该决定。",
  "chat.recovery.intentTargetChanged":
    "当前已有新的执行或决定。此请求未改变该状态。",
  "chat.recovery.alreadyClosedByWinner":
    "此计划已经停止或关闭。您的请求未改变当前状态。",
  "chat.recovery.alreadyStoppedNeedsDecision":
    "此计划已经停止。仍需对已记录的修改作出决定。",
  "chat.recovery.cancelStarted":
    "此计划已经开始执行。后续步骤已停止；部分修改可能已经生效。",
  "chat.recovery.stoppedNoChanges": "已在执行前停止。未做任何修改。",
  "chat.recovery.initialTargetSettled":
    "原操作已完成。其结果将予以保留；未撤销任何修改。",
  "chat.recovery.initialTargetStopped":
    "原操作已停止。各步骤的结果将予以保留；未撤销任何修改。",
  "chat.recovery.reviewTargetSettled":
    "此次审阅已确认并执行结束。已记录的结果将予以保留。",
  "chat.recovery.reviewTargetStopped":
    "此次审阅已确认。对应执行已停止；已记录的各步骤结果将予以保留。",
  "chat.recovery.planClosedKept":
    "您的“保留这些修改”选择已保存，计划已关闭。站点中的值未被更改。",
  "chat.recovery.keptForwardClosed": "剩余计划步骤将不再执行。",
  "chat.recovery.keptAlready": "此计划的修改此前已被保留；本次请求未作更改。",
  "chat.recovery.leaveCompletedByKeep":
    "您保持当前结果的选择已保存；随后“保留这些修改”决定结束了剩余选项。",
  "chat.recovery.leaveCoveredByKeep":
    "您保持当前结果的选择已包含在“保留这些修改”决定中。",
  "chat.recovery.leaveNeedsReview":
    "由于结果已变更，保持现状的选择未能保存。请查看更新后的各步骤结果。",
  "chat.recovery.leaveSafetyNeedsReview":
    "当前执行及剩余定时动作（如有）已停止。由于结果已变更，保持现状的选择未能保存。请查看更新后的各步骤。",
  "chat.recovery.laterReceiptAfterKeep":
    "保存“保留这些修改”决定后，一个步骤的状态得到了确认。请查看更新后的结果。",
  "chat.recovery.undoSelected": "撤销所选步骤",
  "chat.recovery.continue": "继续",
  "chat.recovery.statusProposal": "拟议计划",
  "chat.recovery.statusCompleted": "已完成",
  "chat.recovery.stepsNotKnownYet": "各步骤的结果暂未获知。",
  "chat.recovery.stepsUnknown":
    "有 {count} 个步骤的状态无法确认。请先检查状态，再决定下一步。",
  "chat.recovery.stepsNotDone": "有 {count} 个步骤未完成。请查看结果。",
  "chat.recovery.laterReportAfterKeep":
    "保存“保留这些修改”后，有步骤出现了不同的状态报告。已保存的结果没有改变；请查看下方的新报告。",
  "chat.recovery.reportedDifferently": "之后的报告与此不同",
  "chat.recovery.notAvailableYet":
    "此版本的应用暂不支持此操作。您可以保持现状，或提出新计划。",
  "chat.recovery.actionLoading": "正在准备此操作…",
  "chat.recovery.retryAfterSeconds": "{seconds} 秒后可以重试。",
  "chat.recovery.keepPending": "正在保存“保留这些修改”…",
  "chat.recovery.keepRemainingSteps": "将有 {count} 个计划步骤不再执行。",
  "chat.recovery.signInRequired": "请重新登录，然后再试一次此请求。",
  "chat.recovery.requestRefused":
    "站点拒绝了此请求。如果此问题持续出现，请联系站点管理员。",
  "chat.recovery.acknowledgmentAhead":
    "此选择所依据的结果比站点记录的更新。请刷新后重新选择。",
  "chat.recovery.cancelCoveredByLeaveSafety":
    "此计划已因保持现状的选择而停止，无需再取消。",
  "chat.recovery.cancelCoveredByStopNoChanges":
    "此计划已在执行前停止，未做任何修改。",
  "chat.recovery.cancelDefeatedByStop": "此计划已经停止，无需再取消。",
  "chat.recovery.choiceReplacedByStop": "先前的选择已生效，随后计划已停止。",
  "chat.recovery.initialTargetClosed": "原操作已关闭，其结果将予以保留。",
  "chat.recovery.keepDefeatedByWinner":
    "由于已先记录了其他决定，“保留这些修改”未能保存。请查看当前结果，再作选择。",
  "chat.recovery.leaveDefeatedByWinner":
    "由于已先记录了其他决定，保持现状的选择未能保存。",
  "chat.recovery.leaveNoDecision": "当前没有可以保持现状的结果。",
  "chat.recovery.leaveSafetyAlreadyStopped":
    "此计划已经停止。仍需对已记录的修改作出决定。",
  "chat.recovery.reopenedEvidence":
    "有步骤的新状态使此决定重新打开。请查看更新后的结果。",
  "chat.recovery.winnerStopUser": "已有人要求停止此计划。",
  "chat.recovery.winnerStopConnection": "此计划因连接中断而停止。",
  "chat.recovery.winnerStopRenewal": "此计划因无法续期执行权限而停止。",
  "chat.recovery.winnerStopStep": "此计划在一个步骤失败后停止。",
  "chat.recovery.winnerStopStepUp": "此计划因未完成所需验证而停止。",
  "chat.recovery.winnerStopIdentity": "此计划因无法继续验证执行身份而停止。",
  "chat.recovery.winnerStopAttribution":
    "此计划因无法确认一个步骤的记录结果而停止。",
  "chat.recovery.winnerStopChanged": "此计划因已审阅的步骤发生变更而停止。",
  "chat.recovery.winnerStopAdapter": "此计划因未能接收所需的执行信息而停止。",
  "chat.recovery.winnerCancel": "已有人要求取消此计划。",
  "chat.recovery.winnerLeave": "已记录保持现状的选择。",
  "chat.recovery.winnerKeep": "已为此计划记录“保留这些修改”。",
  "chat.recovery.stepStatusChanged": "步骤状态已更新。",
  "chat.recovery.stepNotKnownYet": "暂未获知",
};

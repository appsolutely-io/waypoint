// The design's frozen whole messages (copied from the design, not from the
// source) and the new keys approved with the tables.
export default {
  frozen: {
    // The read-only plan's explanation, as the phase table states it.
    updateToControl: {
      en: "Update the app to control this plan. Its recorded status is shown here.",
      zh: "请更新应用后再操作此计划。此处仍显示已记录的状态。",
    },
    heading: {
      en: "Review the plan's status",
      zh: "检查计划状态",
    },
    stopping: {
      en: "Stopping further steps…",
      zh: "正在停止后续步骤…",
    },
    cancelling: {
      en: "Cancelling…",
      zh: "正在取消…",
    },
    leavePending: {
      en: "Saving your choice to leave changes as they are…",
      zh: "正在保存保持现状的选择…",
    },
    currentRunning: {
      en: "The plan is running now. Stop it before reviewing another action.",
      zh: "此计划目前正在执行。请先停止执行，再审阅其他操作。",
    },
    currentStopped: {
      en: "The plan is stopped. Recorded results may include changes already made.",
      zh: "此计划已停止。已记录的结果可能包含已经生效的修改。",
    },
    cancelledNoChanges: {
      en: "Cancelled; nothing was changed.",
      zh: "已取消，未做任何修改。",
    },
    leftKnown: {
      en: "Left as is. Existing changes are kept; no further steps will run from this plan.",
      zh: "已保持现状。现有修改将予以保留；此计划不会再执行后续步骤。",
    },
    leftUnconfirmed: {
      en: "Left as is; {count, plural, one {# step could not be confirmed} other {# steps could not be confirmed}}.",
      zh: "已保持现状；有 {count} 个步骤的状态无法确认。",
    },
    keptKnown: {
      en: "Current results kept; no further steps will run from this plan.",
      zh: "已保留当前结果；此计划不会再执行后续步骤。",
    },
    done: {
      en: "Done",
      zh: "已完成",
    },
    notDone: {
      en: "Not done",
      zh: "未完成",
    },
    unknown: {
      en: "Could not be confirmed",
      zh: "无法确认",
    },
    stopped: {
      en: "Stopped. Some changes may already have been made.",
      zh: "已停止。部分修改可能已经生效。",
    },
    capabilityMissing: {
      en: "This site does not support this recovery action.",
      zh: "此站点不支持此恢复操作。",
    },
    intentPendingReason: {
      en: "Wait for this request to be resolved before confirming another action.",
      zh: "请等待此请求处理完成后，再确认其他操作。",
    },
    refreshConversation: {
      en: "Refresh conversation",
      zh: "刷新对话",
    },
    hostGuidance: {
      en: "Contact the site administrator if this problem continues.",
      zh: "如果此问题持续出现，请联系站点管理员。",
    },
    checkIntentStatus: {
      en: "Check request status",
      zh: "检查请求状态",
    },
    checkSavedChoice: {
      en: "Check saved choice",
      zh: "检查选择是否已保存",
    },
    checkKeepStatus: {
      en: "Check Keep status",
      zh: "检查保留决定状态",
    },
    keepChanges: {
      en: "Keep these changes",
      zh: "保留这些修改",
    },
    leave: {
      en: "Leave as is",
      zh: "保持现状",
    },
    confirmKeepForwardOnly: {
      en: "Keep the current results and close this plan? Remaining planned steps will not run. This plan has no Undo choice to end, and site values will not change.",
      zh: "是否保留当前结果并关闭此计划？剩余计划步骤将不再执行。此计划没有可结束的撤销选项，站点中的值也不会更改。",
    },
    confirmEndRetention: {
      en: "Keep the current results and close this plan's retained record? No planned steps or Undo choices remain. Site values will not change.",
      zh: "是否保留当前结果并结束此计划记录的保留？没有剩余计划步骤或撤销选项。站点中的值不会更改。",
    },
    keepReasonActive: {
      en: "A confirmed action is still in progress or paused. Review that action first.",
      zh: "已确认的动作仍在执行或暂停中。请先查看该动作。",
    },
    keepReasonUnknown: {
      en: "Some results could not be confirmed. Check their status first.",
      zh: "部分结果无法确认。请先检查其状态。",
    },
    keepReasonUnavailable: {
      en: "This action is unavailable in the current account or conversation. Review the available status or contact the host.",
      zh: "此操作在当前账户或对话中不可用。请查看可访问的状态或联系服务提供方。",
    },
    keepReasonChanged: {
      en: "The reviewed results changed. Read the current results before choosing again.",
      zh: "先前审阅的结果已变更。请先查看当前结果，再作选择。",
    },
    keepReasonPreview: {
      en: "A different review is open. Resolve that review before choosing again.",
      zh: "另一个审阅仍处于打开状态。请先处理该审阅，再作选择。",
    },
    keepReasonNoSource: {
      en: 'There is no current result that can be closed with "Keep these changes".',
      zh: "当前没有可通过“保留这些修改”决定关闭的结果。",
    },
    alreadyKept: {
      en: "The current results are already kept.",
      zh: "当前结果已保留。",
    },
    stopNotSent: {
      en: "Stop was not sent. A step already sent may still finish.",
      zh: "停止请求未能发送。已发送的步骤仍可能完成。",
    },
    stopNotSentElsewhere: {
      en: "Stop was not sent. The plan may still be running in another window or device.",
      zh: "停止请求未能发送。此计划可能仍在另一个窗口或设备中执行。",
    },
    stopUnconfirmed: {
      en: "Stop could not be confirmed. Reconnect to check the steps.",
      zh: "无法确认是否已停止。请重新连接后检查各步骤。",
    },
    cancelNotSent: {
      en: "Cancellation was not sent. Check the current status before choosing again.",
      zh: "取消请求未能发送。请先检查当前状态，再重新选择。",
    },
    cancelUnconfirmed: {
      en: "Cancellation could not be confirmed. Check the request status.",
      zh: "无法确认是否已取消。请检查请求状态。",
    },
    reviewCancelNotSent: {
      en: "Review cancellation was not sent. Check the current status before choosing again.",
      zh: "取消审阅的请求未能发送。请先检查当前状态，再重新选择。",
    },
    reviewCancelUnconfirmed: {
      en: "Review cancellation could not be confirmed. Check the request status.",
      zh: "无法确认是否已取消审阅。请检查请求状态。",
    },
    leaveNotSent: {
      en: "Your choice was not saved. Check the current status before choosing again.",
      zh: "您的选择未能保存。请先检查当前状态，再重新选择。",
    },
    leaveUnconfirmed: {
      en: "Your choice could not be confirmed. Check the request status.",
      zh: "无法确认您的选择是否已保存。请检查请求状态。",
    },
    keepNotSent: {
      en: 'Your "Keep these changes" choice could not be sent. Check any earlier pending choice before trying again.',
      zh: "您的“保留这些修改”选择未能发送。请先检查此前待确认的选择，再重试。",
    },
    keepUnconfirmed: {
      en: 'We could not confirm whether "Keep these changes" was saved. Check its status before choosing again.',
      zh: "无法确认是否已保存“保留这些修改”。请先检查状态，再作选择。",
    },
    requestAlreadyStopped: {
      en: "The run you asked to stop was stopped.",
      zh: "您要求停止的对应执行已停止。",
    },
    requestTargetStopped: {
      en: "The targeted run is stopped.",
      zh: "对应执行已停止。",
    },
    requestedIntentApplied: {
      en: "Your earlier request was applied to its original target.",
      zh: "您的先前请求已对原定目标生效。",
    },
    requestedIntentNotApplied: {
      en: "Your earlier request was not applied to its original target.",
      zh: "您的先前请求未对原定目标生效。",
    },
    intentSuperseded: {
      en: "A newer independent decision is now current. This request cannot change it.",
      zh: "当前已有新的独立决定。此请求不能更改该决定。",
    },
    intentTargetChanged: {
      en: "A newer run or decision is current. This request did not change it.",
      zh: "当前已有新的执行或决定。此请求未改变该状态。",
    },
    alreadyClosedByWinner: {
      en: "This plan was already stopped or closed. Your request changed nothing.",
      zh: "此计划已经停止或关闭。您的请求未改变当前状态。",
    },
    alreadyStoppedNeedsDecision: {
      en: "This plan was already stopped. A decision about the recorded changes is still needed.",
      zh: "此计划已经停止。仍需对已记录的修改作出决定。",
    },
    cancelStarted: {
      en: "This plan had already started. Further steps were stopped; some changes may have been made.",
      zh: "此计划已经开始执行。后续步骤已停止；部分修改可能已经生效。",
    },
    stoppedNoChanges: {
      en: "Stopped before execution. Nothing was changed.",
      zh: "已在执行前停止。未做任何修改。",
    },
    initialTargetSettled: {
      en: "The original action had already finished. Its results are kept; no changes were undone.",
      zh: "原操作已完成。其结果将予以保留；未撤销任何修改。",
    },
    initialTargetStopped: {
      en: "The original action is already stopped. Its step results are kept; no changes were undone.",
      zh: "原操作已停止。各步骤的结果将予以保留；未撤销任何修改。",
    },
    reviewTargetSettled: {
      en: "This review had already been confirmed and finished. Its recorded results are kept.",
      zh: "此次审阅已确认并执行结束。已记录的结果将予以保留。",
    },
    reviewTargetStopped: {
      en: "This review had already been confirmed. Its execution is stopped; the recorded step results are kept.",
      zh: "此次审阅已确认。对应执行已停止；已记录的各步骤结果将予以保留。",
    },
    planClosedKept: {
      en: 'Your "Keep these changes" choice was saved and this plan was closed. Site values were not changed.',
      zh: "您的“保留这些修改”选择已保存，计划已关闭。站点中的值未被更改。",
    },
    keptForwardClosed: {
      en: "The remaining planned steps will not run.",
      zh: "剩余计划步骤将不再执行。",
    },
    leaveCompletedByKeep: {
      en: 'Your choice to leave the current results was saved; "Keep these changes" then closed the remaining choice.',
      zh: "您保持当前结果的选择已保存；随后“保留这些修改”决定结束了剩余选项。",
    },
    leaveCoveredByKeep: {
      en: 'Your choice to leave the current results is covered by "Keep these changes".',
      zh: "您保持当前结果的选择已包含在“保留这些修改”决定中。",
    },
    leaveNeedsReview: {
      en: "Your choice to leave was not saved because the results changed. Review the updated step results.",
      zh: "由于结果已变更，保持现状的选择未能保存。请查看更新后的各步骤结果。",
    },
    leaveSafetyNeedsReview: {
      en: "The run and any remaining scheduled actions were stopped. Your choice to leave was not saved because results changed. Review the updated steps.",
      zh: "当前执行及剩余定时动作（如有）已停止。由于结果已变更，保持现状的选择未能保存。请查看更新后的各步骤。",
    },
    laterReceiptAfterKeep: {
      en: 'A step\'s status was confirmed after "Keep these changes" was saved. Review the updated results.',
      zh: "保存“保留这些修改”决定后，一个步骤的状态得到了确认。请查看更新后的结果。",
    },
    undoSelected: {
      en: "Undo selected steps",
      zh: "撤销所选步骤",
    },
    continue: {
      en: "Continue",
      zh: "继续",
    },
  },
  new: [
    "acknowledgmentAhead",
    "actionLoading",
    "cancelCoveredByLeaveSafety",
    "cancelCoveredByStopNoChanges",
    "cancelDefeatedByStop",
    "choiceReplacedByStop",
    "initialTargetClosed",
    "keepDefeatedByWinner",
    "keepPending",
    "keepRemainingSteps",
    "keptAlready",
    "laterReportAfterKeep",
    "leaveDefeatedByWinner",
    "leaveNoDecision",
    "leaveSafetyAlreadyStopped",
    "notAvailableYet",
    "reopenedEvidence",
    "reportedDifferently",
    "requestRefused",
    "retryAfterSeconds",
    "signInRequired",
    "statusCompleted",
    "statusProposal",
    "stepNotKnownYet",
    "stepStatusChanged",
    "stepsNotDone",
    "stepsNotKnownYet",
    "stepsUnknown",
    "winnerCancel",
    "winnerKeep",
    "winnerLeave",
    "winnerStopAdapter",
    "winnerStopAttribution",
    "winnerStopChanged",
    "winnerStopConnection",
    "winnerStopIdentity",
    "winnerStopRenewal",
    "winnerStopStep",
    "winnerStopStepUp",
    "winnerStopUser",
  ],
} as const;

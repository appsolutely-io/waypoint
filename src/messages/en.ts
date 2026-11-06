/* Generated from the message catalogues by scripts/generate.mjs. */
// No imports: a host's bundle takes only this language's text.
const messages: Readonly<Record<string, string>> = Object.freeze({
  "form.valid": "Valid",
  "form.invalid": "Invalid",
  "form.title": "Fill this form",
  "form.closeHint":
    "Closing discards this fill; the reply stays in the conversation.",
  "form.generate": "Generate draft",
  "form.references": "Reference links",
  "form.attachment": "Private attachment",
  "form.regenerate": "Regenerate {field}",
  "form.replace": "Replace your edit?",
  "form.marker": "Form",
  "form.filter": "Filter by topic",
  "form.all": "All topics",
  "form.threads": "Sub-threads",
  "form.return": "Back to form or record",
  "form.unlinked": "Saved, not linked",
  "form.toolsLoading": "Draft tools are still loading.",
  "form.toolsFailed": "Draft tools couldn't load. Retry first.",
  "form.fixFirst": "Fix the highlighted fields first.",
  "form.number": "Enter a number.",
  "form.editInForm": "Edit this value in the form.",
  "form.imagesNow": "Images can't be attached right now.",
  "form.imagesHere": "Images can't be attached here.",
  "chat.title": "Conversation",
  "chat.empty": "Start a conversation",
  "chat.message": "Message",
  "chat.send": "Send",
  "chat.sending": "Sending",
  "chat.pendingSending": "Sending…",
  "chat.pendingFailed": "Not sent",
  "chat.planUnavailable": "The plan's steps could not be loaded.",
  "chat.arrival": "New reply",
  "chat.arrivalExcerpt": "New reply: {excerpt}",
  "chat.arrivalFailed": "A reply could not be completed.",
  "chat.arrivalMany": "{count} new replies. Latest: {excerpt}",
  "chat.arrivalManyPlain": "{count} new replies",
  "chat.arrivalManyFailed":
    "{count} new replies; {failed} could not be completed.",
  "chat.arrivalAllFailed": "{count} replies could not be completed.",
  "chat.transcript": "Messages",
  "chat.outlineItem": "{role}, message {position}: {excerpt}",
  "chat.outlineItemPlain": "{role}, message {position}",
  "chat.roleUser": "You",
  "chat.roleAssistant": "Assistant",
  "chat.messageLoading": "Loading message…",
  "chat.messageUnavailable": "This message cannot be shown right now.",
  "chat.changesTo": "changes to",
  "chat.stepName": "Change {index}",
  "chat.stepNamed": "{name} {index}",
  "chat.fieldName": "Value {index}",
  "chat.scrollRegion": "Scrollable content",
  "chat.conversationReadFailed": "This conversation could not be loaded.",
  "chat.conversationsFailed": "Your conversations could not be loaded.",
  "chat.messagesUnavailable": "Some messages cannot be shown right now.",
  unsupportedContent:
    "Some content cannot be shown here. Contact the site administrator.",
  "chat.failure": "The request could not be completed.",
  "chat.update": "This chat needs an update.",
  "chat.conversationUnavailable":
    "This conversation is unavailable. Reload to continue; this does not stop a server turn.",
  "chat.reload": "Reload conversation",
  "chat.retry": "Retry",
  "chat.withdraw": "Withdraw",
  "chat.restored": "Withdrawn messages",
  "chat.restoredEdit": "Edit",
  "chat.restoredDiscard": "Discard",
  "chat.dismiss": "Dismiss",
  "chat.latest": "Back to latest",
  "chat.latestNew":
    "{count, plural, one {Back to latest, # new reply} other {Back to latest, # new replies}}",
  "chat.outline": "Message outline",
  "chat.rail": "Conversations",
  "chat.close": "Close",
  "chat.quota": "Usage",
  "chat.actions": "Actions",
  "chat.panels": "Extra panels",
  "chat.submit": "Submit",
  "chat.confirm": "Confirm",
  "chat.cancel": "Cancel",
  "chat.stop": "Stop",
  "chat.planChanged": "The plan changed; confirm again.",
  "chat.stopped": "The plan was stopped. Start a new plan to continue.",
  "chat.scheduleUnavailable": "Scheduling is unavailable in this chat.",
  "chat.start": "Start time",
  "chat.end": "End time",
  "chat.view": "View change",
  "chat.irreversible": "Cannot be undone",
  "chat.stepUp":
    "{count, plural, one {# verification prompt} other {# verification prompts}}",
  "chat.stepUpLabel": "Verification code",
  "chat.plan": "Plan",
  "chat.favourite": "Favourite",
  "chat.run": "Run",
  "chat.flows": "Saved requests",
  "flow.favourites": "Favourites",
  "flow.most-used": "Most used",
  "flow.recent": "Recent",
  "flow.presets": "Presets",
  "reply.writing": "Writing",
  "reply.unavailable": "Reply unavailable",
  "reply.failed": "Reply failed",
  "reply.overdue": "Reply overdue",
  "chat.loading": "Loading",
  "chat.before": "Before",
  "chat.after": "After",
  "chat.undo": "Undo",
  "chat.verify": "Verification required",
  "chat.startupLoading": "Loading this conversation…",
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
  "chat.confirmation.heading": "Review these changes",
  "chat.confirmation.apply": "Apply these changes",
  "chat.confirmation.schedule": "Schedule these changes",
  "chat.confirmation.unavailable":
    "This plan can't be confirmed in this app. Ask the site administrator to update it.",
  "chat.confirmation.expired":
    "This confirmation has expired. Ask for the plan again to review it.",
  "chat.confirmation.used":
    "This confirmation was already used. Check the plan's status below before doing anything else.",
  "chat.confirmation.changed":
    "This plan changed. Review it again before you confirm.",
  "chat.confirmation.mismatch":
    "This confirmation belongs to a different plan. Open the current plan and review it.",
  "chat.confirmation.irreversible": "This change cannot be undone.",
  "chat.confirmation.before": "Before",
  "chat.confirmation.after": "After",
  "chat.confirmation.refresh": "Refresh",
  "chat.confirmation.verifications":
    "{count, plural, one {# verification is needed} other {# verifications are needed}}.",
  "chat.confirmation.expires": "Valid until {time}",
  "chat.confirmation.showAll": "Show all {count} items",
  "chat.block.required": "{label} (required)",
  "chat.block.requiredMissing": "Fill in the required fields to submit.",
  "chat.block.answerMissing": "Answer the question to submit.",
  "chat.block.empty": "—",
  "chat.block.tierLow": "Low risk",
  "chat.block.tierSensitive": "Sensitive",
  "chat.block.undoCompareAndSet": "Undo restores the previous values",
  "chat.block.undoArchiveCreated": "Undo archives what was created",
  "chat.block.undoInverse": "Undo runs a reverse step",
  "chat.block.status": "Status: {status}",
  "chat.block.outcomeDone": "Done",
  "chat.block.outcomeFailed": "Failed",
  "chat.block.state.proposed": "Proposed",
  "chat.block.state.awaiting-confirmation": "Waiting for confirmation",
  "chat.block.state.running": "Running",
  "chat.block.state.undoing": "Undoing",
  "chat.block.state.completed": "Completed",
  "chat.block.state.submitted": "Submitted",
  "chat.block.state.undone": "Undone",
  "chat.block.state.needs-attention": "Needs attention",
  "chat.block.state.cancelled": "Cancelled",
  "chat.block.run": "Run",
  "chat.block.runMissing": "Fill in the required fields to run.",
  "chat.block.favourite": "Favourite: {title}",
  "chat.block.flowLoading": "Loading request…",
  "chat.block.flowsLoading": "Loading saved requests…",
  "chat.block.flowsEmpty": "No saved requests here yet.",
  "chat.problem.signIn": "Sign in again to continue.",
  "chat.problem.retryable": "Something went wrong for a moment. Try again.",
  "chat.problem.rateLimited":
    "There are too many requests right now. Wait a moment, then try again.",
  "chat.problem.refused": "The site refused this request.",
  "chat.problem.closed": "This conversation is closed.",
  "chat.problem.full":
    "There is no room for more right now. Free some space, then try again.",
  "chat.problem.declined": "This plan was declined.",
  "chat.problem.unavailable": "The site is unavailable right now. Try again.",
  "chat.problem.stepUp": "Verification was cancelled.",
  "chat.problem.invalid":
    "This plan can't be used as it is. Ask for a new plan.",
  "chat.problem.mismatch":
    "Something changed since this plan was made. Review the current values.",
  "chat.problem.agreement":
    "The connection could not be renewed. Retry to check the current status.",
  "chat.problem.inDoubt":
    "We couldn't confirm what happened. Check the current status before trying again.",
  "chat.problem.replaced": "A newer version replaced this. Refresh to see it.",
  "chat.problem.needsAttention":
    "This plan needs your attention. Review its status.",
});
export default messages;

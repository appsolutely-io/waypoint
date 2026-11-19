# Reply protocol

What a host implements so the chat can show a reply as it is written and let the user act on it. Each feature here is optional and negotiated or announced by the host: a host that implements none of it stays valid.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT" and "MAY" in this document are to be interpreted as described in [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals.

## Naming a step

A `tool.call` frame asks the client to read data for the reply it is writing. Its call MAY carry `label`, the host's plain words for the step, such as "Reading 3 orders…". The chat shows the latest step on one line above the reply row, and every step since the user's last message behind "Show all 2 steps"; each is running, done or failed. Without a label the step reads "Looking this up…".

- A host SHOULD give every call a `label`, in the conversation's language, at most 200 characters.
- A label is shown as plain text, never as markup. It MUST NOT carry data the user may not see.

## Citing sources

A message MAY carry `sources`, what the reply drew on: each has an `id`, a `title` and a `url`. `[n]` in the message's text cites the n-th source; the chat links it to the source, named "Source n: title", and lists the sources under the answer behind a "Sources (2)" disclosure.

- A host SHOULD cite each source it lists at least once.
- A source's `url` MUST be one the user may open. The chat links only addresses its URL policy allows (`isSafeUrl`, with `extraUrlSchemes`); any other source is named without a link.

## Collapsing supporting detail

A `details` block holds what supports the answer but is not the answer: how it was worked out, the rows it read, the caveats. Its body has a `summary`, the words on the disclosure (at most 200 characters), and `blocks`, shown inside it. The chat draws it closed, below the answer, as a native disclosure the user opens and closes.

- A host SHOULD put the answer in the message's text and the detail that supports it in a `details` block, so the answer comes first.
- A host MUST NOT put anything the user needs to act on only inside a `details` block, since it starts closed.
- Like every block, it carries a `fallback` for clients that do not know the type.

## Asking for what is missing

A `form` block asks the user for details inline. Each field MAY carry `value`, what the host already knows for it; the form starts with it and the user may change it before sending.

- A host SHOULD fill in every field it can, so the user types only what is missing.
- A field's `value` MUST NOT hold anything the user may not see.

## Stopping a reply

A client offers the `reply-stop` capability; a host that implements stopping echoes it in its negotiation answer. Only then does the chat show Stop while a reply is written.

Stop is an ordinary reply, `{ "kind": "stop", "clientReplyId": "…", "messageId": "…", "versionIndex": 1 }`, sent to the conversation's replies route (`ReplyStop` in the schema). The client marks the reply `stopped` at once and drops any text that still arrives for it: on the stream, and in a read that still says the host is writing it, which shows the text the reply had when it was stopped.

A stop's `clientReplyId` names one attempt at the reply: the version of the message being written when the user pressed Stop. The client repeats that id only when it repeats that request. Once a new version of the message is asked for (`regenerate`, see [message versions](message-versions.md)) or starts on the stream (`message.start`), a stop of it is a new request with a new `clientReplyId`, for the same `messageId`.

A stop names the version it is for in `versionIndex`, numbered as the message's `versionIndex` (1 for a message with one version). Stop and Regenerate are separate requests, so a stop can reach the host after the next version has started; the version number keeps it off that version. The field is optional: the client leaves it out when it cannot tell how the host numbers the version being written, which happens when a reply that had ended starts again on the stream and the client has no `versions` port.

A host that answered `reply-stop`:

- MUST issue agreements (an `agreementId` in its negotiation answer). A host that issues none MUST NOT answer `reply-stop`, because it cannot tell which clients negotiated it.
- MUST accept a stop of the assistant message it is writing, stop writing it, and end it with the status `stopped` (on the stream, `message.end` with `status: "stopped"`; in every later read, the message's `status`).
- MUST keep the text the message had when it stopped. It MUST NOT blank it or replace it with another version.
- MUST answer a repeated stop with the same `clientReplyId` with its first response, as for any reply.
- MUST ignore a stop whose `versionIndex` is not the version of the message it is writing: such a stop changes nothing, and the host SHOULD accept it, as it does a stop of a message that has ended. A stop without `versionIndex` is for the version being written when the stop arrives.
- MUST treat a stop with a new `clientReplyId` as a new request, even for a message it stopped before, and stop the version of that message it names, or, when it names none, the version it is writing then.
- SHOULD accept a stop of a message that has already ended, changing nothing.
- MUST NOT send `stopped` under an agreement that does not include `reply-stop`. In every read and every `message.end` it sends under such an agreement, it MUST give a stopped message the status `failed` instead, with the text it kept. Reads are shared by every client of the conversation, and `failed` is the status such a client knows that never shows a reply that is not whole as finished (see [When a reply fails](#when-a-reply-fails)). A request that presents no agreement cannot be told apart, and MAY be sent `stopped`.

A stopped reply is a finished reply: the chat shows its text with a "Stopped" mark and the reply row is empty.

`waypoint-conformance` checks these rules when the host answers `reply-stop`: the host must have issued an agreement, a stop naming another version must leave the reply being written, and the stopped reply is read under an agreement with `reply-stop` and under one without it. It needs the test script to support a reply left being written: a turn `{ "chunks": ["Partial answer"], "ending": "held" }` streams those pieces into an assistant message and leaves it `writing`.

## When a reply fails

A host that cannot finish a reply says so in one of two ways: it ends the message with `message.end` and `status: "failed"` or `"unavailable"` (and gives the message that `status` in every later read), or it leaves the message and sets the conversation's `replyStatus` to `failed` or `unavailable`. Either way the chat says "Reply failed" or "Reply unavailable" and never shows such a reply as finished. A message the host ended says it in the message, under whatever text it had, and a screen reader hears it once, from the chat's message announcements ("A reply could not be completed."); otherwise the reply row says it, and is what a screen reader hears. Below it, in the reply row, is Retry, which never sends the user's message twice. For a message the host ended, Retry asks for the reply again as a new version (`regenerate`, see [message versions](message-versions.md)) and keeps the failed one; the chat offers it only when it was given a `versions` port, since reading the conversation again would show the same ended message. Without one, the row offers no Retry and the user goes on from the composer, sending the question again if they wish. For a conversation's `replyStatus`, Retry reads the conversation again (or regenerates the last reply, for `failed`, when there is a `versions` port).

- A host SHOULD end a reply it gave up on with one of these statuses rather than leave it `writing`.
- A host MUST NOT mark a message `completed` when its text is not the whole reply.

### Host reasons and recovery

A conversation MAY include `replyFailure: { id, forMessageId?, reason?, recovery? }` when its reply fails. The host MUST use a new `id` for a distinct episode. `forMessageId` anchors the failure to its user or assistant message; without it the explicit recovery target, or the conversational turn in the read that first supplied the episode, anchors it. Newer user turns MUST NOT inherit an earlier failure or recover its target. A partial assistant's failure appears under its partial text, once.

`reason` is safe host enum detail (`{ code, qualifier? }`, each 1–128 Unicode characters). `replyFailureText(failure)` maps a non-null reason to `{ text, action? }`; the optional action can open host settings. Missing/null reason uses neutral text, without retaining a previous reason. Missing/null `replyFailure`, or a failure without `recovery`, preserves the existing Retry policy above.

Only an explicit `recovery` changes that policy: `{ kind: "regenerate", messageId }` selects an existing assistant in the failed turn, `{ kind: "resend", messageId }` selects a user with no assistant reply, and `{ kind: "none" }` removes stock recovery, including that failed message's Regenerate. Targets MUST belong to the same conversation and failed turn; invalid or unavailable offers do not authorize another operation. A host may report a partial assistant still `writing` as conversation-failed; it has the selected recovery and no reply Stop.

Provide `replies: { recover(input) }` on the client to deliver either selected operation. `ReplyRecoveryInput` contains `conversationId`, `messageId`, `kind`, `clientReplyId` and the attempt's native cancellation `signal` (typed structurally as `ScopeSignal`). Resend asks for the missing reply and MUST NOT append another user message. Regenerate prefers this port, or uses `versions.regenerate` when only that port exists; Resend never falls back to versions or message send. `MessageVersionInput.signal?` adds cancellation to existing version adapters. `client.canRegenerate?.(messageId)` uses the same eligibility as the message and reply-row controls.

The port returns `void` when accepted, `{ accepted: false, problem }` only when no work was accepted, or throws when the outcome is unknown. Unknown outcomes and accepted attempts whose episode remains reported reuse their id on an explicit retry; definitive refusal permits a new id. A changed episode/kind/target/version receives a new id. The host MUST deduplicate `clientReplyId`. Row and message Regenerate share one in-flight attempt for a version. Withdrawal hides the offer without canceling accepted work or replaying automatically. Switching/disposal aborts the signal, settles the caller locally and releases only that attempt's ownership even if the port never settles; stale completions cannot change another visit. A new authoritative read must confirm the same episode/target/version before replay after a revisit.

## Where an error is shown

An error is shown next to what it is about, so the reader finds it where they are looking, at any width.

- **About one message.** A message the user sent that the host refused or did not receive stays in the transcript marked "Not sent", with its problem in plain words under it, its Retry, Withdraw and Dismiss, and the problem's "Details" (the error code and reference) after them. A reply the host ended as failed or unavailable says so in the reply, with Retry in the reply row right after it when the reply can be asked for again. Neither is repeated below the composer.
- **About the conversation.** Every other problem is about the conversation as a whole, not one message: a read of the conversation that failed, a stream that dropped, a plan, a saved request, the session or the agreement with the host. It is shown once, after the composer, with its one action and its "Details".

A problem is about a message when its `id` is the `clientMessageId` of a message the client could not send. Each failed row keeps its own `row.failure`; the current eligible problem with that id temporarily overrides only that row. Clearing or replacing the override restores the row's own wording, Details and action. Other failed rows keep their own problems.

A UI drawn from `/hooks` uses `visibleProblem(snapshot.problem, options)` with the same card-checking, confirmation, protected-plan stop and conversation-availability exclusions as the web chat, then `pendingProblem(row, eligibleProblem)` for each row. Only a row with non-null `failure` can own the current problem: when no such row has its id, show the problem once below the composer. This includes a retry while its row has `failure: null`; do not change the problem id or repeat it on the sending row. `problemView` provides default wording and actions; hosts may map their own text instead.

Outbox failures loaded by hydrate for the current visit display silently. `snapshot.pendingRestoration` identifies that visit and its actually loaded row ids; it never infers restoration from what a render first observed. A live refusal announces once even when creation and refusal arrive in one render. Thereafter only a row's own displayed text change announces it again; revisiting a conversation starts a new restoration baseline.

## Host problem detail

A `Problem` MAY carry `host: { code, qualifier? }` or `host: null`. Each string MUST be nonempty and at most 128 Unicode characters. These are safe host-defined enumerated values, not raw provider text; the closed `Problem.code` alone determines behavior. The host maps detail through `problemText`, for example `problem.host?.code === "availability"` with qualifier `temporary` or `permanent`. Malformed detail is omitted; no detail keeps legacy behavior.

A request refusal keeps the client's local request id, independently of any host id. Each refusal and `failedSendControls` part receives its own detached host detail. Standalone stream problems preserve their host id, including an intentional override of a failed row, except that an id colliding with a currently sending row (`failure: null`) receives a fresh client id once at frame application. That replacement never reconnects to the send after it settles. Normal successful-send clearing and failed-send replacement of the global problem remain unchanged.

Host problem ids MUST NOT use the client's fixed reserved ids `agreement`, `before-send`, `conversation-read`, `conversation-unavailable`, `flow-prepare`, `form-session`, `form-session-load`, `form-tools`, `frame-dispatch`, `intent`, `intent-load`, `intentPending`, `message-feedback`, `message-version`, `negotiation`, `on-demand-load`, `plan-decline`, `plan-keep`, `plan-leave`, `plan-read`, `read-failed`, `read-unavailable`, `sending`, `storage-read`, `storage-write`, `stream`, `stream-reads-load`, `stream-version`, or the card reply id namespaces `card:` and `card~`.

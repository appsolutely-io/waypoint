# Reply protocol

What a host implements so the chat can show a reply as it is written and let the user act on it. Each feature here is optional and negotiated or announced by the host: a host that implements none of it stays valid.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT" and "MAY" in this document are to be interpreted as described in [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals.

## Naming a step

A `tool.call` frame asks the client to read data for the reply it is writing. Its call MAY carry `label`, the host's plain words for the step, such as "Reading 3 orders…". The chat shows the latest step on one line above the reply row, and every step since the user's last message behind "Show all 2 steps"; each is running, done or failed. Without a label the step reads "Looking this up…".

Under protocol `1.2`, a host MAY announce work it runs itself with `{ type: "step", protocol, sequence, messageId, step: { id, label?, status } }`, where `status` is `running`, `done` or `failed`. The client only displays host-run work: it MUST NOT execute or answer it, or report a problem for malformed step data. The frame MUST name the current assistant message being written. A frame for an unknown, older or finished message is ignored. Repeated ids update in place without changing their position. A host SHOULD give every step a label following the rules below.

An assistant message MAY carry `steps`, an ordered array of the same step objects, in a conversation read. Hosts MUST include the steps readers should retain after a reload, including for finished replies. Signal-only transports obtain steps through these reads. Hosts MUST omit step frames and message steps under older negotiated protocols; clients retain support for `1.1` and `1.0`.

Host and client-run steps share the display for the current user turn. A repeated id retains its first display position; a host value takes precedence over a client-read value. A host SHOULD use unique step ids within a turn. User and notice messages do not own steps. A new user send clears the previous turn's display; its confirmation in a read preserves steps already received for that send. Retrying a message restored after a reload binds progress to the same client message id, and repeating that retry preserves work already shown for it. Paged reads use the complete outline's user boundary, so loading older bodies does not add another turn's steps or clear the current turn. A new assistant version clears that message's steps; ending a reply retains its recorded steps without changing their statuses.

A step requires a nonempty id and a known status. Unknown object fields are ignored. Invalid entries are dropped; an invalid optional label is omitted. Invalid step metadata never invalidates the rest of a conversation read. Duplicate ids in an array keep their first position and last valid value. An absent, invalid or empty steps array clears prior host steps in a later authoritative read. A frame's materialized steps survive a read issued before that frame; a later read replaces the whole array. Hosts MUST change the message's outline revision when steps change.

Step frames use the stream's existing increasing sequence order. A malformed envelope (including a mismatched protocol, negative/noninteger sequence or empty message id) is dropped without advancing the sequence; a valid envelope advances it even if its step payload or target is ignored. Transport JSON syntax errors retain the ordinary transport failure behavior.

- A host SHOULD give every call a `label`, in the conversation's language, at most 200 characters.
- A label is shown as plain text, never as markup. It MUST NOT carry data the user may not see.

## Citing sources

A message MAY carry `sources`, what the reply drew on: each has an `id`, a `title` and a `url`. `[n]` in the message's text cites the n-th source; the chat links it to the source, named "Source n: title", and lists the sources under the answer behind a "Sources (2)" disclosure.

- A host SHOULD cite each source it lists at least once.
- A source's `url` MUST be one the user may open. The chat links only addresses its URL policy allows (`isSafeUrl`, with `extraUrlSchemes`); any other source is named without a link.

## Attachments

A message MAY carry `attachments`, the files it brings: each has an `id`, a `name`, a `mediaType`, a `size` in bytes and optionally a `url`. The chat shows each file by its name, linked when its URL is one the user may open.

A client sends files only to a host that gave it an upload port (`ClientConfig.attachments`). The port owns the policy: the media types it takes (`accept`) and the size it allows (`maxBytes`).

The client checks that policy when a person picks the files, so the picker can say why it refused one. That check is for the picker only: a host MUST validate the type and the size of every file it receives, and MUST NOT trust the `contentType` or the `fileName` the client sends. A host SHOULD serve the stored files as attachments, or from an origin separate from the one that serves the chat.

- A client MUST send attachments only to a host that injected an upload port, and MUST NOT put the files' bytes on the wire: it sends the references the host gave.
- A client MUST send the references under the same `clientMessageId` as the message's text, so a message that is sent twice carries the same files.
- The client calls the port once per file per attempt, with the message's `clientMessageId` and the file's `index` in that message (counting from zero), until the host returns the file's id, so a host tells the files of one message apart and stores each once.
- A host MUST give every stored file an id, MUST keep that id for the same `clientMessageId` and the file's `index` in that message, and MUST return the references in its read.
- A host MAY add a `url` to a stored file. The chat links it only when its URL policy allows it (`isSafeUrl`, with `extraUrlSchemes`).
- A host MUST ignore an `attachments` field it does not know, so a host that stores no files keeps working.
- A file the host refuses, a file it cannot store and a client without an upload port fail the message itself: the message stays in the transcript marked "Not sent" with its problem under it, and the problem is not repeated below the composer.
- A message whose files the client no longer holds after a reload fails with the problem code `attachments-lost`. That code is client-only: a host MUST NOT send it, and a host that reports its own store failure sends `refused`, `rate-limited` or `unavailable` instead. The row keeps no retry, because retrying cannot bring the bytes back.

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

## Conversation reads

`TransportPort.read(conversationId, context?)` MUST remain a complete conversation read. Hosts MAY add `readPage(conversationId, input)` without changing legacy adapters. The injected adapter chooses its routes/authentication and MUST forward the portable cancellation signal and optional agreement context. Latest requests have neither selector; predecessor requests carry `cursor` and its `snapshotId`; targeted refreshes carry `aroundMessageId` under the requested snapshot. Selectors are mutually exclusive.

A successful `ConversationPage` MUST provide `conversation`, nonempty `snapshotId`, `olderCursor` (nonempty or null), a complete ordered `outline`, and `heldClientMessageIds`. Each `OutlineMessage` MUST provide id, role, nonempty opaque revision and plain text, with optional sender. The revision MUST cover every body/status/version/block-answer/sender/source/reply-step change; text MUST describe content every authorized reader may see. Page bodies MUST agree with their index membership, roles, senders and ordering. A cursor invalidated by history changes MUST return `{ stale: true }`; tail-only appends MUST keep backward cursors usable. No transport may disguise a partial conversation as a legacy full read.

Receipt answers MUST be unique ids from that call's captured `clientMessageIds`. The client settles an acknowledged message or receipt only after validation and complete atomic adoption. Omitting a pending id from the latest body page does not prove absence. A page from another conversation or failed aggregate MUST have no acknowledgement effects.

A latest refresh retains loaded bodies whose index revisions still agree, removes excluded members and privately refreshes changed loaded bodies through `aroundMessageId`. Bodies on one returned page share that read. Metadata, index, bodies and outbox facts publish atomically after every required page succeeds; otherwise the prior complete visible snapshot remains. Historical pages never overwrite newer latest metadata or incompatible body revisions. All pages fetched for a snapshot retain its issuing read generation, so a delayed page cannot retire a newer stream field. Materialized frame overlays apply once, without delta replay or frame-triggered aggregate restart. Live-only messages remain visible and join effective feed/outline order without fabricated host revisions.

The chat loads older boundaries one page at a time and exposes loading/failure/Retry. Complete outline text drives all-history filtering and positions; unloaded targets load before navigation/focus. `ClientSnapshot.history` exposes the host index plus `hasOlder`, `loading` and `failed`; `loadOlder()` and `loadMessage(id)` return whether loading/navigation succeeded. Conversation/binding changes, replaced navigation targets and superseding latest requests abort their page signals without waiting for an uncooperative adapter. Repeated or ended cursor chains fail explicitly. These guarantees require complete host indexing/receipts and their bandwidth; hosts unable to supply them MUST keep whole-conversation reads.

## Host-owned reply deadlines

`Conversation.replyOverdueAt` is an absolute Unix timestamp in milliseconds. To make it authoritative, supply `replyOverdueFor` and, for a message owner, `replyOverdueVersion`. A user owner MUST name the current confirmed user awaiting a reply; a writer owner MUST name the current assistant being written. Its positive version MUST match the message's current version (`versionIndex`, defaulting to one in reads). A started writer whose version has not been supplied by a frame or confirmed by a later read cannot accept a message-owned deadline. Existing Stop request version bookkeeping remains compatible with older adapters.

For host activity, `replyOverdueFor` MUST equal the current `replyExpectedId`, a nonempty host episode id distinct from every message id in that conversation. It has no numeric deadline version. An earlier user, writer version or activity episode cannot time the current presentation; ownership never transfers when an assistant starts. A matching past timestamp is overdue immediately, without the legacy minimum wait, and a future timestamp suppresses the fallback stall even while text arrives.

Without an owner, an unanswered user keeps the existing maximum of its creation time plus 15 seconds, the existing request-time minimum, `replyOverdueAt` and local Keep waiting. A nonmatching explicit owner does not contribute its timestamp to that maximum. An unowned writer retains its 15-second content stall; unowned host activity has no overdue timer. Keep waiting remains a local display hold for the same owner and retires when the user turn, writer/version or activity episode changes.

SSE/NDJSON `message.start` and `stale` frames MAY carry `replyOverdueAt`, `replyOverdueFor` and positive `versionIndex`. A message-owned update requires the matching owner and version; an activity update requires the matching episode. A matching null timestamp clears the deadline. Invalid optional values are ignored. Signal-only transports deliver these fields through the resulting conversation read. `message.end` does not define deadline fields. Busy labels, failure and recovery remain conversation-read-only.

An overdue writer still has partial text and remains busy: Stop stays available under its negotiated capability, Regenerate uses the existing versions port and shared attempt guard, and Keep waiting remains available. Without versions the recovery fallback reads again. An unanswered-user overdue row offers Keep waiting and read Retry. Neither presentation claims the reply permanently failed. A conversation-failed partial writer instead shows its failure and offered recovery, without writer timing or Stop.

Successful reads preserve materialized non-status fields written by an accepted frame since that read was issued, including new message membership, text, empty blocks, version and reply-field clears. Fields the frame did not write still come from the read. A later authoritative read replaces the fields it covers; text deltas are not replayed. Message status retains its independent stream/Stop reconciliation. Existing end, stale, reconnect and stream-recovery read paths are preserved.

## Host activity

`replyStatus: "expected"` means the host is busy without requiring an assistant writer. Optional `replyLabel` is plain text of at most 200 Unicode characters; absent/null uses localized waiting copy. Optional `replyExpectedId` identifies its stable activity episode for an owned deadline. Old user timestamps never infer its timeout. The public `ReplyState` union includes `expected` and `expected-overdue`; exhaustive switches MUST handle these additions. Honoring the existing expected status is an intentional behavior correction.

Provide `expectedReplyStop: { label, onPress, disabled?, busy? }` as a chat/provider option when the host offers a separate activity Stop. `HostBusyStopControl` is renderer-neutral and invokes only that host callback, never reply Stop. No descriptor means no host Stop. An overdue activity has only Keep waiting and that optional Stop; it acquires no stock Retry, Regenerate or Resend. Sending remains subject to existing composer permissions and preserves the activity label/control.

The stable Reply recovery group precedes Host activity. A retained failure keeps its text and offered recovery in its own presentation while host activity changes independently. An active writer keeps its own Stop and timing while a read may also report host activity; the host Stop stays separate, and only the writer timer runs until it ends. A new assistant start clears old active failure/activity fields. A read issued after that start may restore the same activity episode; a read issued before it cannot undo the clears. Removing a focused recovery control hands focus to its persistent group anchor under the existing focus guards.

`snapshot.replyPresentation` distinguishes `writing`, `waiting` and `expected`; `snapshot.replyBusy` carries `{ label?, overdue }` independently of the primary reply. Both `/hooks` and `/react` expose `replyRowView`: pass `presentation`, `canRegenerate`, optional `busy`, `replyLabel` and `expectedReplyStop` to receive shared wording/actions and a structured `busy` view with its kind, label/fallback key, stop descriptor and actions. `hostStop` invokes that descriptor; reply Stop uses `client.stopReply()`. A kindless overdue view retains context-neutral compatibility wording. Explicit `complete` suppresses inferred waiting only for the conversational tail in its own authoritative read, without silencing a newer user or an active writer.

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

A `Problem` MAY carry `host: { code, qualifier? }` or `host: null`. Each string MUST be nonempty and at most 128 Unicode characters. A host MUST NOT put anything in `Problem.host` that the user may not see: every reader can receive it through `problemText` and the failed-send part data. These are safe host-defined enumerated values, not raw provider text; the closed `Problem.code` alone determines behavior. The host maps detail through `problemText`, for example `problem.host?.code === "availability"` with qualifier `temporary` or `permanent`. Malformed detail is omitted; no detail keeps legacy behavior.

A request refusal keeps the client's local request id, independently of any host id. Each refusal and `failedSendControls` part receives its own detached host detail. Standalone stream problems preserve their host id, including an intentional override of a failed row, except that an id colliding with a currently sending row (`failure: null`) receives a fresh client id once at frame application. That replacement never reconnects to the send after it settles. Normal successful-send clearing and failed-send replacement of the global problem remain unchanged.

Host problem ids MUST NOT use the client's fixed reserved ids `agreement`, `before-send`, `conversation-read`, `conversation-unavailable`, `flow-prepare`, `form-session`, `form-session-load`, `form-tools`, `frame-dispatch`, `intent`, `intent-load`, `intentPending`, `message-feedback`, `message-version`, `negotiation`, `on-demand-load`, `plan-decline`, `plan-keep`, `plan-leave`, `plan-read`, `read-failed`, `read-unavailable`, `sending`, `storage-read`, `storage-write`, `stream`, `stream-reads-load`, `stream-version`, or the card reply id namespaces `card:` and `card~`.

## Message senders and notices

`Message.sender` and `FrameMessageStart.sender` optionally carry `MessageSender`: a nonempty `id`, a `name` of 1–80 characters, and optional `avatarUrl`. The name is plain text and names both the visible sender and its article, including a replaced bubble. Sender data passed to bubble/message-action parts is detached from the snapshot. A sender's name, id or avatar MUST NOT confer user/assistant permissions. Malformed sender metadata is ignored; a malformed avatar field does not discard a valid name.

Avatars use the same safe-URL and `markdownImages` origin/allow policy as Markdown images. With no image permission they cause no image request. `extraUrlSchemes` alone does not authorize images. They have empty alt text because the article names the sender, a capped token-based size, and preserve the name if loading fails.

Hosts MAY send `role: "notice"` only when `notice-messages` was offered and negotiated. Hosts MUST omit notice-only entries from reads/streams for older clients; optional sender fields can be ignored by older clients. Public role unions widen with this capability. Existing two-role messages without sender fields retain their labels and actions.

A notice stays in the complete transcript, feed positions, outline, anchors and host storage. It may Copy its visible text and retains ordinary blocks and host widgets, but cannot Edit, Regenerate, rate, Stop or select versions. It is ignored only when selecting the conversational tail: a notice alone starts no reply, a trailing notice does not erase an unanswered user's wait, and it does not interrupt or postpone an active assistant. Explicit host expected/failure/completion signals still use their ordinary rules. Missing notice sender metadata uses the localized Notice label.

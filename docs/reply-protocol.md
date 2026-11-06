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

Stop is an ordinary reply, `{ "kind": "stop", "clientReplyId": "…", "messageId": "…" }`, sent to the conversation's replies route (`ReplyStop` in the schema). The client marks the reply `stopped` at once and drops any text that still arrives for it: on the stream, and in a read that still says the host is writing it, which shows the text the reply had when it was stopped.

A stop's `clientReplyId` names one attempt at the reply: the version of the message being written when the user pressed Stop. The client repeats that id only when it repeats that request. Once a new version of the message is asked for (`regenerate`, see [message versions](message-versions.md)) or starts on the stream (`message.start`), a stop of it is a new request with a new `clientReplyId`, for the same `messageId`.

A host that answered `reply-stop`:

- MUST accept a stop of the assistant message it is writing, stop writing it, and end it with the status `stopped` (on the stream, `message.end` with `status: "stopped"`; in every later read, the message's `status`).
- MUST keep the text the message had when it stopped. It MUST NOT blank it or replace it with another version.
- MUST answer a repeated stop with the same `clientReplyId` with its first response, as for any reply.
- MUST treat a stop with a new `clientReplyId` as a new request, even for a message it stopped before, and stop the version of that message it is writing then.
- SHOULD accept a stop of a message that has already ended, changing nothing.
- MUST NOT send `stopped` to a client that did not negotiate `reply-stop`. In every read and every `message.end` it sends under an agreement that does not include `reply-stop`, it MUST give a stopped message the status `failed` instead, with the text it kept. Reads are shared by every client of the conversation, and `failed` is the status such a client knows that never shows a reply that is not whole as finished (see [When a reply fails](#when-a-reply-fails)). A request under no agreement cannot be told apart, so this applies only to hosts that issue agreements.

A stopped reply is a finished reply: the chat shows its text with a "Stopped" mark and the reply row is empty.

`waypoint-conformance` checks these rules when the host answers `reply-stop`, reading the stopped reply under an agreement with `reply-stop` and, when the host issues agreements, under one without it. It needs the test script to support a reply left being written: a turn `{ "chunks": ["Partial answer"], "ending": "held" }` streams those pieces into an assistant message and leaves it `writing`.

## When a reply fails

A host that cannot finish a reply says so in one of two ways: it ends the message with `message.end` and `status: "failed"` or `"unavailable"` (and gives the message that `status` in every later read), or it leaves the message and sets the conversation's `replyStatus` to `failed` or `unavailable`. Either way the chat says "Reply failed" or "Reply unavailable" and never shows such a reply as finished. A message the host ended says it in the message, under whatever text it had, and a screen reader hears it once, from the chat's message announcements ("A reply could not be completed."); otherwise the reply row says it, and is what a screen reader hears. Below it, in the reply row, is Retry, which never sends the user's message twice. For a message the host ended, Retry asks for the reply again as a new version (`regenerate`, see [message versions](message-versions.md)) and keeps the failed one; the chat offers it only when it was given a `versions` port, since reading the conversation again would show the same ended message. Without one, the row offers no Retry and the user goes on from the composer, sending the question again if they wish. For a conversation's `replyStatus`, Retry reads the conversation again (or regenerates the last reply, for `failed`, when there is a `versions` port).

- A host SHOULD end a reply it gave up on with one of these statuses rather than leave it `writing`.
- A host MUST NOT mark a message `completed` when its text is not the whole reply.

## Where an error is shown

An error is shown next to what it is about, so the reader finds it where they are looking, at any width.

- **About one message.** A message the user sent that the host refused or did not receive stays in the transcript marked "Not sent", with its problem in plain words under it, its Retry, Withdraw and Dismiss, and the problem's "Details" (the error code and reference) after them. A reply the host ended as failed or unavailable says so in the reply, with Retry in the reply row right after it when the reply can be asked for again. Neither is repeated below the composer.
- **About the conversation.** Every other problem is about the conversation as a whole, not one message: a read of the conversation that failed, a stream that dropped, a plan, a saved request, the session or the agreement with the host. It is shown once, after the composer, with its one action and its "Details".

A problem is about a message when its `id` is the `clientMessageId` of a message the client could not send. A UI drawn from `/hooks` follows the same rule: `snapshot.pending` lists each message not sent with its `failure`, and `problemView(snapshot.problem)` words the problem.

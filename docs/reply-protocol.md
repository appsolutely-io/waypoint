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

Stop is an ordinary reply, `{ "kind": "stop", "clientReplyId": "…", "messageId": "…" }`, sent to the conversation's replies route (`ReplyStop` in the schema). The client marks the reply `stopped` at once and drops any text that still arrives for it.

A host that answered `reply-stop`:

- MUST accept a stop of the assistant message it is writing, stop writing it, and end it with the status `stopped` (on the stream, `message.end` with `status: "stopped"`; in every later read, the message's `status`).
- MUST keep the text the message had when it stopped. It MUST NOT blank it or replace it with another version.
- MUST answer a repeated stop with the same `clientReplyId` with its first response, as for any reply.
- SHOULD accept a stop of a message that has already ended, changing nothing.
- MUST NOT send `stopped` to a client that did not negotiate `reply-stop`.

A stopped reply is a finished reply: the chat shows its text with a "Stopped" mark and the reply row is empty.

`waypoint-conformance` checks these rules when the host answers `reply-stop`. It needs the test script to support a reply left being written: a turn `{ "chunks": ["Partial answer"], "ending": "held" }` streams those pieces into an assistant message and leaves it `writing`.

## When a reply fails

A host that cannot finish a reply says so in one of two ways: it ends the message with `message.end` and `status: "failed"` or `"unavailable"` (and gives the message that `status` in every later read), or it leaves the message and sets the conversation's `replyStatus` to `failed` or `unavailable`. Either way the chat says "Reply failed" or "Reply unavailable" in the reply row, below whatever text the reply had; it never shows such a reply as finished. Beside it is Retry: for a failed message, when the chat was given a `versions` port, Retry asks for the reply again as a new version (`regenerate`, see [message versions](message-versions.md)) and keeps the failed one; otherwise it reads the conversation again, and never sends the user's message twice.

- A host SHOULD end a reply it gave up on with one of these statuses rather than leave it `writing`.
- A host MUST NOT mark a message `completed` when its text is not the whole reply.

# Reply protocol

What a host implements so the chat can show a reply as it is written and let the user act on it. Each feature here is optional and negotiated or announced by the host: a host that implements none of it stays valid.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT" and "MAY" in this document are to be interpreted as described in [BCP 14](https://www.rfc-editor.org/info/bcp14) ([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174)) when, and only when, they appear in all capitals.

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

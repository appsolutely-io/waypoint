# Plan protocol and host integration

This release supports protected immediate plans under `plan-recovery-v1`: proposal, initial-review, forward-active, readback, completed, cancelled, left-known, left-unconfirmed and left-reopened. Recovery is an additional contract on the existing wire `state`; `canTransition(from, to)` remains a legacy wire-edge helper, including `running` → `undoing`, and is never authorization to execute or a recovery-profile validator.

## Negotiation and reads

A client offers `plan-recovery` only with `plans.intent`. Leave and Keep additionally require `plan-leave` and `plan-keep`; each depends on `plan-recovery`. The client enables only capabilities it both offered and received. Forward the `NegotiationOffer` to the host `negotiate(supported, capabilities, offer)` helper. Its two-argument form remains the legacy path.

Each client owns its agreement. Adapters forward the optional `ReaderRequestContext` on conversation reads, sends, subscriptions and plan reads; they never retain a shared mutable agreement. HTTP uses `Waypoint-Agreement`, and EventSource uses `waypointAgreement` in the query. This identifier grants no permission. Authenticate and authorize independently, refuse malformed ids with 400, and refuse an unknown agreement with 409 and `{"code":"agreement-expired"}` before admitting work. The safety-control route authenticates and checks CSRF and scoped permission independently of agreement availability.

A protected record includes its conversation, generation and monotone revision. A lower revision is ignored; equal revisions must describe identical records. Missing or malformed identity/revision data, a changed generation or conversation, or stripping an adopted recovery view is refused without replacing the current record. Unknown profile or phase strings remain readable but cannot be controlled. Controls also remain unavailable until the fresh authoritative read after an agreement change succeeds. `RecoveryPhase` in intent replies remains a closed type.

Subscriptions under an agreement have one reconnect owner: the client closes a failed subscription, probes an authenticated read and reopens after 250/500/1000/2000/4000 ms. A successful probe does not reset the episode; a healthy open for ten seconds does. Offline attempts wait. Exhaustion reports `streamUnavailable`; explicit refresh or connectivity recovery retries. Adapter-native Last-Event-ID resume is not retained for these subscriptions. Signal events are invalidation hints, coalesced into authoritative reads, never content or evidence.

## Confirmation and execution

The host owns the proposal, exact canonical bytes, digest, review, execution id and fence. Confirmation is an ordinary reply bound to the reviewed digest and stable `clientReplyId`; the first accepted protected confirmation returns `ReplyDelivery` with its private `acceptance`. The client passes it only to the runner. `client.reply()` continues to return a boolean. An exact host-side replay returns its acknowledgment without minting new execution authority; a changed replay is refused. Never infer authority from caller-supplied properties or use client account ids as authentication.

The runner sends the confirmed canonical request unchanged with its step identity, preserves `If-Match`, and passes ephemeral step-up material separately. The host checks the current accepted execution, fence and exact step operation at admission and commit. A commit requires the `Admission` produced for that operation. `Admission` and `parseIntentRequest` are reference code in this repository (`src/host/plan-intents.ts`), not exports of the installed package. A terminal intent permanently fences the affected authority, so a held old write cannot commit after it. Run the resolver and all associated storage changes inside the host's own atomic per-plan transaction.

Stop inhibits local dispatch synchronously, including a Stop before acceptance. Interruption never automatically invokes the deprecated stop port or requests Undo. It submits the applicable Stop intent and reads step facts. Outcomes are `done`, `not-done` and `unknown`; communication loss alone proves neither success nor failure. Legacy plans without the profile inhibit locally and read back, with no terminal-intent traffic. Existing legacy resume/retry adapters can still be used by their client paths; they do not implement protected forward continuation or selected Undo.

## Bounded terminal intents

There are five fixed slots, one each for `stop`, `cancel-initial`, `cancel-review`, `leave` and `keep`. A slot is bounded durable semantic state, not an unbounded request log. The resolver orders Stop above Cancel, Keep and Leave; safety-only replacement and compatible same-round Keep/Leave joining preserve actual effects and the original disposition. An old captured request cannot affect an independent later execution. Both evidence/winner and decision-resolution floors matter when joining rounds.

The client captures the target, round, expected slot version and correlation before awaiting delivery. An illustrative Stop body is:

```json
{
  "kind": "stop",
  "planId": "example-plan",
  "target": { "type": "execution", "id": "example-execution" },
  "capturedRound": 0,
  "expectedSlotVersion": 0,
  "correlation": "example-correlation",
  "cause": "user"
}
```

All values must come from the adopted record and captured action. This example grants nothing. `parseIntentRequest` rejects unknown fields, malformed tokens, invalid integer bounds and a `payload` larger than 4096 UTF-8 bytes after NFC normalization. The separate streaming HTTP body limit is `MAX_INTENT_BODY_BYTES` = 8192 bytes: enforce it before parsing, including when Content-Length is absent or false. The body includes the payload and its surrounding JSON fields. Resolve the route's plan in the server's own store, verify its conversation and the authenticated caller's scope, then compare the parsed request against stored state. Do not select the authorized target from request-body echoes.

Send through `plans.intent(request)` to `/plans/:id/safety-control`. Return `PlanIntentReply` for that exact plan, kind, correlation and captured round, including its slot version, effective round, result, known phase and notice `keys`. The reply distinguishes fencing (`safetyApplied`) from a saved decision (`dispositionApplied`); a successful HTTP response alone is not proof that the requested disposition won.

- Initial Cancel targets the generation and follows its first acceptance if it races confirmation. It is distinct from a normal decline reply.
- Review Cancel closes only its captured review; it does not revoke an unrelated execution. Subsequent protected review features are not included in this release.
- Leave during an active run applies safety fencing but asks for a fresh review (`leaveSafetyNeedsReview`); it does not pretend the user's final disposition was saved. From readback, Leave acknowledges the current decision key, evidence digest/count and evidence/winner/resolution versions. An informed Leave can close as left-known or left-unconfirmed; identical concurrent Leave requests can join its round. Later evidence can produce left-reopened with actual facts preserved.
- Keep is explicitly reviewed as `forward-only` or `end-retention`. It refuses active or unknown work. Successful Keep closes remaining forward work or own retention, stores a permanent receipt and seals the plan. Later intents read `finalHistory` without reopening it. This release has no selected Undo choice, so Keep must not claim to waive one.

## Delivery uncertainty

`IntentOverlay` holds the complete unchanged request, producer, local inhibition fact and delivery state (`sending`, `uncertain`, `not-sent`), with optional retry time and problem. One pending intent per plan prevents new confirmation. Status and Retry redeliver the same semantic request; never create a new correlation to discover whether an old request won.

Reject an intent promise with a numeric HTTP `status` for a known host refusal, plus `retryAfter` for 429. An unclassified rejection is an unknown outcome. A 401 can be retried once after a successful authenticated call; 403, 429 and offline states wait for the user's eligible action. `checkIntentStatus`, `checkSavedChoice`, `checkKeepStatus` and `retryIntent` share the pending request. Snapshot notices express the returned facts, not an assumed choice.

The lazy intent module can fail to load. In that case local Stop remains inhibited and the action reports `retryable` / `intent-load`; a later use retries loading. Read handlers, client actions and storage commits also have lazy failure paths; a consumer must ship every referenced chunk. A load failure never authorizes fallback execution or automatic Undo.

## Host responsibilities

- Persist reviews, generations, executions, fences, five intent slots, rounds, receipts, final history and evidence atomically and durably. The reference fixture is in-memory and does not prove restart durability for a real service.
- Revalidate authentication, CSRF, current scope and stored target identity at the effect boundary. Reject the legacy `/stop` route for protected plans. Preserve exact confirmation/replay semantics and enforce body limits before parsing.
- Record actual per-step attribution, keep uncertainty explicit and retain permanent fenced authority and sealed receipts. The client cannot make remote writes atomic or manufacture proof from a timeout.
- Forward negotiation offers and reader contexts on every applicable adapter call. Validate records and intent replies against the shipped schema, registering `x-open-enum` as an annotation and the `date-time` format when using a strict schema validator.
- Keep the existing conformance session/script controls confined to an explicit disposable test deployment; the fixture returns 404 outside test mode. Audit actual deployment routing independently. Passing a test base URL does not certify production isolation.

Account quota, account deletion handling, original inverse continuation, background recovery/diagnostics, scheduled-work recovery, custom step kinds and their lifecycle conformance controls are **not included in this release**. Their host APIs, registry and scheduling policies are not supplied by the existing `RunnerPorts`. In particular, there is no lifecycle endpoint that can delete a principal and no SDK-wide deleted-reference registry.

For integrations with account lifecycle semantics, immutable principal subject references must never be reassigned to a recreated or different account. A receipt released before deletion has no later holding-deletion marker; reusing that identity can make its prior receipts readable. Identity non-reuse is a host responsibility, not a claim of retroactive SDK marking. Lifecycle test controls for such an integration must be isolated, 404 elsewhere, limited to the scenario's own created principal, and reject arbitrary principal targeting; those controls are not included here.

## Packaging acceptance

The eager core keeps its own budget in `.size-limit.cjs`, checked by `npm run size`. Intent, client actions, reads, storage, decoder and other lazy code keep separate entry budgets. The additional **core with lazy recovery** check rebundles all reachable static and dynamic recovery dependencies once with the size-limit plugin's esbuild minification and tree-shaking settings, then measures gzip level 9 minus the size plugin's 32-byte empty-project deduction. It excludes the independently measured YAML parser, form session and conformance runners. The regression limit in `.size-limit.cjs` allows 3% above the measured size, rounded down. This aggregate is not a startup-download claim. Existing entry caps remain independently enforced. A hidden reachable payload must make `npm run size` fail.

`npm run test:consumer -- <output-directory>` installs the packed prebuilt artifact with npm and pnpm without lifecycle scripts, compares installed distribution hashes, exercises ESM/CJS lazy public operations and imports all shipped lazy core entry modules discovered from top-level declaration/code pairs in the installed artifact. UI entry points load in both formats after optional peers are installed. The packed native graph resolves the framework-free core and its lazy modules using neutral/native conditions, refusing Node and UI runtime imports and missing chunks. This is device-free graph evidence; `./hooks` and native UI are not included in this release, and the smoke test proves no device-runtime behavior.

## Quality backlog

These known follow-through items do not add public guarantees:

- No release has been checked with a screen reader. The accessibility checks are DOM and browser assertions (roles, names, descriptions, focus, what a live region contains); whether speech reads each announcement once, and in what order, is not verified.
- The schema compiles under Ajv's default options once `x-open-enum` and the `date-time` format are registered; Ajv's `strict: true` refuses it: its `if` branches require a property they do not declare (`strictRequired`), and with default options Ajv already logs its `required` keywords without a `type` (`strictTypes`).

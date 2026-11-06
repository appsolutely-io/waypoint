# Changelog

## Unreleased

### Added

- Stopping a reply: the `reply-stop` capability, the `stop` reply (`ReplyStop`) and the `stopped` message and `message.end` status. `client.stopReply()` marks the reply being written `stopped` at once, keeps its text, drops text that still arrives for it and asks the host once; `client.canStopReply()` says whether it can. The chat shows Stop beside the reply row while a reply is written, when the host negotiated `reply-stop`, and marks a stopped reply "Stopped". `docs/reply-protocol.md` states what a host must do; `waypoint-conformance` checks it when the host answers `reply-stop`; the scripted transport and the reference fixture stop replies.
- Default message actions, in a lazy chunk loaded with the first message: Copy on every message; Regenerate on a reply and an inline Edit and Send on the user's message when a `versions` port is given; Good response and Bad response on a reply when the new `feedback` port (`FeedbackPort`, `FeedbackInput`) is given. `client.sendFeedback()`, `client.canChangeVersions()` and `client.canSendFeedback()` are new. A host `messageActions` part still replaces the defaults.
- The default message actions walk a message's versions in place as "‹ 2/3 ›" (Previous version, Next version), mirrored in a right-to-left chat.
- `ToolCall.label` names a read in the host's plain words. `ClientSnapshot.toolSteps` (`ToolStep`) lists the reads since the user's last message, each running, done or failed, and the chat shows the latest on one line with "Show all N steps" for the rest; a step without a label reads "Looking this up…".
- An overdue reply offers "Keep waiting" and "Retry". `client.keepWaiting()` puts the reply row back to `writing` until another 15 seconds pass without progress; `client.retryReply()` does the same and reads the conversation again, so a retry never sends the message twice. `replyRow` takes `heldUntil` for a reply being written as well.

## 0.1.1-next.0 - 2026-11-06

A pre-release, published under the `next` dist-tag.

### Added

- The `/hooks` entry: `usePlanView` (the plan view and its presses, including the hold on a Stop or Decline until the client shows it) and `useBlockReply` (a card is locked while its answer is in flight and after the host accepted it; a refused or lost answer's card is freed once the client has read the conversation after it, so the card shows what the host holds; the lock belongs to the client, so it holds across a re-mount; `isAnswered(block)` counts a card the host marks answered or one locked here; a lock is per conversation, message (pass `messageId`) and card, so a card id a later message reuses is answerable; `reply()` resolves with the outcome once the card has settled; `cardReplyId` builds an opaque reply id from the conversation, message, card and answer, its parts escaped by UTF-16 code unit so building it never throws, even on an unpaired surrogate, with a digest past 128 characters, so the same answer is the same request after a reload or in another tab, and the host deduplicates it), with `useWaypointSnapshot`, `planView` and their types. It returns message keys, never strings, and needs React and nothing that needs a DOM, a stylesheet, a skin or a message formatter, so a React Native UI gets the same behaviour as the chat. The `/react` entry exports the same hooks. `npm run test:native` checks both the core's and the hooks' graphs, in CI too.
- The `/messages` entry (`createFormatter(locale, catalogue)` and `stepName`, no React, no DOM) and one entry per language, `/messages/en` and `/messages/zh-Hans`, each a frozen catalogue with the text of every key the hooks return (plan labels, statuses, reasons, cards and problems). A host that draws its own UI imports the formatter and its own language only; a key its catalogue lacks throws in development and shows the key itself in production. `npm run test:native` checks that `/hooks` holds no message formatter, and `generate --check` that the language entries match the catalogues.
- `client.replyOutcome(reply)` sends a reply like `reply()` and says how it ended (`ReplyOutcome`): accepted, or not, with the problem when something was sent. After every reply, accepted or not, the client reports any problem at once and then reads the conversation, within the startup read's budget; a read that never answers ends as the failed read, with its Retry. The outcome resolves after that read.
- Hosts hold one answer per card: the first applied answer marks the card `answered`, and any other answer to it is refused (409 `refused`), as is the same `clientReplyId` with another body (409 `refused`, or 422). The README's **Card answers** states the rule, `createScriptedTransport` follows it, and `waypoint-conformance` checks it (`one answer per card`). In the chat, focus goes back to the pressed answer when the card is still open after the read, or to the composer when it is answered; a card whose answer the host accepted stays answered when the read after it fails, and an answer refused because the card was answered elsewhere says "This question was already answered." (`chat.problem.answered`, worded by `problemText` when the host gives it). A card answer's problem stays out of the alert until the read after it settles, so only the final state is announced. The conformance check reads a named `answer` field by field, in any key order and with any other fields the schema allows.
- Blocks may carry `answer` (`CardAnswer`), the applied action or form reply without its `protocol`, only with `answered: true`. It is optional: a host that leaves it out stays valid. The chat shows an answered card as "Answered: <label>" when `answer` names one of its actions, and "Answered" otherwise (`chat.block.answered`, `chat.block.answeredWith`). The schema describes `answered`.
- Form fill values in the transcript render with the lazy blocks chunk.
- `useBlockReply().reply()` resolves with the `ReplyOutcome` (nothing for a press on a card that takes no answer), and `cardReplyId` digests the answer with its keys in order, so the same answer has one id however it was built.
- `planLabels` on the provider names a plan step's resource and fields in the host's words (`PlanLabels`); steps are numbered either way ("Task 1", "Task 2"; "Change 1" without a label), and an unlabelled field says "Value 1", never the internal key. Catalogue: new keys `chat.stepName`, `chat.stepNamed` and `chat.fieldName`.
- Part data is typed: `PartProps<N>` gives each part `PartData[N]` (`PartDataMap`, `PartMessage`, `PartPending`, `PartStep`), and the README lists what each part receives.
- Size budgets for each lazy chunk the React chunks share (block messages, value formatting, the guarded submit) and for the lazy frame decoder; the size check finds shared chunks through the build's ESM metafile (`dist/metafile-esm.json`, not packed) and refuses a build with an ESM browser output no budget measures.

- Plan protocol and host adoption guide, complete adapter upgrade signatures, and a documented quality backlog.
- A deduplicated core/recovery size regression guard with a 20,603-byte gzip limit.
- Packed ESM/CJS lazy-operation checks.
- Device-free native graph checks.
- Saved requests with parameters open a drawer on the press that asks for them (typed fields, required ones marked, Run guarded with its reason) and runs with them; `client.prepareFlow(id)` loads and validates the document for it and `client.canPrepareFlow()` says whether the source can. The favourite toggle is pressed as the source says and named with its flow, and the tabs control a labelled panel that says when a list is loading, failed (with a Retry) or empty.
- Form fill: one combined "Draft ready" status per fill and "Generating draft…" once the host accepts the request; suggestions with their own validation and Replace / Keep mine; "Revert this fill" for each fill that still owns a field (`FormSession.revert`, `FormSnapshot.fills`); images from a picker or a drop as well as paste, each listed by its local name with its own Remove and every outcome said; number fields edited as numbers, boolean fields through the new optional `checkbox` primitive (`CheckboxProps`); an unfinished entry recorded with `FormSession.markEdited` and exposed as `localInvalid`; a draft that cannot be used ends its request (`FormSession.failRequest`) with a Retry.
- `ClientSnapshot.planReadOnly` says the shown protected plan cannot be controlled by this client now, including while a fresh read is still due after a new agreement; `PlanViewInput.readOnly` takes it, so the plan view offers no control the client would refuse.
- The `messageActions` part receives each message's id, role, status and version index and count, and `docs/message-versions.md` shows host version controls built on `MessageVersionPort` and `versionWalk`.
- `ButtonProps` gains `aria-pressed` and `id`; `STREAM_READS_UNAVAILABLE` and `loadReadHandlers` are exported.
- The form fill's texts, which load with its extras, are typed `FormCatalogue` and keyed by `FormMessageKey`; both are exported and part of `MessageKey`.
- `FieldAdornmentProps.reason`: while set, the field's Regenerate stays focusable, is described by that text and does nothing when pressed. `FormFillFields` sets it while the draft tools load or failed, while an entry is unfinished and while a request is pending.

- The stock Markdown renderer understands GitHub-flavoured Markdown: tables (in their own named, keyboard-scrollable region), strikethrough, task lists and autolinks; footnote syntax stays plain text. It is parsed by the same parser as the rest of a message, in the markdown chunk, and outline excerpts read messages the same way.
- `PartProps.describedBy`: a textarea primitive exposes it as `aria-describedby`; the chat passes the ids of the composer's hints. Both bundled skins pass it on.
- `InputProps.required`: an input primitive exposes it as `aria-required`; the chat puts the visible marker in the label. Both bundled skins pass it on.
- Theme tokens for spacing (`space1` and `space2` below `space`), type (`fontSizeSm`, `fontSizeLg`), motion (`motionFast`, `motionSlow`, `easing`), focus rings (`focusRing`), input boundaries (`controlBorder`) and status (`success`, `warning`), each with light and dark values; the chat root declares `color-scheme` to match its scheme. The types `ThemeToken` (every token name), `RequiredThemeToken` (the ones a `Theme` must give), `ResolvedTheme` (every token present, as `darkTheme` is typed) and `ThemeTokensHook` (a skin's `useThemeTokens`) are exported with `Theme`.

- `messageExcerpt(message)` on the chat provider: plain text naming a message in the outline and in announcements when a replaced Markdown renderer, `bubble` or `transcript` part means the chat cannot tell what the message visibly shows; without it those surfaces name no content.
- `DrawerProps.closeLabel`, `focusInto(element)` and `restoreFocus(element)`: a drawer primitive names its close control and reports its element, so the chat moves focus into the drawer, and back to its opener, only for a press made in the chat.

- Optional atomic `StoragePort.compareAndSet`, implemented by `createMemoryStorage`; saved conversation records carry a persisted revision and commit under it, using Web Locks where available.

- `StepContext.signal`, a standard AbortSignal aborted when the run is retired, interrupted or disposed, and the exported `ScopeSignal` shape.

- Agreement binding: a negotiation offer, an optional `agreementId`, per-request `ReaderRequestContext` with the `Waypoint-Agreement` header and stream query, the `agreement-expired` problem, one coalesced renegotiation per refused agreement, and a conformance check that hosts refuse unknown agreements before admitting anything.

- Optional `PlatformPorts.subscribeOnline` and `subscribeVisibility` notifications that let a failed start retry as soon as the application is back online or visible.

- Form-bound conversations with negotiated protocol support, local editable drafts, replacement prompts, field regeneration, private attachment adapters and grouped conversation navigation.

- Versioned conversation protocol, generated types, scripted fixture and HTTP conformance runner.
- Instance-owned conversation state, injected platform and storage ports, safe flow inputs, version operations and confirmed request execution.
- Composable React chat, accessible reply widgets, scoped tokens, neutral presentation and reusable consumer contract suites.
- Optional antd presentation controls with host-driven dark mode and shared behavior contracts.

### Changed

- Hosts must hold one answer per card and refuse any other, as the README's **Card answers** says: `waypoint-conformance` checks it for every protocol version (`one answer per card`), so a host without that rule that passed it before now fails.
- A reply that is still streaming in says so: its message is `aria-busy` and shows "Writing" under its text with a pulsing dot (still under reduced motion), and the reply row, a polite status, says "Writing" once. `replyRow` returns `writing` while the last message is an assistant message being written; a reply the host reports failed or unavailable, or one whose stream gave up (`streamLost`), is shown as that instead, and its message is no longer busy; a read's failed or unavailable describes only the reply it was read with, so a reply the stream starts after it is shown as being written. A reply whose text has not changed for 15 seconds, by a frame or by a read (`activityAt`), so the same on the SSE, fetch-stream and signal transports, is `overdue` until it changes again; called without `activityAt`, `replyRow` does not measure the stall and keeps such a reply `writing`.
- At narrow widths (under 40rem of the chat) the plan is shown after the messages and before the composer, as a region named "Plan" in the conversation, instead of after the composer; wide, it keeps its own column.
- While the host's confirmation is shown, the plan's step list leaves out each step's before and after values, which the confirmation already lists, so each change is shown once (`PlanDiagramProps.changesShown`). The step list names steps and fields by `planLabels`, never by their internal keys, and the recovery panel's step rows are named the same way (`stepName`, exported from `/messages` and `/react`) instead of by the step's link or id.
- `motionFast` and `motionSlow` are used: the neutral skin's button hover uses `motionFast` and the writing dot `motionSlow`, and the antd skin maps them to `motionDurationFast` and `motionDurationSlow` (`motion` stays `motionDurationMid`).
- **Breaking:** the `space3` and `space4` tokens are removed; nothing drew with them. See Upgrading.
- **Breaking:** `PartProps.data`, `Slots` and the provider's `parts` are typed per part, and `PlanDiagramProps.view` is `PlanView | null` instead of `unknown`. See Upgrading.
- **Breaking:** the `/testing` entry re-exports the React entry's public types instead of every type of the module the React chunks share: the type-only names `ActionButton`, `clientOf`, `context`, `ContextValue`, `HOST_KEYS`, `LoadFailure`, `OVERLAY_KEYS`, `Part`, `problemAction`, `useColorScheme` and `useRefresh` are gone, and `ConversationRail`, `FieldAdornment`, `FormFillFields`, `FormFillPopup`, `isSafeUrl`, `PrivateAttachmentPort`, `useFormFill` and their props types are added.
- **Breaking:** the conversation list's failure alert says `chat.conversationsFailed` ("Your conversations could not be loaded.") instead of `chat.failure`. Catalogue: new key `chat.conversationsFailed`.
- A load failure's busy status ("Loading" while its Retry runs) is a status region beside the alert instead of inside it.
- An `x-open-enum` annotation on an array item or an `allOf` member generates its union grouped (`(Phase | (string & {}))[]`), and one on a nullable string keeps `| null`; the shipped schema has none of these, so the generated types are unchanged.

- **Breaking:** `RecoveryView.profile` widens from `'plan-recovery-v1'` to `'plan-recovery-v1' | (string & {})` and `RecoveryView.phase` from `RecoveryPhase` to `RecoveryPhase | (string & {})`, marked in the schema with the `x-open-enum` extension (`RecoveryPhase` itself stays closed); see Upgrading.
- A protected plan under a profile or phase this client does not know, or without the negotiated `plan-recovery` capability, is shown read-only with its recorded state instead of being refused as `invalid-plan`; every control refuses it locally, a run whose plan turns read-only gets no further record, and an acceptance that lands meanwhile starts nothing. A record whose monotone fields are missing or ill typed is refused for every profile.
- A streamed assistant message is `writing` from its start frame until its end frame's own status (completed, failed or unavailable), adopted only from the stream that made it; a new version's start replaces the text shown under its id, a read asked for before a mark never changes that message, and after a gap the first read asked for decides. Announcements say such a reply once, when it ends, and hold what arrives while a modal drawer makes the live region inert until it is live again.
- The form fill's generation, suggestions, reverts, status and attachments load as a lazy chunk with the first form; the fields and the popup's text fields work without it. The tool and planning read handlers, the storage commit code and the frame decoder load on first use. The recovery panel shows a loading line, and a Retry after a failed load.
- In the neutral skin a text field's label sits above it at every width. The antd drawer's mask closes the drawer again (the containment starts at the drawer's own root and keeps its focus sentinels out of the Tab order), and the press that opened a drawer never closes it.

- Neutral-skin buttons are drawn from the tokens (surface fill, `controlBorder` edge, `radius`, accent edge on hover) instead of the browser's default buttons. The shell has its third column only while a plan or a host's `extraPanels` part is shown, so the transcript takes that width otherwise; `extraPanels` is rendered only when a slot or part provides it. In the `page` layout the transcript fills the page's height and the composer sits at the bottom, and without a conversation list the chat is at most 60rem wide, centred; the other layouts keep the transcript's 32rem cap. In Markdown, an open task box's edge is drawn in the muted colour (3:1 against the bubble), a done box keeps its fill under forced colours, and a block quote is set in by the spacing token from a start border instead of the browser's wide margins.
- Table, diff, form, choice and plan blocks, and the plan's step list (`PlanDiagram`), load as their own chunk the first time one is shown, so chats that never show one do not download them; until the chunk arrives such a block shows the message-loading line. If it cannot load, a block shows its own fallback text, and the plan's step list says "The plan's steps could not be loaded." with a Retry that asks for the chunk again when it failed and renders the steps afresh, so steps that failed to render come back too; when the pressed Retry disappears, focus moves to the box around the steps instead of the page. `isSafeUrl` accepts a missing URL and treats it as no link, so a plan step without `view` renders without one.
- The chat never takes focus on mount, on a switch the host starts, or when content or a card arrives: only a press or key in the chat moves focus, through one guarded move that refuses whenever the user has moved on. `shortcuts.global` is deprecated and ignored; the composer shortcut works only while focus is already in the chat and not in a field. Drawers, recovery alerts and the confirmation follow the same rule, and their focus is restored only while it is still theirs.
- The transcript starts at the latest message and stays there through every size change until the user scrolls away; the user's own upward scroll unpins it and a downward one within 24 px of the end pins it again, while scrolls made by the chat, by the browser's clamping or by scripts never change it. Unpinned, the message at the top of the box keeps its place as content changes. Back to latest shows only while unpinned and moves focus to the transcript box (named `chat.transcript`). Focus on a removed message, outline link or Back to latest moves to the nearest remaining one.
- The outline is a collapsed disclosure, kept per conversation; each link is named by role, position and an excerpt of the text the message visibly shows (never its Markdown source), isolated for direction, and scrolls its message to the top of the box.
- Message announcements go through one polite status region outside the transcript: replies already there when a conversation is shown are never announced, and new assistant replies are batched for a second and announced once each as they arrive, complete or fail, checked again against the transcript when said. The reply row is its own polite status.
- While the stock Markdown renderer's chunk loads, or after it failed, a message shows `chat.messageLoading`, never its source. When the chunk failed to load or the renderer threw, the chat shows one alert under the transcript, `chat.messagesUnavailable`, with a Retry that asks for the chunk again; the failed bodies show nothing of their own. A failed chunk is also asked for again when a message body next renders. Outside a chat, a failed body still reads `chat.messageUnavailable`.
- **Breaking:** `client.runFlow()` (and `useFlows().run`) resolves with the conversation the run opened, once that conversation's read loaded and it is still shown, and with nothing otherwise (a failed destination read, a retired or superseded run); the chat moves focus to the composer only then. The signature changes from `Promise<void>` to `Promise<string | void>`; see Upgrading.
- The chat reflows down to 320 px wide and with enlarged text: its root counts padding and border inside its width, words and links wrap, and code blocks and tables scroll inside their own named, keyboard-focusable region (`chat.scrollRegion`) instead of the transcript; antd button labels wrap inside the chat. Every chat control is at least 24 by 24 px, and 44 by 44 on a coarse pointer, in both skins and whatever the host antd size or density; inline links in message text are exempt.
- Under `prefers-reduced-motion: reduce`, nothing inside the chat animates, antd's click wave and host primitives included, whether the preference was set before the chat mounted or while it is shown; the antd skin's motion durations follow the preference live. Scrolls the chat starts stay instant even on a page that asks for smooth scrolling.
- **Breaking (appearance):** the antd skin follows the host's own antd theme by default: its antd controls inherit the host's ConfigProvider theme and algorithm, and the chat's own tokens (accent, surfaces, text, borders, status colours, radius, font) and its scheme are derived from the host's tokens, live. A `theme` prop on the chat, whatever its value (`{}` included), keeps waypoint's tokens instead, as before. An explicit `colorScheme` the host's theme does not paint (dark under a light host, or the reverse) uses waypoint's own tokens for that scheme instead of the host's colours. Status text stays legible: where the host left danger, success or warning as antd's own default and it is under 4.5:1 on the host's background or surface, a darker (light scheme) or lighter (dark scheme) shade of it that reaches 4.5:1 on both is used, and with none the warning names it. A host theme with a pair under its contrast minimum (every required text, focus-ring and input-boundary pair, against the background and the surface) is used as given, with one console warning per pair outside production builds; the published code keeps `process.env.NODE_ENV` for the consumer's bundler to decide. Under waypoint's tokens, antd hover and pressed colours are the accent (4.5:1).
- **Breaking (appearance):** without a `colorScheme` prop and without a host theme, the chat follows the system colour scheme (`prefers-color-scheme`) and switches live when it changes; before, it was always light. Where the preference cannot be read (no `matchMedia`, server rendering), it is light. A host theme's scheme still wins over the system's, also when a `theme` prop keeps waypoint's tokens over it, and an explicit `colorScheme` wins over both. A `theme` prop is tokens, not a scheme: without a host theme or `colorScheme`, its tokens now sit over the system scheme's base, dark on a dark system. See Upgrading.
- Below 40rem of the chat's own width (a container size, not the viewport), the conversation list moves behind a "Conversations" toggle at the start of the top bar and opens as a drawer: focus moves into it only for the toggle's press, a choice returns focus to the toggle at once and then to the composer once that conversation loads, a conversation change closes it, and widening the chat while it is open hands focus to the same conversation in the page list. The current conversation is marked with `aria-current="page"`. Drawers in both skins are sheets over the viewport, at most its height, with their content scrolling inside; the neutral drawer has a heading and puts Close before its content. While a drawer is open, the page behind it is out of reach, by keyboard and by assistive technology, as behind a modal dialog: everything outside the drawer is `inert` (only the topmost of stacked drawers is reachable), the browser keeps its own Tab order inside, and the composer shortcut does nothing; closing the drawer makes the page reachable again and returns focus as before. A message whose only content failed to render draws no empty bubble.
- A conversation that could not be read for now says `chat.conversationReadFailed` ("This conversation could not be loaded.") with Retry, which reads the conversation current at that moment, instead of "The site is unavailable right now"; a conversation that is gone keeps `chat.conversationUnavailable`. The conversation list's failure alert has a Retry that lists again.
- Back to latest says how many new replies arrived while the transcript was scrolled away (`chat.latestNew`, with plural forms: "Back to latest, 2 new replies"); the count resets when the transcript is pinned again and on a conversation or client change, and adds no announcement of its own.
- The antd drawer's close button is the adapter's own, at the right of the header and named by the chat (`chat.close`), on every antd version from 5.0.0; antd's own close button is off.
- A widget without a renderer shows its fallback as text, or `unsupportedContent` when the fallback is blank; it no longer shows `chat.update`. The arrow between a step's before and after values is decorative and read as `chat.changesTo`.
- Catalogue: new keys `chat.arrivalExcerpt`, `chat.arrivalFailed`, `chat.arrivalMany`, `chat.arrivalManyPlain`, `chat.arrivalManyFailed`, `chat.arrivalAllFailed`, `chat.transcript`, `chat.outlineItem`, `chat.outlineItemPlain`, `chat.roleUser`, `chat.roleAssistant`, `chat.messageLoading`, `chat.messageUnavailable`, `chat.changesTo`, `chat.scrollRegion`, `chat.conversationReadFailed`, `chat.latestNew`, `chat.messagesUnavailable` and `unsupportedContent`; `chat.arrival` reads "New reply"; the Simplified Chinese texts of `chat.update`, `chat.conversationUnavailable` and `form.threads` are reworded.

- Protected plans: recovery records with a monotone gate, the `plan-recovery` capability (offered only with `plans.intent`), Stop and `declinePlan()` delivered as terminal intents through `/plans/:id/safety-control` by a lazily loaded intent client, automatic Stop with its cause on interruption, and the private acceptance of a first confirmation handed only to the runner.
- A stopped or failed run never asks the host to stop or undo; `RunnerPorts.stop` is deprecated and never called, and `RunnerPorts.heartbeat` receives the accepted execution.
- Protected plans can be left with `client.leavePlan()` under the `plan-leave` capability: a running execution is fenced without saving a decision, and an informed Leave from readback opens the next decision round and closes it (`left-known` / `left-unconfirmed`); recovery views carry decision versions, the evidence digest and the unknown-step count.
- Protected plans can be kept with `keepChangesReview()` / `keepChanges(review)` under the `plan-keep` capability: Keep closes the decision or ends own retention, records a permanent receipt and seals the plan; sealed plans answer later intents from their final history.
- Pending terminal intents are shown per plan (`intentOverlays`, `intentNotice`, `intentAlert`) with one 10 s deadline per operation, status and Retry through `checkIntentStatus()`, one automatic retry after sign-in, and new confirmation refused while pending; the intent client preloads for protected plans, and `keepChangesReview()` reports `loading` / `intentUnavailable` until it is available.
- Protected plans show a recovery panel with the plan's status, each step's recorded result, Stop / Cancel / Leave / Keep (Keep is confirmed first) and the status of a request in flight, from host facts only; `planView()` and `usePlan().view` give every renderer the same view, and replacement parts receive allowlisted `data`.
- Plans are confirmed through a host-issued confirmation record (`PlanRecord.confirmation`): the host words what it will apply or schedule, binds a single-use token to the conversation, plan, revision and an expiry, and the chat shows the record as given and sends only `confirmationToken`. A record is used only when it is bound to the plan, the current conversation and the plan's revision, and a record without a whole revision is never used (`confirmationOf()`). Refusals keep their reason (`problem.confirmation.reason`: expired, used, stale, mismatch, missing), are shown only for the attempt that received them (the client records the attempt it refused as `snapshot.confirmationRefusal`), and say what to do next, or show the host's `problemText` instead. A plan without a record offers no Apply or Schedule. Every problem code has its own text and at most one action; a host's whole-second `retryAfter` is kept on every reply and read problem path (a refused read with a wait is reported as `rate-limited`, see `readProblem()`) and holds Retry until it ends, and Retry, Reload and the refusal's Refresh run one refresh at a time and are busy while it runs; the refusal's Refresh also reads the plan again (`client.readPlan()`), so its factual state replaces the refusal. The confirmation is its own part (`confirmation`, data `{ confirmation }`), keeps its heading while the plan awaits confirmation, moves focus to that heading when a replacement removes the focused control, and announces an expiry once. The confirmation view and the problem messages load on first use as their own chunks, and so do the client actions that wait for readiness first (message versions, flow lists, favourites and runs, plan resume and undo retry, and reading a plan again); an undo retry is bound to the plan and conversation of its press.

- Bound stream subscriptions are recovered by the client: a failure closes the subscription at once, and up to five probe-then-reopen steps (250 ms to 4 s) run before `streamUnavailable`; only 10 s of healthy open resets the count, and `refresh()` retries. Adapter-native resume is not used for these subscriptions.
- `createSignalTransport` emits `invalidate` hints, coalesced into authoritative refetches, instead of frames.
- The conformance runners load on first use and reject with `CONFORMANCE_UNAVAILABLE` if their code cannot be loaded.

- `createFormSession` is replaced by `loadFormSession`, which loads the form session code on first use as its own chunk and rejects with `FORM_SESSION_UNAVAILABLE` (retryable, nothing kept) if the chunk cannot be loaded.

- Queued messages are withdraw-only: `client.edit(id)` becomes `client.withdraw(id)`, which moves the content into a restored item (`snapshot.restored`, with `editRestored` and `discardRestored`) and removes the row once its commit lands (pending rows are listed in `snapshot.withdrawing`), refused as `refused` (`sending`) while a send is in flight or its outcome is unknown. Outbox rows never change and keep one id per logical message, the server's dedupe key; a send dispatches only after its claim is committed. `useComposer().edit` becomes `withdraw` and the `chat.edit` key becomes `chat.withdraw`.

### Upgrading

- A theme that sets `space3` or `space4` drops them: they were never read. A stylesheet that used `--wp-space3` or `--wp-space4` uses its own length (they were `1rem` and `1.5rem`).
- A slot or part typed `(props: PartProps) => …` keeps working; one that read `props.data` as `Record<string, unknown>` reads its typed fields instead (`PartProps<"stepRow">`, `PartData`). A `PlanDiagram` caller passes a `PlanView` (or nothing) as `view`.
- `StepStatus.label` is gone: a host drawing step rows names them with `stepName(format, planLabels, step)` from the new `index` and `resource`.
- A custom catalogue and a host `format` add the keys `chat.stepName` ("Change {index}"), `chat.stepNamed` ("{name} {index}") and `chat.fieldName` ("Value {index}").
- A custom catalogue (for example one typed `Record<keyof typeof english, string>`) and a host `format` add the key `chat.conversationsFailed` ("Your conversations could not be loaded.").
- Code that named `ActionButton`, `clientOf`, `context`, `ContextValue`, `HOST_KEYS`, `LoadFailure`, `OVERLAY_KEYS`, `Part`, `problemAction`, `useColorScheme` or `useRefresh` from `/testing` stops using them: they are type-only and not exported by any public entry. Every type the React entry exports is still available from `/testing`.
- A strict schema validator registers the `date-time` format as well as the `x-open-enum` annotation (Ajv: `ajv-formats` and `ajv.addKeyword("x-open-enum")`).

- Hosts customizing dark bubble and card surfaces should set antd `colorBgElevated` instead of `colorBgLayout`; light surfaces continue to use `colorBgLayout`.
- Update host focus expectations for drawers opened without a press: focus now enters the dialog instead of staying on the previous control. Let the drawer's `focusInto` / `restoreFocus` callbacks manage entry and guarded return rather than assuming the opener keeps focus.
- For antd controls inside a drawer, move required popup placement overrides from the host `ConfigProvider.getPopupContainer` to the control's own `getPopupContainer`, returning a container inside the modal. The drawer-local provider overrides the host setting so default popups remain reachable; controls outside drawers keep the host setting.

- Custom `PrimitiveComponents.drawer` implementations must change close behavior from retaining a hidden dialog to unmounting it, and call `restoreFocus(element)` during close/unmount so the guarded focus handoff can run.

- Direct callers of the previously required `RunnerPorts.stop(id): Promise<PlanRecord>` now guard optional `stop?(id)`; the runner never calls it. Forward `heartbeat(id, acceptance?)`, `read(id, context?)` and the negotiation offer; protected hosts supply `intent?(request): Promise<PlanIntentReply>` and preserve the first `ReplyDelivery.acceptance`. See README's old/new signature table for each adapter duty.
- `runFlow(id, values): Promise<void>` now returns `Promise<string | void>`; consumers may use the loaded conversation id, and must handle no result when navigation did not complete.

- A replacement `fieldAdornment` part now receives `aria-disabled` and `describedBy` for a guarded action instead of `disabled: true`; forward them as `aria-disabled` and `aria-describedby` to keep the control focusable and explain why it is unavailable. Native `disabled` still represents its separate disabled state, and guarded parts receive no `onPress`.

- Code that switches exhaustively on `recovery.profile` or `recovery.phase` handles other values and renders them read-only; the types are `'plan-recovery-v1' | (string & {})` (was `'plan-recovery-v1'`) and `RecoveryPhase | (string & {})` (was `RecoveryPhase`). Assigning `recovery.phase` to a `RecoveryPhase` no longer type-checks either: narrow it first.
- A custom `WaypointClient` sets `planReadOnly` in its snapshot when it refuses the shown plan's controls; without it the plan view judges from the record and the capabilities alone.
- A skin whose drawer renders a mask or focus sentinels beside its dialog element marks the drawer's own root with `data-wp-modal-root`, so the chat makes only what is outside that root inert and the mask still takes clicks.
- A custom `FormSession` adds `markEdited`, `revert` and `failRequest`; a custom `WaypointClient` adds `prepareFlow` and `canPrepareFlow`; a custom `button` primitive forwards `aria-pressed` and `id`; a custom skin may add a `checkbox` primitive.
- A host whose tests press the suggestion's "Replace your edit?" presses "Replace" (or "Keep mine"); the `/testing` form contract does. Non-text field values other than numbers and booleans need `renderField` to be edited.
- `handleToolRead` and `handlePlanningRead` may reject with `STREAM_READS_UNAVAILABLE` when their code cannot be loaded.

- A chat without a `colorScheme` prop or a host theme now follows the system colour scheme. Pass `colorScheme="light"` to keep it light on a dark system, as it was; a `theme` prop chosen for one scheme should come with that `colorScheme`.
- A replaced `bubble` part receives the visible sender label as the first of its `children`; render them to show it. The message's article is named by its sender whatever the bubble renders.
- Under a `theme` prop (whatever its value) the user's bubble keeps the plain surface, where the theme's colours already need 4.5:1, with an accent start edge instead of the tinted fill; nothing else is asked of the theme. Under a host antd theme the fill is used: the antd skin uses a legible shade of antd's own default blue for links there, and warns about a host's own colours that fall under 4.5:1 on it.
- A custom `textarea` primitive forwards `PartProps.describedBy` to its field as `aria-describedby`, so the composer's hints reach screen readers; one that drops it still works, but its users never hear the hints.
- A custom `input` primitive forwards `InputProps.required` to its field as `aria-required` (the chat already puts the visible marker in the label); one that drops it still works, but screen readers do not announce the field as required.
- A custom `drawer` primitive names its close control with `closeLabel`, calls `focusInto(element)` with its dialog element from a layout effect when it mounts open, calls `restoreFocus(element)` when it closes, and takes no focus of its own. While it is open, the chat makes everything outside the element reported to `focusInto` inert, and removes only what it set when `restoreFocus` is called or the drawer unmounts; elements the host made inert stay so.
- `client.runFlow(id, values)` and `useFlows().run(id, values)` change from `Promise<void>` to `Promise<string | void>`. Who must change:
  - Code that stores either method in a slot typed `(id, values) => Promise<void>`, or awaits it into a `void`-typed result, no longer type-checks: widen the type to `Promise<string | void>`, or use the result.
  - A custom `WaypointClient` implementation, wrapper (proxy, decorator) or typed test double must resolve with the run's outcome: the conversation id when the run's own navigation loaded that conversation and it is shown, otherwise nothing. One that still resolves with nothing type-checks, but then the chat never moves focus to the composer after a flow run.

  ```ts
  // Before: the wrapper drops the outcome
  const client: WaypointClient = {
    ...real,
    runFlow: async (id, values) => {
      await real.runFlow(id, values);
    },
  };
  // After: pass it through (a test double resolves with the id it opened, or undefined)
  const client: WaypointClient = {
    ...real,
    runFlow: (id, values) => real.runFlow(id, values),
  };
  ```

- A custom `button` primitive forwards `aria-expanded` and `aria-controls` (new on `ButtonProps`): the outline's toggle is drawn with it.
- Inputs and the composer draw their boundary with the new `controlBorder` token (3:1 against the background), and the antd skin maps it to `colorBorder`; `border` stays the decorative outline of the chat and its bubbles. A host that set `border` to style its chat's inputs sets `controlBorder` instead. The new tokens are optional in `Theme`, so a complete theme written before them still type-checks.
- A host using the antd skin that wants the chat to keep waypoint's colours instead of its own antd theme passes `theme={{}}` (or its own tokens) to `WaypointChat`/`WaypointProvider`. A custom skin can read its host's theme the same way by providing `useThemeTokens` (a hook returning `{ tokens, scheme }`); a custom `wrapper` receives `tokenSource` ("host" or "waypoint").
- A custom `button` primitive also forwards `aria-current`, used on the current conversation.
- Remove `shortcuts.global`; it has no effect.
- A host that replaces the Markdown renderer, `bubble` or `transcript` and wants excerpts in the outline and announcements passes `messageExcerpt`.
- A host `format` adds the new catalogue keys.

- Hosts put a confirmation record (`PlanRecord.confirmation`) on every plan awaiting confirmation and check each `confirm` reply's `confirmationToken`: in this order refuse a missing token or no record (`missing`), a token revoked by a reissue (`stale`), a token for another record, plan or conversation (`mismatch`), a consumed token (`used`, also for a retry of the confirmation that consumed it; the accepted work stays as it is and nothing is accepted again), an older revision (`stale`) and an expired token (`expired`), as a 409 `{ code: "refused", id, confirmation: { reason } }`. Consume the token in the same transition that accepts or enrolls the plan, and in that transition refuse it as `stale` when the values its record words have changed since it was issued. An issued record never changes: store it and return it as issued, and when what it describes changes, revoke its token and issue a new record. A confirmation sent through another conversation's route is `mismatch`. A refusal's Refresh reads the plan through `plans.read`, so that route must return the plan's current record. The reference host shows the full contract. Without a record the chat shows no Apply or Schedule.
- `ReplyConfirm.confirmationToken` is required; `digest` is optional and sent only for immediate plans.
- `WaypointChat` no longer takes `onSchedule` and shows no date pickers: the schedule's dates come from the host's record. The client computes no review digest.
- Legacy plans have no Cancel in the chat (the reply protocol has no decline reply for them).
- `planView()` takes the client's `conversationId`. Custom `confirmBar` parts no longer receive the record; the new `confirmation` part does.

### Fixed

- antd skin buttons keep antd's height for the host's size (32px by default) and still wrap a long label; the chat's wrapping rule had removed that height, so they were drawn 24px tall.
- A loaded conversation is published to subscribers before the tool and plan frames held for it start; in form mode their refusals no longer arrive while the snapshot still shows no conversation.
- A failed load of the stream read handlers is reported once per attempt, not once per read frame it held; a retry that fails again is reported again.
- The read-only Keep review that `keepChangesReview` returns to every caller is frozen.
- A removal handoff stops waiting for a destination once the user focuses something else, presses while focus is nowhere, or the region goes away.
- A Stop pressed for a plan this client cannot control is refused once, with the plan's id, instead of a second `intentPending` refusal.
- Generate and a failed send's Retry stay focusable during an upload, described by "Wait for the current upload to finish.", and a press sends nothing; they were natively disabled while also marked unavailable.
- In the saved-request panel, the list's Retry hands focus to the first row when the list comes back, also while a favourite failure is shown.
- Neutral-skin fields that are typed into (text, numbers, dates and times) and selects take the chat's background and text colour in both schemes instead of the user agent's.
- The selected flow tab has a 3px inset accent edge (a 2px Highlight outline under forced colours) that takes no space, so it is not told apart by colour alone.

- Dark antd bubbles and cards use the host's elevated surface above the panel while preserving light-mode colours.

- Back to latest has a spaced, non-shrinking row outside the transcript so the scroll end stays unobscured.

- Programmatically opened form-fill popups return focus to their still-available opener on close, including after effect replay.

- Antd controls inside a modal drawer keep their popups within its reachable content.

- Slotted modal drawers keep shadow-root controls behind the drawer unreachable while open.

- Closing a modal preserves inert state the host assigned while it was open.

- Default antd danger text keeps a contrast margin on grey host surfaces.

- Conversation drawer disclosure focus rings stay inside their scroll area.

- Standalone confirmation sheets return focus to their opener on close when focus still belongs to the sheet.

- Modal drawers opened without a recorded press capture their opener, enclose the page behind them, then move focus into their dialog. If a chat drawer's opener is unavailable on close, focus returns to its provided destination, otherwise the transcript.

- README upgrade guidance links to the full change inventory and explains that the deprecated global shortcut setting is ignored.

- Host integration guidance distinguishes the 8192-byte streaming body limit from the 4096-byte NFC-normalized payload limit and identifies the resolver helpers as repository reference code, not package exports.

- Integration documentation now describes Stop and interruption as inhibition and authoritative readback without automatic Undo, and distinguishes protected controls from legacy recovery adapters.

- Ant Design drawers have an accessible name on every supported peer version, including when the title changes while open.

- Stream read frames share one chunk-load attempt per batch, retain arrival order with following deltas, and clear their load problem after a successful retry.

- Keep on a controllable plan without the agreed capability reports `unavailable`; read-only reviews remain refused.

- Retrying an unusable draft explains that an attachment upload must finish first, then becomes available when the upload completes.

- A favourite Retry returns focus to that request, or its panel if the request disappeared. Retrying a load announces Loading, and a drawer whose loaded content has no field retains a focus target.

- Confirming one controllable plan is unaffected by another plan becoming read-only; every read-only control reports a local refusal without sending.

- Attachment Remove waits until the requested draft arrives, the popup closes or the request ends, including after submission failure while Retry remains offered; cancelling an empty file selection preserves its status.

- A field's guarded Regenerate remains focusable with its reason under the Ant Design skin. Replacement parts receive `PartProps["aria-disabled"]` and `describedBy` for the same behavior.

- Images can be attached while a draft request is sending.

- A field's Regenerate is announced when focus enters the field, never on hover. A popup paste of an image without an attachment port says "Images can't be attached here." instead of the generic failure, and a dropped file never opens in the page. Retrying a failed flow run repeats its values and document instead of running it with none.

- A blocked action draws in the system's unavailable colour (GrayText) under forced colours. Markdown table cells keep their words whole, so a wide table scrolls inside its region. Task lists show their boxes without bullets, drawn from the tokens so a done item stands out from an open one. Without a conversation list the shell drops the rail column, so the chat uses the full width. A bubble's text and its blocks are spaced by the `space` token, like Markdown blocks.
- Message Markdown is spaced by the tokens instead of by the newlines between blocks, so a paragraph gap is one `space`, not two or three blank lines; soft line breaks inside a paragraph and the whitespace of code are kept. An image never grows wider than its bubble.
- Under forced colours (Windows High Contrast), message bubbles keep a border, and the open conversations toggle and the current conversation keep a visible edge instead of a shadow. An unavailable action (`aria-disabled`) looks unavailable in both skins: muted text, a not-allowed cursor and no hover change, while it stays focusable. The conversation list has no bullets.
- Each message shows its sender ("You" / "Assistant") first in its bubble, and its article is named by its sender whatever the bubble renders; the visible label is hidden from screen readers, so they say it once. The user's messages sit at the inline end, at most 85% of the transcript's width, on an accent-tinted surface (12% of the accent in light, 16% in dark); the assistant's sit at the start on the surface. Under a `theme` prop, whose colours the library does not check, the user's bubble keeps the surface and has an accent start edge instead. The sender label is in the muted colour; text, muted text and links keep 4.5:1 on either surface under waypoint's tokens and antd's defaults, and the antd skin's contrast warning also checks a host's colours on the user's bubble, painted as the browser paints them (alpha included). The alignment holds under forced colours and right to left.
- In a right-to-left chat (`dir="rtl"`), ArrowRight and ArrowLeft move between the saved-request tabs in their visual order, as the ARIA tabs pattern asks.
- The composer is described by the hints shown under it, so a screen reader on the field hears them.
- Diff blocks and plan steps show values in plain words instead of JSON: text as it is, an empty value as a dash, a list joined with commas, an object as its keys and values. Plan steps show their facts as separate, localised items: the risk ("Low risk" / "Sensitive"), what Undo does for the step's undo kind, or only "Cannot be undone", whether verification is needed, and "Status: …" from the step's outcome ("Done" for a 2xx status, "Failed" otherwise) or the plan's state, never a raw enum or HTTP status. "View change" appears only when the step has a safe destination, and a plan block shows its own text instead of the bare plan id.
- Form blocks mark required fields in their label ("Title (required)") and with `aria-required`. While one is empty, Submit stays focusable, is `aria-disabled`, and is described by "Fill in the required fields to submit.", and Enter in the form sends nothing, so implicit submission follows the same rule as the button. Choice blocks are a group named by their question (the block's fallback text), their text mode is labelled by it, and an empty answer is refused the same way.
- The catalogue is chosen by BCP 47 language, script and region (`catalogueFor`): a tag that is not well formed under RFC 5646 (for example `zh_CN` or `zh-!!`) gets English; otherwise the script and region are read by position, never from extensions or private use. An extended language subtag names the language (`zh-yue-HK` is Cantonese, `zh-cmn-Hans-CN` Mandarin); private-use-only and grandfathered tags get English, except `zh-guoyu`, which is Mandarin. Intl never sees a tag it refuses: it formats with the tag's canonical form, or else with the catalogue's language (`zh-Hans` or `en`), so any tag, well formed or not, renders. `zh`, `cmn`, `zh-Hans`, `zh-CN`, `zh-SG` and other Simplified tags get Simplified Chinese; `zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`, any other script, and every other language fall back to English. The chat's `lang` is now the language of the text shown (`en` when it falls back), so a screen reader no longer reads English text with another language's voice; with a host's own `format`, it stays the host's `locale`.
- Report a failed start as sign-in, unavailable or update-required instead of always asking for an update, and retry an unavailable start or first read with bounded backoff, on online and visibility changes and on an explicit refresh, without resending messages or running plans. Read storage alongside negotiation within one second, and keep live drafts and pending rows when storage answers late.

- Disable send and retry after a definitive missing conversation read, retaining local input until a successful reload.

- Keep active child creation and send attempts cached under pruning pressure, and resubscribe loaded children whose streams are not open.
- Reset stream status on conversation selection until the new subscription reports its own status.
- Retain an authoritative conversation read applied during selection when an overlapping refetch fails transiently; definitive 404/410 reads clear stale conversations.
- Keep interrupted sends recoverable after reloading the same conversation by marking unacknowledged rows as in-doubt.
- Follow the newest conversation read outcome, preserve local input on reload and keep unavailable controls and recovery visible.
- Reuse loaded child selections and bound settled creation attempts per client, pruning the oldest and protecting replacements from stale cleanup.

- Preserve child creation identities across uncertain reads, evict only definitive missing children, stop overflowing unknown-mode streams with one notice and offer an explicit conversation reload.

- Start ordinary tool and plan frames without waiting for earlier operations, ignore superseded plan reads, bound held frames until read-confirmed mode, and retain cached child attempts after uncertain selection failures.

- Hold tool and plan frames until conversation mode is known, reject pending generation, preserve child creation identities across popup mounts, and validate transcript labels and conformance refusals.

- Preserve ordinary actions while conversations load, retain child creation retries after closing, explain local fill cancellation, and harden field drafts, pending controls and transcript rendering.

- Recheck cancellation and authoritative plan state after asynchronous pre-write checks and step-up prompts.
- Isolate plan callbacks across conversation switches, refuse sends after failed negotiation and bind version retry identities to their payloads.
- Share editable-target filtering between scoped and global focus shortcuts.
- Verify fixture-backed shell rendering under Node with browser globals guarded against access.
- Keep confirmation promises and reply identities on each client instance, keyed by plan.
- Retain per-plan stop requests and refuse a different plan while execution is active.
- Keep presentation events out of the optional plan-id argument when stopping execution.
- Compare the authoritative plan digest with the digest supplied by the confirmation caller before any write.
- Render Markdown images as links unless the host explicitly permits their origin or URL.
- Apply one safe URL policy to Markdown, route widgets and plan views, with explicit host scheme extensions.
- Render panel, page, floating and sheet layouts with distinct logical geometry while retaining container responsiveness.
- Check all attributed successful step outcomes so an earlier failed attempt cannot hide a successful resume.
- Capture reply scope before readiness and keep late results or failures out of a different conversation.
- Use the selected protocol version for frame validation and client-generated replies.
- Route read frames through trusted manifest and planning-template guards before posting projected replies.
- Share one default tab list and preserve host tab identifiers and translation keys through the flow source and UI.
- Fail the API report gate when a required declaration entry is absent instead of silently skipping it.
- Select Simplified Chinese only for supported locales and preserve English fallback plural rules elsewhere.
- Verify in a browser that default Markdown images initiate no remote request.
- Wait for readiness and recheck conversation scope before constructing a confirmation with the negotiated protocol.
- Reuse failed confirmation identities only for the same plan digest and allocate a new identity for a revised proposal.
- Report stopped plan attempts through the typed problem channel with localized recovery guidance.
- Remember confirmed digests per plan and return changed resume proposals to an explicit confirmation state instead of executing them.
- Reject reserved built-in and duplicate tab identifiers before initializing a client.
- Pass the validated host template to planning request adapters so stream-only metadata cannot cross the trust boundary.
- Populate the negotiated protocol at reply dispatch so early widget replies cannot capture an absent or stale version.
- Clear the matching changed-plan report once the revised proposal is confirmed so recovery guidance reflects the current state.
- Document refused relative links, digest-scoped confirmation recovery and typed stopped-plan reporting.
- Keep direct runner invocations from creating remembered user approval for a later resume.
- Release approval and retry caches when plans end, stop, switch conversations or dispose, and prevent late confirmations from restoring them.
- Scope in-memory approval by conversation and plan, and require renewed confirmation after a page reload.
- Reject unfinished immediate resume records as invalid plans while preserving their authoritative state.
- Store approval before recovery notifications so a synchronous Stop clears it permanently rather than allowing a later write to restore it.
- Restore timed plans awaiting scheduling without an error, and check returned plan identity before kind or stage.

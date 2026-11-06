import { DIALOG_SELECTOR } from "./dialog-selectors";
// The saved requests' panel and parameter drawer: a lazy chunk, loaded
// when the chat shows its flow tabs.
import { useEffect, useRef, useState } from "react";
import type { FlowSummary } from "../core/client";
import type { Flow, FlowParameter } from "../protocol/generated";
import { ModalDrawer, useDrawerFocus, useRetiredOnSwitch } from "./chat-focus";
import { useHandoff } from "./focus";
import { Submit } from "./submit";
import { blockEnglish, blockSimplifiedChinese } from "./block-messages";
import { addMessages } from "./i18n";
import { context, LoadFailure, useWaypointSnapshot } from "./ui";
// The form words (required, Run) are the blocks' own.
addMessages(blockEnglish, blockSimplifiedChinese);

export interface FlowPanelProps {
  id: string;
  labelledBy: string;
  flows?: readonly FlowSummary[];
  // Every tab's lists, whose reload forgets a document no drawer shows.
  all: unknown;
  // A list asked for again after a failure is `retrying`.
  list: "loading" | "failed" | "retrying" | "done";
  onRetryList(): void;
  // Runs a flow under the chat's own focus rules for a run.
  onRunFlow(id: string, values?: Record<string, unknown>): void;
}
/**
 * One tab's saved requests, with their state when there are none, their
 * favourite toggles and the parameter drawer a row opens.
 */
export function FlowPanel({
  id,
  labelledBy,
  flows,
  all,
  list,
  onRetryList,
  onRunFlow,
}: FlowPanelProps) {
  const { client, format: t, primitives } = context();
  const B = primitives.button;
  const panel = useRef<HTMLDivElement>(null);
  // The flow whose parameter drawer is open (opened by the press on its
  // row), the favourite writes in flight, and the last write that failed.
  const [drawer, setDrawer] = useState<FlowSummary | undefined>(undefined);
  const [favouriting, setFavouriting] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [failed, setFailed] = useState<
    { id: string; value: boolean } | undefined
  >(undefined);
  const prepared = useRef(false);
  const favourite = (flowId: string, value: boolean) => {
    if (favouriting.has(flowId)) return;
    setFavouriting((old) => new Set(old).add(flowId));
    // A Retry of this write stays, busy, until the write settles.
    setFailed((old) => (old?.id === flowId ? old : undefined));
    // The pressed state is the source's: it changes when the list says so.
    client
      .setFavourite(flowId, value)
      .then(
        () => setFailed((old) => (old?.id === flowId ? undefined : old)),
        () => setFailed({ id: flowId, value }),
      )
      .finally(() =>
        setFavouriting((old) => {
          const next = new Set(old);
          next.delete(flowId);
          return next;
        }),
      );
  };
  // A list reload forgets a prepared document no drawer shows.
  const shown = useRef(all);
  useEffect(() => {
    if (shown.current === all) return;
    shown.current = all;
    if (!drawer && prepared.current) {
      prepared.current = false;
      void client.prepareFlow();
    }
  }, [all, drawer, client]);
  // The row a removed control was in: focus goes to the row now there,
  // else the one before it, else the panel.
  const row = useRef(0);
  const handoff = useHandoff(() => {
    const rows = panel.current?.querySelectorAll("li") ?? [];
    return [
      rows[row.current]?.querySelector("button"),
      rows[row.current - 1]?.querySelector("button"),
      panel.current,
    ];
  });
  const favouriteId = useRef<string | undefined>(undefined);
  const favouriteHandoff = useHandoff(() => [
    [...(panel.current?.querySelectorAll("li[data-flow]") ?? [])]
      .find(
        (element) => element.getAttribute("data-flow") === favouriteId.current,
      )
      ?.querySelector("button"),
    panel.current,
  ]);
  const empty = !flows?.length;
  return (
    <div
      ref={panel}
      id={id}
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={empty ? 0 : -1}
      onFocus={(event) => {
        // The drawer's own controls are its own: its way back is the row.
        if ((event.target as Element).closest(DIALOG_SELECTOR)) return;
        // The favourite failure's Retry hands focus on by its own rule; the
        // list's Retry is one of the panel's.
        if ((event.target as Element).closest("[data-favourite-failure]"))
          return;
        const item = (event.target as Element).closest("li");
        row.current = item
          ? [...(item.parentElement?.children ?? [])].indexOf(item)
          : 0;
        handoff(event);
      }}
    >
      {failed ? (
        <div data-favourite-failure="">
          <LoadFailure
            retrying={favouriting.has(failed.id)}
            onFocus={(event) => {
              favouriteId.current = failed.id;
              favouriteHandoff(event);
            }}
            onRetry={() => favourite(failed.id, failed.value)}
          />
        </div>
      ) : null}
      {flows?.length ? (
        <ul>
          {flows.map((flow) => (
            <li key={flow.id} data-flow={flow.id}>
              <B
                onPress={() => {
                  if (!client.canPrepareFlow()) return onRunFlow(flow.id);
                  prepared.current = true;
                  setDrawer(flow);
                }}
              >
                {flow.title}
              </B>
              <B
                label={t("chat.block.favourite", { title: flow.title })}
                aria-pressed={flow.favourite === true}
                aria-busy={favouriting.has(flow.id) || undefined}
                onPress={() => favourite(flow.id, !flow.favourite)}
              >
                <span aria-hidden="true">{flow.favourite ? "★" : "☆"}</span>
              </B>
            </li>
          ))}
        </ul>
      ) : list === "failed" || list === "retrying" ? (
        <LoadFailure retrying={list === "retrying"} onRetry={onRetryList} />
      ) : (
        <p>
          {t(
            list === "loading" && !flows
              ? "chat.block.flowsLoading"
              : "chat.block.flowsEmpty",
          )}
        </p>
      )}
      {drawer ? (
        <FlowDrawer
          key={drawer.id}
          flow={drawer}
          prepare={() => client.prepareFlow(drawer.id)}
          onRun={(values) => {
            onRunFlow(drawer.id, values);
            setDrawer(undefined);
          }}
          onCancel={() => {
            setDrawer(undefined);
            void client.prepareFlow();
          }}
          panel={() => panel.current}
        />
      ) : null}
    </div>
  );
}

export interface FlowDrawerProps {
  flow: FlowSummary;
  // Resolves with the document; nothing means it could not be read.
  prepare(): Promise<Flow | void>;
  onRun(values: Record<string, unknown>): void;
  onCancel(): void;
  // Where closing goes when the row that opened it is gone.
  panel?(): HTMLElement | null;
}
/**
 * A flow's parameters. Opened by the press on its row, it loads the
 * document itself: whatever the load gives after this drawer closed is
 * dropped, so it never shows, keeps or runs anything.
 */
export function FlowDrawer({
  flow,
  prepare,
  onRun,
  onCancel,
  panel,
}: FlowDrawerProps) {
  const { format: t, primitives } = context();
  const drawerFocus = useDrawerFocus("flow-parameters", undefined, panel);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  // A switch of conversation closes it, as every chat drawer.
  const retired = useRetiredOnSwitch(
    true,
    useWaypointSnapshot().conversationId,
    onCancel,
  );
  const [document, setDocument] = useState<Flow | undefined>(undefined);
  // A failed load keeps its Retry, busy, while the next attempt runs.
  const [failed, setFailed] = useState<"failed" | "retrying" | undefined>();
  const [attempt, setAttempt] = useState(0);
  const run = useRef(onRun);
  run.current = onRun;
  const body = useRef<HTMLDivElement>(null);
  const handoff = useHandoff(() => [
    body.current?.querySelector("input,button"),
    body.current,
  ]);
  useEffect(() => {
    let open = true;
    prepare().then(
      (prepared) => {
        if (!open) return;
        // The drawer opens only when documents can be read: nothing means
        // this one could not be, never that it asks for nothing.
        if (!prepared) return setFailed("failed");
        setFailed(undefined);
        // A document with nothing to ask runs at once.
        if (!prepared.parameters.length) run.current({});
        else setDocument(prepared);
      },
      (error: unknown) => {
        if (!open) return;
        // Prepared for a conversation no longer shown: nothing to ask.
        if ((error as { id?: string } | undefined)?.id === "flow-prepare")
          cancel.current();
        else setFailed("failed");
      },
    );
    return () => {
      open = false;
    };
    // A Retry asks again; the drawer's own opening asks once.
  }, [attempt]);
  if (retired) return null;
  return (
    <ModalDrawer
      as={primitives.drawer}
      open
      label={flow.title}
      onClose={onCancel}
      closeLabel={t("chat.close")}
      {...drawerFocus}
    >
      <div ref={body} onFocus={handoff} tabIndex={-1}>
        {failed ? (
          <LoadFailure
            retrying={failed === "retrying"}
            onRetry={() => {
              setFailed("retrying");
              setAttempt((value) => value + 1);
            }}
          />
        ) : document ? (
          <FlowForm
            parameters={document.parameters}
            onRun={(values) => onRun(values)}
            onCancel={onCancel}
          />
        ) : (
          <p role="status">{t("chat.block.flowLoading")}</p>
        )}
      </div>
    </ModalDrawer>
  );
}

const present = (parameter: FlowParameter, value: unknown) =>
  parameter.type === "boolean" ? true : value !== undefined && value !== "";
/** A flow's parameters as typed fields, with one guarded Run. */
function FlowForm({
  parameters,
  onRun,
  onCancel,
}: {
  parameters: readonly FlowParameter[];
  onRun(values: Record<string, unknown>): void;
  onCancel(): void;
}) {
  const { format: t, primitives: ui } = context();
  const Check = ui.checkbox!;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      parameters.map((parameter) => [
        parameter.name,
        parameter.default ?? (parameter.type === "boolean" ? false : undefined),
      ]),
    ),
  );
  // One rule for Run and for Enter.
  const missing = parameters.some(
    (parameter) =>
      parameter.required && !present(parameter, values[parameter.name]),
  );
  const send = () => {
    if (!missing) onRun(values);
  };
  const set = (name: string, value: unknown) =>
    setValues((old) => ({ ...old, [name]: value }));
  return (
    <form
      className="wp-flow-form"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      {parameters.map((parameter) => {
        const label = parameter.required
          ? t("chat.block.required", { label: parameter.label })
          : parameter.label;
        const value = values[parameter.name];
        return parameter.type === "boolean" ? (
          <Check
            key={parameter.name}
            label={label}
            checked={value === true}
            onChange={(checked) => set(parameter.name, checked)}
          />
        ) : (
          <ui.input
            key={parameter.name}
            label={label}
            type={parameter.type === "number" ? "number" : "text"}
            required={parameter.required}
            value={value === undefined ? "" : String(value)}
            onChange={(text) =>
              set(
                parameter.name,
                parameter.type === "number"
                  ? text.trim() === "" || !Number.isFinite(Number(text))
                    ? undefined
                    : Number(text)
                  : text === ""
                    ? undefined
                    : text,
              )
            }
          />
        );
      })}
      <div className="wp-actions">
        <Submit
          disabled={false}
          blocked={missing}
          reason={t("chat.block.runMissing")}
          label={t("chat.block.run")}
          onPress={send}
        />
        <ui.button onPress={onCancel}>{t("chat.cancel")}</ui.button>
      </div>
    </form>
  );
}

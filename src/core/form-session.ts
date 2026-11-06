import type { BlockFormFill, FormFillRequest } from "../protocol/generated";
import type {
  FormDraft,
  FormSession,
  FormSessionConfig,
  FormSnapshot,
} from "./form-fill";
// Loaded on first use by loadFormSession, outside the core bundle.
const copy = <T>(value: T): T =>
  JSON.parse(JSON.stringify(value === undefined ? null : value)) as T;
export function createFormSession(config: FormSessionConfig): FormSession {
  let disposed = false;
  let state: FormSnapshot = {
    pending: false,
    fields: Object.create(null) as Record<string, FormDraft>,
  };
  const listeners = new Set<() => void>();
  let pending: { id: string; revisions: Record<string, number> } | undefined;
  const initial: Record<string, FormDraft> = Object.create(null) as Record<
    string,
    FormDraft
  >;
  for (const field of config.fields) {
    if (Object.hasOwn(initial, field.name)) throw new Error("Duplicate field");
    if (field.tier === "low")
      initial[field.name] = {
        label: field.label,
        value: copy(field.value),
        revision: 0,
        edited: false,
      };
  }
  state = { fields: initial, pending: false };
  // The last fills applied, each with what it replaced and the revision it
  // set per field; a field still at that revision is owned by the fill.
  let fills: {
    id: string;
    fields: Record<string, { draft: FormDraft; revision: number }>;
  }[] = [];
  const owned = (fill: (typeof fills)[number]) =>
    Object.keys(fill.fields).filter(
      (name) => state.fields[name]?.revision === fill.fields[name]!.revision,
    );
  const update = (fields: Record<string, FormDraft>) => {
    state = { fields, pending: pending !== undefined };
    state = {
      ...state,
      fills: fills
        .map((fill) => ({ id: fill.id, fields: owned(fill) }))
        .filter((fill) => fill.fields.length),
    };
    for (const listener of listeners) listener();
  };
  const change = (name: string, draft: FormDraft) =>
    update({ ...state.fields, [name]: draft });
  const session: FormSession = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(material) {
      if (disposed) throw new Error("Disposed form");
      const names = material.field
        ? [material.field]
        : Object.keys(state.fields);
      if (
        !names.length ||
        names.some((name) => !Object.hasOwn(state.fields, name))
      )
        throw new Error("Unknown field");
      const requestId = config.ids();
      pending = {
        id: requestId,
        revisions: Object.fromEntries(
          names.map((name) => [name, state.fields[name]!.revision]),
        ),
      };
      update({ ...state.fields });
      return copy({
        requestId,
        text: material.text,
        references: material.references ?? [],
        attachments: material.attachments ?? [],
        ...(material.field ? { field: material.field } : {}),
        fields: names.map((name) => ({
          name,
          label: state.fields[name]!.label,
          tier: "low" as const,
          value: state.fields[name]!.value,
        })) as FormFillRequest["fields"],
      });
    },
    receive(input) {
      if (!input || typeof input !== "object") return false;
      const body = input as BlockFormFill["body"];
      if (
        disposed ||
        !pending ||
        body.requestId !== pending.id ||
        !body.values ||
        typeof body.values !== "object" ||
        Array.isArray(body.values)
      )
        return false;
      const names = Object.keys(pending.revisions);
      if (
        Object.keys(body.values).length !== names.length ||
        names.some((name) => !Object.hasOwn(body.values, name))
      )
        return false;
      for (const name of names) {
        const entry = body.values[name];
        if (
          !entry ||
          !Object.hasOwn(entry, "value") ||
          (entry.label !== undefined && typeof entry.label !== "string") ||
          !entry.validation ||
          !["valid", "invalid"].includes(entry.validation.status) ||
          !Array.isArray(entry.validation.messages) ||
          entry.validation.messages.some(
            (message) => typeof message !== "string",
          ) ||
          (entry.validation.guidance !== undefined &&
            typeof entry.validation.guidance !== "string")
        )
          return false;
      }
      const fields = { ...state.fields };
      const applied: (typeof fills)[number] = { id: pending.id, fields: {} };
      for (const name of names) {
        const draft = fields[name]!;
        const entry = copy(body.values[name]!);
        if (draft.edited || draft.revision !== pending.revisions[name])
          fields[name] = {
            ...draft,
            replacement: {
              ...entry,
              revision: draft.revision,
              fill: pending.id,
            },
          };
        else {
          fields[name] = {
            ...draft,
            ...entry,
            revision: draft.revision + 1,
            edited: false,
            replacement: undefined,
          };
          applied.fields[name] = { draft, revision: draft.revision + 1 };
        }
      }
      if (Object.keys(applied.fields).length)
        fills = [...fills, applied].slice(-20);
      pending = undefined;
      update(fields);
      return true;
    },
    edit(name, value) {
      if (!Object.hasOwn(state.fields, name)) return;
      const draft = state.fields[name];
      if (disposed || !draft) return;
      change(name, {
        ...draft,
        value: copy(value),
        revision: draft.revision + 1,
        edited: true,
        validation: undefined,
        replacement: undefined,
        localInvalid: undefined,
        localText: undefined,
      });
    },
    markEdited(name, text) {
      if (!Object.hasOwn(state.fields, name)) return;
      const draft = state.fields[name];
      if (disposed || !draft) return;
      change(name, {
        ...draft,
        revision: draft.revision + 1,
        edited: true,
        validation: undefined,
        replacement: undefined,
        localInvalid: true,
        localText: text,
      });
    },
    revert(id) {
      const fill = fills.find((entry) => entry.id === id);
      if (disposed || pending || !fill) return false;
      const fields = { ...state.fields };
      for (const name of owned(fill)) {
        const { draft } = fill.fields[name]!;
        fields[name] = {
          ...fields[name]!,
          value: draft.value,
          validation: draft.validation,
          label: draft.label,
          revision: fields[name]!.revision + 1,
          edited: false,
          localInvalid: undefined,
          localText: undefined,
        };
      }
      for (const [name, draft] of Object.entries(fields))
        if (draft.replacement?.fill === id)
          fields[name] = { ...draft, replacement: undefined };
      fills = fills.filter((entry) => entry !== fill);
      update(fields);
      return true;
    },
    failRequest(requestId) {
      if (pending?.id !== requestId) return;
      pending = undefined;
      update({ ...state.fields });
    },
    replace(name, revision) {
      if (!Object.hasOwn(state.fields, name)) return false;
      const draft = state.fields[name];
      if (
        disposed ||
        !draft?.replacement ||
        draft.revision !== revision ||
        draft.replacement.revision !== revision
      )
        return false;
      change(name, {
        ...draft,
        value: draft.replacement.value,
        validation: draft.replacement.validation,
        revision: revision + 1,
        edited: false,
        replacement: undefined,
        localInvalid: undefined,
        localText: undefined,
      });
      return true;
    },
    cancelReplacement(name) {
      if (!Object.hasOwn(state.fields, name)) return;
      const draft = state.fields[name];
      if (draft && !disposed)
        change(name, { ...draft, replacement: undefined });
    },
    cancel() {
      pending = undefined;
      update({ ...state.fields });
    },
    dispose() {
      disposed = true;
      pending = undefined;
      fills = [];
      update({});
      listeners.clear();
    },
  };
  return session;
}

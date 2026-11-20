import type {
  HttpRequest,
  ConformanceResult,
  ConformanceAuthOptions,
} from "./index";
import { authenticateSession, authFailure } from "./auth";
import type { Conversation, BlockFormFill } from "../protocol/generated";
import { FORM_SCENARIOS } from "./scenarios";
export async function runFormFillConformance(
  rawRequest: HttpRequest,
  options?: ConformanceAuthOptions,
): Promise<ConformanceResult> {
  const failures: string[] = [],
    scenarios: string[] = [];
  const session = await authenticateSession(rawRequest, options);
  if (!session) return authFailure();
  const { request, headers } = session;
  const post = (path: string, value: unknown) =>
    request(path, {
      method: "POST",
      headers,
      body: JSON.stringify({ protocol: "1.1", ...(value as object) }),
    });
  const read = (id: string) =>
    request(`/conversations/${encodeURIComponent(id)}`, { headers });
  const check = async (name: string, run: () => Promise<boolean>) => {
    scenarios.push(name);
    try {
      if (!(await run())) failures.push(name);
    } catch {
      failures.push(name);
    }
  };
  const subject = {
    key: "form-fixture-a",
    resource: "items",
    label: "Item",
    route: "/items/new",
    state: "pending",
  };
  const create = {
    mode: "form-fill",
    title: "Form fixture",
    subject,
    clientCreationId: "form-create-a",
  };
  let root: Conversation;
  try {
    root = (await post("/conversations", create)).body as Conversation;
  } catch {
    return {
      passed: false,
      failures: ["form create"],
      scenarios: ["form create"],
      skipped: [],
    };
  }
  await check(
    FORM_SCENARIOS.replay,
    async () =>
      ((await post("/conversations", create)).body as Conversation).id ===
      root.id,
  );
  await check(FORM_SCENARIOS.refetch, async () => {
    const value = (await read(root.id)).body as Conversation;
    return value.mode === "form-fill" && value.subject?.key === subject.key;
  });
  await check(FORM_SCENARIOS.filtering, async () => {
    await post("/conversations", {
      ...create,
      subject: { ...subject, key: "form-fixture-b" },
      clientCreationId: "form-create-b",
    });
    const result = await request(`/conversations?subject=${subject.key}`, {
      headers,
    });
    const items = result.body as Conversation[];
    return (
      result.status === 200 &&
      items.some((item) => item.id === root.id) &&
      items.every((item) => item.subject?.key === subject.key)
    );
  });
  const fill = {
    kind: "form-fill",
    clientReplyId: "form-fill-a",
    request: {
      requestId: "form-request-a",
      text: "Draft",
      references: ["https://example.test/reference"],
      attachments: ["private-image"],
      fields: [{ name: "title", label: "Title", tier: "low", value: "" }],
    },
  };
  const checkFill = async (id: string) => {
    const first = await post(`/conversations/${id}/replies`, fill);
    const second = await post(`/conversations/${id}/replies`, fill);
    const value = (await read(id)).body as Conversation;
    const blocks = value.messages
      .flatMap((message) => message.blocks)
      .filter((block) => block.type === "form.fill") as BlockFormFill[];
    const block = blocks[0];
    return (
      first.status === 200 &&
      (first.body as { id: string }).id ===
        (second.body as { id: string }).id &&
      blocks.length === 1 &&
      block?.body.requestId === fill.request.requestId &&
      Object.keys(block.body.values).join() === "title" &&
      ["valid", "invalid"].includes(
        block.body.values.title!.validation.status,
      ) &&
      Array.isArray(block.body.values.title!.validation.messages)
    );
  };
  await check(FORM_SCENARIOS.validation, () => checkFill(root.id));
  await check(
    FORM_SCENARIOS.sensitive,
    async () =>
      (
        await post(`/conversations/${root.id}/replies`, {
          ...fill,
          clientReplyId: "forbidden",
          request: {
            ...fill.request,
            fields: [
              { name: "secret", tier: "sensitive", label: "Secret", value: "" },
            ],
          },
        })
      ).status >= 400,
  );
  await check(FORM_SCENARIOS.child, async () => {
    const child = (
      await post("/conversations", {
        ...create,
        clientCreationId: "form-child-a",
        parentConversationId: root.id,
        field: "title",
      })
    ).body as Conversation;
    return (
      child.parentConversationId === root.id &&
      child.mode === "form-fill" &&
      child.subject?.key === subject.key &&
      (await checkFill(child.id))
    );
  });
  await check(
    FORM_SCENARIOS.wrongSubject,
    async () =>
      (
        await post("/conversations", {
          ...create,
          clientCreationId: "form-child-wrong",
          parentConversationId: root.id,
          field: "title",
          subject: { ...subject, key: "another" },
        })
      ).status >= 400,
  );
  await check(FORM_SCENARIOS.general, async () => {
    const ordinary = await post("/conversations", {
      title: "Ordinary fixture",
    });
    if (ordinary.status < 200 || ordinary.status >= 300) return false;
    const reply = {
      kind: "message",
      clientReplyId: "general-reply",
      clientMessageId: "general-message",
      content: "An ordinary message",
    };
    const accepted = await post(
      `/conversations/${(ordinary.body as Conversation).id}/messages`,
      reply,
    );
    const refused = await post(`/conversations/${root.id}/messages`, {
      ...reply,
      clientReplyId: "form-general-reply",
      clientMessageId: "form-general-message",
    });
    return (
      accepted.status >= 200 &&
      accepted.status < 300 &&
      refused.status >= 400 &&
      (refused.body as { code?: string } | null)?.code === "refused"
    );
  });
  return { passed: failures.length === 0, failures, scenarios, skipped: [] };
}

import type {
  ConformanceAuthOptions,
  ConformanceResult,
  HttpRequest,
} from "./index";

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const INVALID = Symbol("invalid-data-property");
function own(value: object, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property
    ? "value" in property
      ? property.value
      : INVALID
    : undefined;
}
export function readHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid authentication headers");
  const headers: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const name of Object.getOwnPropertyNames(value)) {
    const field = own(value, name);
    if (
      !HEADER_NAME.test(name) ||
      typeof field !== "string" ||
      !HEADER_VALUE.test(field)
    )
      throw new Error("Invalid authentication headers");
    headers[name.toLowerCase()] = field;
  }
  return headers;
}
export function mergeHeaders(
  ...values: Record<string, string>[]
): Record<string, string> {
  return Object.assign(
    Object.create(null) as Record<string, string>,
    ...values.map(readHeaders),
  );
}
export function authFailure(): ConformanceResult {
  return {
    passed: false,
    failures: ["test authentication unavailable"],
    scenarios: [],
    skipped: [],
  };
}
export async function authenticateSession(
  request: HttpRequest,
  options: ConformanceAuthOptions = {},
): Promise<
  { request: HttpRequest; headers: Record<string, string> } | undefined
> {
  try {
    const supplied = own(options, "headers");
    const bootstrap = supplied === undefined ? {} : readHeaders(supplied);
    const session = await request("/__conformance/session", {
      method: "POST",
      headers: bootstrap,
    });
    if (session.status !== 200) return;
    const callback = own(options, "authenticate");
    let resolved: Record<string, string>;
    if (callback !== undefined) {
      if (typeof callback !== "function") return;
      resolved = readHeaders(
        await (callback as NonNullable<ConformanceAuthOptions["authenticate"]>)(
          session.body,
        ),
      );
    } else {
      if (!session.body || typeof session.body !== "object") return;
      const explicit = Object.getOwnPropertyDescriptor(session.body, "headers");
      if (explicit) resolved = readHeaders(own(session.body, "headers"));
      else {
        const cookie = own(session.body, "session");
        const csrf = own(session.body, "csrf");
        if (
          typeof cookie !== "string" ||
          !cookie ||
          /[;\s]/.test(cookie) ||
          typeof csrf !== "string" ||
          !csrf
        )
          return;
        resolved = readHeaders({
          Cookie: `waypoint=${cookie}`,
          "X-CSRF-Token": csrf,
        });
      }
    }
    const headers = mergeHeaders(
      { "Content-Type": "application/json" },
      bootstrap,
      resolved,
    );
    return {
      headers,
      request: (path, init) =>
        request(path, {
          ...init,
          headers: mergeHeaders(headers, init?.headers ?? {}),
        }),
    };
  } catch {
    return;
  }
}

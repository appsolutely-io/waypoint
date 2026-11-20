import type { HttpRequest } from "./index";

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 20;
const BODY_HEADERS = [
  "content-encoding",
  "content-language",
  "content-location",
  "content-type",
  "content-length",
];

export function sameOriginRequest(baseUrl: string): HttpRequest {
  const base = new URL(baseUrl);
  return async (path, init) => {
    let url = new URL(baseUrl + path);
    let method = init?.method ?? "GET";
    let body = init?.body;
    const headers = new Headers(init?.headers);
    for (let redirects = 0; ; redirects++) {
      if (
        url.origin !== base.origin ||
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("Conformance redirect refused");
      const response = await fetch(url, {
        ...init,
        method,
        headers,
        body,
        redirect: "manual",
      });
      const location = response.headers.get("Location");
      if (!REDIRECTS.has(response.status) || location === null)
        return { status: response.status, body: await response.json() };
      const next = new URL(location, url);
      // Validate every hop before forwarding its credentials or request body.
      if (
        redirects === MAX_REDIRECTS ||
        next.origin !== base.origin ||
        !["http:", "https:"].includes(next.protocol) ||
        next.username ||
        next.password
      ) {
        await response.body?.cancel();
        throw new Error("Conformance redirect refused");
      }
      if (
        ((response.status === 301 || response.status === 302) &&
          method === "POST") ||
        (response.status === 303 && method !== "GET" && method !== "HEAD")
      ) {
        method = "GET";
        body = undefined;
        for (const name of BODY_HEADERS) headers.delete(name);
      }
      await response.body?.cancel();
      url = next;
    }
  };
}

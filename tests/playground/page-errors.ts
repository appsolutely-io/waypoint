import type { Page } from "@playwright/test";

export function pageErrors(page: Page, expectedConsoleError = ""): string[] {
  let allowed = false;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // antd components access element.ref under React 19 and emit this dependency diagnostic.
    if (
      message.text() ===
        "Accessing element.ref was removed in React 19. ref is now a regular prop. It will be removed from the JSX Element type in a future release." &&
      new URL(page.url()).searchParams.get("skin") === "antd"
    )
      return;
    if (
      !allowed &&
      expectedConsoleError &&
      message.text() === expectedConsoleError
    ) {
      allowed = true;
      return;
    }
    errors.push(message.text());
  });
  return errors;
}

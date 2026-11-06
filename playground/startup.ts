export function startupMessage(error: unknown, port?: number): string {
  if (
    port !== undefined &&
    ((typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EADDRINUSE") ||
      (error instanceof Error &&
        error.message === `Port ${port} is already in use`))
  )
    return `The playground could not start. Check that port ${port} is available.`;
  return `The playground could not start: ${error instanceof Error ? error.message : String(error)}`;
}

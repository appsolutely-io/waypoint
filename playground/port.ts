export function playgroundPort(value = process.env.PLAYGROUND_PORT): number {
  if (value === undefined) return 43300;
  const port = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("PLAYGROUND_PORT must be an integer from 1024 to 65535");
  return port;
}

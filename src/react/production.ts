// Consumers' bundlers replace the literal `process.env.NODE_ENV`; with no
// bundler there is no process, and the check reads as development.
export function production(): boolean {
  try {
    return process.env.NODE_ENV === "production";
  } catch {
    return false;
  }
}

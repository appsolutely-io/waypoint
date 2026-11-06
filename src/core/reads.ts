import type {
  ManifestEntry,
  ReadTemplate,
  ToolCall,
} from "../protocol/generated";
export type ReadResult =
  | { kind: "refused"; reason: string }
  | { kind: "result"; callId: string; result: unknown };
export { STREAM_READS_UNAVAILABLE } from "./reads-load";
import { load, loaded } from "./reads-load";
/**
 * Loads the read handlers' code ahead of a read. Rejects with
 * `STREAM_READS_UNAVAILABLE` when it cannot be loaded.
 */
export async function loadReadHandlers(): Promise<void> {
  await load();
}
/**
 * Answers a tool read from the manifest. Its code is loaded on first use;
 * if loading fails the promise rejects with `STREAM_READS_UNAVAILABLE`.
 */
export async function handleToolRead(
  call: ToolCall,
  manifest: readonly ManifestEntry[],
  request: (call: ToolCall) => Promise<unknown>,
): Promise<ReadResult> {
  return (loaded ?? (await load())).handleToolRead(call, manifest, request);
}
/**
 * Answers a planning read against its template. Its code is loaded on first
 * use; if loading fails the promise rejects with `STREAM_READS_UNAVAILABLE`.
 */
export async function handlePlanningRead(
  call: ReadTemplate,
  template: ReadTemplate,
  request: (call: ReadTemplate) => Promise<{
    rows: Record<string, unknown>;
    versions: Record<string, string>;
  }>,
): Promise<
  | { kind: "refused"; reason: string }
  | {
      kind: "plan.values";
      rows: Record<string, Record<string, unknown>>;
      versions: Record<string, string>;
    }
> {
  return (loaded ?? (await load())).handlePlanningRead(call, template, request);
}

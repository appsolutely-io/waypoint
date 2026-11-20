import type { Block, Problem } from "../protocol/generated";
export interface HttpResult {
  status: number;
  body: unknown;
}
export interface HttpInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export type HttpRequest = (
  path: string,
  init?: HttpInit,
) => Promise<HttpResult>;
export interface ConformanceAuthOptions {
  headers?: Record<string, string>;
  authenticate?(
    session: unknown,
  ): Record<string, string> | Promise<Record<string, string>>;
}
export interface ConformanceConfig extends ConformanceAuthOptions {
  baseUrl: string;
  request: HttpRequest;
  profile?: "admin-host" | "app-host";
  noStepUp?: boolean;
}
export interface ConformanceResult {
  passed: boolean;
  failures: string[];
  scenarios: string[];
  skipped?: string[];
}
/** The problem a failed load of the conformance code rejects with. */
export const CONFORMANCE_UNAVAILABLE = {
  code: "retryable",
  id: "conformance-load",
} as const satisfies Problem;
// The runners are host verification tools; their code loads on first use,
// outside the core bundle. A failed load keeps nothing, so a later call
// loads again.
const load = async () => {
  try {
    return await import("./run");
  } catch {
    throw { ...CONFORMANCE_UNAVAILABLE };
  }
};
export async function runConformance(
  config: ConformanceConfig,
): Promise<ConformanceResult> {
  return (await load()).runConformance(config);
}
export async function runPlanConformance(
  request: HttpRequest,
  options?: ConformanceAuthOptions,
): Promise<ConformanceResult> {
  return (await load()).runPlanConformance(request, options);
}
export async function runFormFillConformance(
  request: HttpRequest,
  options?: ConformanceAuthOptions,
): Promise<ConformanceResult> {
  return (await load()).runFormFillConformance(request, options);
}
export type ConformanceBlock = Block;

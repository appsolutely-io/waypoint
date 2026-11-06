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
export interface ConformanceConfig {
  baseUrl: string;
  request: HttpRequest;
  profile: "admin-host" | "app-host";
  noStepUp?: boolean;
}
export interface ConformanceResult {
  passed: boolean;
  failures: string[];
  scenarios: string[];
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
): Promise<ConformanceResult> {
  return (await load()).runPlanConformance(request);
}
export async function runFormFillConformance(
  request: HttpRequest,
): Promise<ConformanceResult> {
  return (await load()).runFormFillConformance(request);
}
export type ConformanceBlock = Block;

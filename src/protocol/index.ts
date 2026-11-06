export type * from "./generated";
export const SUPPORTED_PROTOCOLS = ["1.1", "1.0"] as const;
export const CAPABILITIES = [
  "plans",
  "flows",
  "widgets",
  "step-up",
  "scheduled",
  "form-fill",
  // Protected plan recovery: terminal intents through the safety-control
  // route. A client offers it only when its plan port can deliver intents.
  "plan-recovery",
  // Leave and Keep on a protected plan; each holds only together with
  // plan-recovery.
  "plan-leave",
  "plan-keep",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
/** Drops a capability whose prerequisite is not also in `chosen`. */
export function withPrerequisites(chosen: Capability[]): Capability[] {
  return chosen.filter(
    (value) =>
      (value !== "plan-leave" && value !== "plan-keep") ||
      chosen.includes("plan-recovery"),
  );
}
/** What a client offers when it negotiates: the capabilities it implements. */
export interface NegotiationOffer {
  capabilities: readonly string[];
}
/**
 * Picks the protocol and capabilities for a negotiation. A host that passes
 * the client's `offer` gets only capabilities both sides support; a host that
 * passes two arguments keeps the legacy server-only list and issues no
 * agreement.
 */
export function negotiate(
  supported: readonly string[],
  capabilities: readonly string[] = [],
  offer?: NegotiationOffer,
): { protocol: string; capabilities: Capability[] } {
  const protocol = SUPPORTED_PROTOCOLS.find((version) =>
    supported.includes(version),
  );
  if (!protocol) throw new Error("update-required");
  return {
    protocol,
    capabilities: withPrerequisites(
      CAPABILITIES.filter(
        (value) =>
          capabilities.includes(value) &&
          (!offer || offer.capabilities.includes(value)) &&
          (value !== "form-fill" || protocol === "1.1"),
      ),
    ),
  };
}
export function blockFallback(block: {
  type: string;
  id?: string;
  fallback: string;
}): {
  text: string;
  disabled: true;
  update: true;
} {
  return { text: block.fallback, disabled: true, update: true };
}

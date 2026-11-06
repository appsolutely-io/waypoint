// The data each part receives is typed by its name: a replacement reads
// its fields without casts, and reading a field a part never gets fails.
import type {
  ConfirmationRecord,
  PartData,
  PartProps,
  PlanView,
  Slots,
} from "../../src/react/index";
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type StepRowData = Assert<
  Equal<
    PartData["stepRow"],
    {
      step: {
        id: string;
        operation: string;
        resource: string;
        view: string;
        tier: "low" | "sensitive";
        undo: string;
        stepUp: boolean;
      };
    }
  >
>;
export type ConfirmationData = Assert<
  Equal<PartData["confirmation"], { confirmation: ConfirmationRecord }>
>;
export type RecoveryData = Assert<
  Equal<PartData["recoveryPanel"], { view: PlanView }>
>;
export type ComposerData = Assert<
  Equal<PartData["composer"], { sending: boolean }>
>;
export type TopBarHasNone = Assert<Equal<PartData["topBar"], undefined>>;

export const slots: Slots = {
  stepRow: ({ data }: PartProps<"stepRow">) => data?.step.resource ?? null,
  bubble: ({ data }) =>
    data && "message" in data ? data.message.role : data?.pending.content,
  // @ts-expect-error A step row is given no message.
  widgetFrame: ({ data }: PartProps<"widgetFrame">) => data?.message,
};

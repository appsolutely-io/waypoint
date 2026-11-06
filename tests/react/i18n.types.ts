import type { MessageKey } from "../../src/react/i18n";
type Assert<T extends true> = T;
export type MissingKeyIsRejected = Assert<
  "missing-key" extends MessageKey ? false : true
>;

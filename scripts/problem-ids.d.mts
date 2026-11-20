import type ts from "typescript";
export declare const options: ts.CompilerOptions;
export declare function sources(directory?: string): string[];
export declare function collect(
  program: ts.Program,
  files: readonly string[],
): Set<string>;
export declare function undocumented(
  ids: Set<string>,
  sentence: string,
): string[];
export declare function checkProblemIds(documentation?: string): {
  files: number;
  ids: number;
};

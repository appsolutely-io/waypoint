/** Checks an installed package's dist against the paths `npm pack` packed. */
export declare function checkPackedDist(
  packedPaths: readonly string[],
  sourceRoot: string,
  installedRoot: string,
): void;

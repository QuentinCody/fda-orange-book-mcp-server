import { orangeBookSnapshot } from "./bulk-snapshot";
import type { OrangeBookFetchOptions } from "./bulk-read";
import type { OrangeBookFileType } from "./bulk-table";

export { orangeBookSnapshot } from "./bulk-snapshot";
export { parseTildeDelimited, type OrangeBookFileType } from "./bulk-table";
export type { OrangeBookFetchOptions } from "./bulk-read";

export async function orangeBookFetchText(kind: OrangeBookFileType, options?: OrangeBookFetchOptions): Promise<string> {
  return (await orangeBookSnapshot(options)).files[kind].text;
}

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { fetchOrangeBookApi } from "./openfda";
import { orangeBookSnapshot } from "./http";
import { bulkError, FILE_NAMES, type OrangeBookFileType } from "./bulk-table";

function pageInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof number !== "number" || !Number.isSafeInteger(number) || number < min || number > max) bulkError("Invalid pagination integer");
  return number;
}

function validatePin(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) bulkError("Invalid snapshot_sha256");
  return value;
}

/** Exact read-only routes; all bulk queries use one validated archive snapshot. */
export function createOrangeBookApiFetch(apiKey?: string): ApiFetchFn {
  return async request => {
    if (request.method !== "GET" || request.body !== undefined) throw new Error("Orange Book supports GET queries only, without a body.");
    const path = request.path.replace(/^\//, "");
    const params = request.params ?? {};
    if (path === "drug/orangebook.json") return fetchOrangeBookApi(params, apiKey);
    const kind = Object.keys(FILE_NAMES).find(key => key === path) as OrangeBookFileType | undefined;
    if (!kind && path !== "bulk/manifest" && path !== "bulk/file") bulkError("Unknown endpoint; use /products, /patents, /exclusivity, /bulk/manifest, /bulk/file or /drug/orangebook.json");
    const pin = validatePin(params.snapshot_sha256);
    const offset = kind ? pageInteger(params.offset, 0, 0, Number.MAX_SAFE_INTEGER) : 0;
    const limit = kind ? pageInteger(params.limit, 500, 1, 10_000) : 0;
    if (!kind) {
      const allowed = path === "bulk/manifest" ? ["refresh", "snapshot_sha256"] : ["file", "snapshot_sha256"];
      if (Object.keys(params).some(key => !allowed.includes(key))) bulkError("Unknown bulk metadata parameter");
      if (path === "bulk/manifest" && params.refresh !== undefined && typeof params.refresh !== "boolean") bulkError("refresh must be boolean");
      if (path === "bulk/file" && (typeof params.file !== "string" || !Object.keys(FILE_NAMES).includes(params.file))) bulkError("file must be products, patents or exclusivity");
    }
    const snapshot = await orangeBookSnapshot({ refresh: path === "bulk/manifest" && params.refresh === true });
    if (pin !== undefined && snapshot.metadata.snapshot_sha256 !== pin) bulkError("Snapshot changed; restart the complete query with a fresh manifest");
    const metadata = structuredClone(snapshot.metadata);
    if (path === "bulk/manifest") return { status: 200, data: { _orange_book: metadata } };
    if (path === "bulk/file") {
      const file = params.file as OrangeBookFileType;
      return { status: 200, data: { raw_text: snapshot.files[file].text, file: metadata.files[file], _orange_book: metadata } };
    }
    return snapshotPage(kind!, params, snapshot, metadata, offset, limit);
  };
}

function snapshotPage(kind: OrangeBookFileType, params: Record<string, unknown>, snapshot: Awaited<ReturnType<typeof orangeBookSnapshot>>, metadata: Awaited<ReturnType<typeof orangeBookSnapshot>>["metadata"], offset: number, limit: number) {
  const file = kind!;
  const filters = Object.entries(params).filter(([key]) => !["offset", "limit", "snapshot_sha256"].includes(key));
  for (const [field, value] of filters) {
    if (!metadata.files[file].columns.includes(field) || (value !== undefined && typeof value !== "string")) bulkError("Unknown filter column or non-string filter value");
  }
  const records = snapshot.files[file].records;
  const filtered = records.filter(row => filters.every(([field, value]) => value === undefined || row[field].toLowerCase().includes((value as string).toLowerCase())));
  const results = filtered.slice(offset, offset + limit).map(row => ({ ...row }));
  return { status: 200, data: { total_unfiltered: records.length, total_filtered: filtered.length, returned: results.length, offset, limit, results, _orange_book: metadata } };
}

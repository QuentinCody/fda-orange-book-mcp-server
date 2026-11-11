import { readBulkArchive, ORANGE_BOOK_ZIP_URL, type OrangeBookFetchOptions } from "./bulk-read";
import { bulkError, FILE_NAMES, parseBulkTable, type OrangeBookFileType } from "./bulk-table";
import { decodeUtf8, sha256, zipDirectory, zipMember } from "./bulk-zip";

export interface BulkFileMetadata {
  name: string; sha256: string; compressed_bytes: number; uncompressed_bytes: number; crc32: number;
  crc32_verified: true; columns: string[]; rows: number;
}
export interface BulkMetadata {
  source_url: string; snapshot_sha256: string; downloaded_at: string; etag: string | null; last_modified: string | null;
  archive_bytes: number; cache_ttl_ms: number; files: Record<OrangeBookFileType, BulkFileMetadata>;
}
export interface BulkSnapshot {
  metadata: BulkMetadata;
  files: Record<OrangeBookFileType, { text: string; records: Record<string, string>[] }>;
}
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cached: { snapshot: BulkSnapshot; expires: number } | undefined;
let inFlight: Promise<BulkSnapshot> | undefined;

async function loadSnapshot(options: OrangeBookFetchOptions): Promise<BulkSnapshot> {
  const download = await readBulkArchive(options);
  const members = zipDirectory(download.bytes);
  const kinds = Object.keys(FILE_NAMES) as OrangeBookFileType[];
  const selected = new Map<OrangeBookFileType, typeof members[number]>();
  for (const member of members) {
    const kind = kinds.find(key => member.name.split("/").pop()?.toLowerCase() === FILE_NAMES[key]);
    if (kind) {
      if (selected.has(kind)) bulkError("Ambiguous required archive member");
      selected.set(kind, member);
    }
  }
  if (selected.size !== kinds.length) bulkError("Missing required archive member");
  const files = {} as BulkSnapshot["files"];
  const metadata = {} as BulkMetadata["files"];
  const intervals: Array<{ start: number; end: number }> = [];
  for (const member of members) {
    const extracted = zipMember(download.bytes, member);
    if (intervals.some(other => extracted.start < other.end && other.start < extracted.end)) bulkError("Overlapping ZIP members");
    intervals.push({ start: extracted.start, end: extracted.end });
    const kind = kinds.find(key => selected.get(key) === member);
    if (!kind) continue;
    const text = decodeUtf8(extracted.bytes);
    const parsed = parseBulkTable(text, kind);
    files[kind] = { text, records: parsed.records };
    metadata[kind] = { name: member.name, sha256: await sha256(extracted.bytes), compressed_bytes: member.compressed_bytes, uncompressed_bytes: member.uncompressed_bytes, crc32: member.crc32, crc32_verified: true, columns: parsed.headers, rows: parsed.records.length };
  }
  return { files, metadata: { source_url: ORANGE_BOOK_ZIP_URL, snapshot_sha256: await sha256(download.bytes), downloaded_at: download.downloaded_at, etag: download.etag, last_modified: download.last_modified, archive_bytes: download.bytes.length, cache_ttl_ms: CACHE_TTL_MS, files: metadata } };
}

/** Publish only a fully validated, coherent archive; failed refreshes never become cache entries. */
export async function orangeBookSnapshot(options: OrangeBookFetchOptions = {}): Promise<BulkSnapshot> {
  if (inFlight) return inFlight;
  if (!options.refresh && cached && cached.expires > Date.now()) return cached.snapshot;
  inFlight = loadSnapshot(options).then(snapshot => {
    cached = { snapshot, expires: Date.now() + CACHE_TTL_MS };
    return snapshot;
  });
  try { return await inFlight; }
  finally { inFlight = undefined; }
}

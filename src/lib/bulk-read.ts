import { bulkError } from "./bulk-table";
import { MAX_ARCHIVE_BYTES } from "./bulk-zip";

export const ORANGE_BOOK_ZIP_URL = "https://www.fda.gov/media/76860/download";
export interface OrangeBookFetchOptions { timeout?: number; refresh?: boolean }

/** One deadline covers both headers and the streamed body. */
export async function readBulkArchive(options: OrangeBookFetchOptions = {}) {
  const timeout = options.timeout ?? 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) bulkError("Invalid download deadline");
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { controller.abort(); void reader?.cancel().catch(() => {}); };
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { cancel(); reject(new Error("ORANGE_BOOK_BULK: Download deadline exceeded")); }, timeout);
  });
  const operation = async () => {
    const response = await fetch(ORANGE_BOOK_ZIP_URL, {
      method: "GET", redirect: "manual", signal: controller.signal,
      headers: { Accept: "application/zip", "User-Agent": "fda-orange-book-mcp-server/1.0 (bio-mcp)" },
    });
    if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); bulkError("Download deadline exceeded"); }
    reader = response.body?.getReader();
    if (response.status !== 200 || response.headers.has("content-range") || !reader) bulkError(`Incomplete archive response (HTTP ${response.status})`);
    return await readArchiveBody(response, reader, controller);
  };
  try { return await Promise.race([operation(), deadline]); }
  catch (error) {
    cancel();
    if (error instanceof Error && error.message.startsWith("ORANGE_BOOK_BULK:")) throw error;
    return bulkError("Archive download failed");
  } finally { clearTimeout(timer); }
}

async function readArchiveBody(response: Response, reader: ReadableStreamDefaultReader<Uint8Array<ArrayBufferLike>>, controller: AbortController) {
  const rawLength = response.headers.get("content-length");
  const length = rawLength === null ? undefined : Number(rawLength);
  if (rawLength !== null && (!/^\d+$/.test(rawLength) || !Number.isSafeInteger(length) || length === 0 || length! > MAX_ARCHIVE_BYTES)) bulkError("Unsupported archive Content-Length");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (controller.signal.aborted) bulkError("Download deadline exceeded");
    if (chunk.done) break;
    size += chunk.value.length;
    if (size > MAX_ARCHIVE_BYTES) bulkError("Archive size limit exceeded");
    chunks.push(chunk.value);
  }
  // Content-Length describes encoded transfer bytes when Content-Encoding is set.
  if (length !== undefined && !response.headers.has("content-encoding") && size !== length) bulkError("Truncated archive body");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, downloaded_at: new Date().toISOString(), etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified") };
}

import { afterEach, expect, it, vi } from "vitest";
import { readBulkArchive } from "./bulk-read";
import { MAX_ARCHIVE_BYTES } from "./bulk-zip";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  [206, {}], [302, { location: "https://example.invalid" }], [500, {}],
  [200, { "content-range": "bytes 0-1/20" }], [200, { "content-length": "2" }],
  [200, { "content-length": String(MAX_ARCHIVE_BYTES + 1) }], [200, { "content-length": "garbage" }],
])("rejects incomplete or unsupported download %j %j", async (status, headers) => {
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1]), { status: status as number, headers: headers as HeadersInit }));
  vi.stubGlobal("fetch", fetcher);
  await expect(readBulkArchive()).rejects.toThrow("ORANGE_BOOK_BULK");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toMatchObject(["https://www.fda.gov/media/76860/download", { redirect: "manual" }]);
});

it("bounds a stream without trusting Content-Length and cancels it", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  await expect(readBulkArchive()).rejects.toThrow("size limit");
  expect(cancel).toHaveBeenCalledOnce();
});

it.each(["headers", "body"])("enforces the absolute deadline while waiting for %s", async phase => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn(() => phase === "headers" ? new Promise(() => {}) : Promise.resolve(new Response(new ReadableStream({ cancel })))));
  const assertion = expect(readBulkArchive({ timeout: 10 })).rejects.toThrow("deadline");
  await vi.advanceTimersByTimeAsync(11);
  await assertion;
  if (phase === "body") expect(cancel).toHaveBeenCalledOnce();
});

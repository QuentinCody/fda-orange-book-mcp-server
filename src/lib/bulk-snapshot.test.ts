import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { archive, columns, rows, table } from "./bulk.test-support";
import { sha256 } from "./bulk-zip";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function api(bytes = archive()) {
  const fetcher = vi.fn(async () => new Response(new Uint8Array(bytes), { headers: { etag: '"native-etag"', "last-modified": "Mon, 05 Oct 2026 00:00:00 GMT" } }));
  vi.stubGlobal("fetch", fetcher);
  return { call: (await import("./api-adapter")).createOrangeBookApiFetch(), fetcher };
}

it("preserves raw bytes as UTF-8 text and hashes, and coalesces concurrent three-file reads", async () => {
  const raw = "\uFEFF" + table("products", [{ ...rows.products, Trade_Name: "  Ω🧬  ", Future: "value\t" }], [...columns.products, "Future"], "\r\n");
  const zip = archive({ "products.txt": raw });
  const { call, fetcher } = await api(zip);
  const replies = await Promise.all(["/products", "/patents", "/exclusivity", "/bulk/manifest", "/bulk/file"].map(path => call({ method: "GET", path, params: path === "/bulk/file" ? { file: "products" } : {} })));
  expect(fetcher).toHaveBeenCalledTimes(1);
  const data = replies.map(reply => reply.data as any);
  const manifest = data[3]._orange_book;
  expect(data.every(value => value._orange_book.snapshot_sha256 === manifest.snapshot_sha256)).toBe(true);
  expect(manifest).toMatchObject({ snapshot_sha256: await sha256(zip), etag: '"native-etag"', archive_bytes: zip.length, files: { products: { sha256: await sha256(new TextEncoder().encode(raw)), crc32_verified: true, rows: 1, columns: [...columns.products, "Future"] } } });
  expect(data[4].raw_text).toBe(raw);
  expect(data[0].results[0]).toEqual({ ...rows.products, Trade_Name: "  Ω🧬  ", Future: "value\t" });
  data[0].results[0].Trade_Name = "mutated"; manifest.files.products.columns.length = 0;
  expect((await call({ method: "GET", path: "/products" })).data).toMatchObject({ results: [{ Trade_Name: "  Ω🧬  " }] });
});

it("pins a whole snapshot and rejects stale pins after a complete refresh", async () => {
  const { call, fetcher } = await api();
  const old = (await call({ method: "GET", path: "/bulk/manifest" })).data as any;
  const changed = archive({ "products.txt": table("products", [{ ...rows.products, Trade_Name: "Changed" }]) });
  fetcher.mockImplementation(async () => new Response(new Uint8Array(changed)));
  const fresh = (await call({ method: "GET", path: "/bulk/manifest", params: { refresh: true } })).data as any;
  expect(fresh._orange_book.snapshot_sha256).not.toBe(old._orange_book.snapshot_sha256);
  for (const path of ["/products", "/patents", "/exclusivity", "/bulk/file"]) {
    await expect(call({ method: "GET", path, params: { snapshot_sha256: old._orange_book.snapshot_sha256, ...(path === "/bulk/file" ? { file: "products" } : {}) } })).rejects.toThrow("Snapshot changed");
  }
  expect((await call({ method: "GET", path: "/products", params: { snapshot_sha256: fresh._orange_book.snapshot_sha256 } })).data).toMatchObject({ results: [{ Trade_Name: "Changed" }] });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("rejects an invalid refresh atomically, retains its old identity, then recovers", async () => {
  const { call, fetcher } = await api();
  const original = (await call({ method: "GET", path: "/products" })).data;
  fetcher.mockImplementation(async () => new Response(archive({ "exclusivity.txt": "broken" })));
  await expect(call({ method: "GET", path: "/bulk/manifest", params: { refresh: true } })).rejects.toThrow("ORANGE_BOOK_BULK");
  expect((await call({ method: "GET", path: "/products" })).data).toEqual(original);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1);
  await expect(call({ method: "GET", path: "/products" })).rejects.toThrow("ORANGE_BOOK_BULK");
  fetcher.mockImplementation(async () => new Response(archive()));
  expect((await call({ method: "GET", path: "/patents" })).data).toMatchObject({ returned: 1 });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it.each([
  { method: "POST", path: "/products" }, { method: "GET", path: "/products", body: {} },
  ...["/products/anything", "/products?limit=1", "/products#fragment", "//products"].map(path => ({ method: "GET", path })),
  ...[-1, 0, 1.5, 10001, "", "1e2", {}, [], true].map(limit => ({ method: "GET", path: "/products", params: { limit } })),
  ...[-1, 0.5, "no"].map(offset => ({ method: "GET", path: "/products", params: { offset } })),
  { method: "GET", path: "/products", params: { snapshot_sha256: "bad" } },
  { method: "GET", path: "/bulk/file", params: { file: "../patent.txt" } },
  { method: "GET", path: "/bulk/manifest", params: { refresh: "true" } },
])("rejects malformed requests before downloading: %j", async request => {
  const { call, fetcher } = await api();
  await expect(call(request as never)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([{ Unknown: "x" }, { Appl_No: 123 }, { Appl_No: null }, { Appl_No: {} }])("rejects nonexistent fields and coerced filters: %j", async params => {
  const { call } = await api();
  await expect(call({ method: "GET", path: "/products", params })).rejects.toThrow("filter");
});

it("supports native substring filters and explicit bounded pagination", async () => {
  const { call } = await api(archive({ "products.txt": table("products", [rows.products, { ...rows.products, Product_No: "002" }]) }));
  expect((await call({ method: "GET", path: "/products", params: { Trade_Name: "EXAM", offset: "1", limit: "1" } })).data).toMatchObject({ total_unfiltered: 2, total_filtered: 2, returned: 1, offset: 1, limit: 1, results: [{ Product_No: "002" }] });
});

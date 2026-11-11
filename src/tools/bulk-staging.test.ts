/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { DynamicWorkerExecutor } from "@bio-mcp/shared/codemode/execute-tool";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { OrangeBookDataDO } from "../do";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { archive, rows, columns, table } from "../lib/bulk.test-support";
import { sha256 } from "../lib/bulk-zip";
import { FdaOrangeBookMCP } from "../index";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function createStore() {
  const database = new DatabaseSync(":memory:");
  let ready = Promise.resolve();
  const exec = (query: string, ...values: any[]) => {
    const rows = database.prepare(query).all(...values);
    const iterator = rows[Symbol.iterator]();
    return { toArray: () => rows, one: () => rows[0], next: () => iterator.next(), [Symbol.iterator]: () => iterator };
  };
  const transactionSync = <T>(run: () => T): T => {
    database.exec("BEGIN");
    try { const result = run(); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  };
  const ctx = { blockConcurrencyWhile: (run: () => Promise<void>) => { ready = run(); return ready; }, storage: { sql: { exec }, transactionSync } };
  const instance = new OrangeBookDataDO(ctx as unknown as DurableObjectState, {} as Cloudflare.Env);
  return { database, instance, ready };
}

function fixture() {
  // Exercise generated API helpers and user code; replace only the platform isolate.
  vi.spyOn(DynamicWorkerExecutor.prototype, "execute").mockImplementation(async (code, functions) => {
    const staged: Array<Record<string, unknown>> = [];
    try {
      const run = new Function("codemode", "__stagedResults", "console", `return (${code})();`);
      const result = await run(functions, staged, { warn() {}, log() {} });
      return { result: JSON.parse(JSON.stringify(result)), __stagedResults: staged };
    } catch (error) { return { error: String((error as Error).message), __stagedResults: staged }; }
  });
  const stores = new Map<string, ReturnType<typeof createStore>>();
  const namespace = { idFromName: (name: string) => name, get: (id: string) => ({ fetch: async (request: Request) => {
    let store = stores.get(id);
    if (!store) { store = createStore(); stores.set(id, store); }
    await store.ready;
    return store.instance.fetch(request);
  } }) };
  const env = { ORANGE_BOOK_DATA_DO: namespace, CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, env); registerQueryData(server, env as Partial<Env>); registerGetSchema(server, env as Partial<Env>);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<any> }> })._registeredTools;
  return { tools, env, close: () => { for (const store of stores.values()) store.database.close(); } };
}

async function recover(f: ReturnType<typeof fixture>, id: string, prefix: string) {
  const rows = async (sql: string) => {
    const output = await f.tools[`${prefix}orange_book_query_data`].handler({ data_access_id: id, sql }, {});
    expect(output.isError, JSON.stringify(output)).not.toBe(true);
    expect(output.structuredContent.staged).not.toBe(true);
    expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30720);
    return output.structuredContent.data.rows;
  };
  const text = async (table: string, column: string, where: string) => {
    const [{ n }] = await rows(`SELECT length(${column}) AS n FROM ${table} WHERE ${where}`);
    let result = "";
    for (let start = 1; start <= n; start += 1000) {
      const [row] = await rows(`SELECT substr(${column}, ${start}, 1000) AS part FROM ${table} WHERE ${where}`);
      result += row.part;
    }
    return result;
  };
  let raw = await text("payloads", "root_json", "id = 1");
  if (raw.startsWith("__CHUNKED__:")) {
    const chunk = raw.slice("__CHUNKED__:".length);
    expect(chunk).toMatch(/^chunk_[a-f0-9]{32}$/);
    const parts = await rows(`SELECT chunk_index FROM content_chunks WHERE content_id = '${chunk}' ORDER BY chunk_index`);
    raw = "";
    for (const part of parts) raw += await text("content_chunks", "chunk_data", `content_id = '${chunk}' AND chunk_index = ${part.chunk_index}`);
  }
  const decoded = JSON.parse(raw);
  return typeof decoded === "string" ? JSON.parse(decoded) : decoded;
}


it("recovers raw files and complete filtered rows through the real Orange Book DO with both aliases", async () => {
  const f = fixture();
  for (const name of ["execute", "search", "query_data", "get_schema"]) {
    expect(f.tools[`orange_book_${name}`]).toBeDefined();
    expect(f.tools[`mcp_orange_book_${name}`]).toBeDefined();
  }
  const nativeRows = Array.from({ length: 60 }, (_, index) => ({ ...rows.products, Product_No: String(index + 1).padStart(3, "0"), Future: " Native Ω🧬 ".repeat(140) }));
  const text = "\uFEFF" + table("products", nativeRows, [...columns.products, "Future"], "\r\n");
  const zip = archive({ "products.txt": text });
  const fetcher = vi.fn(async () => new Response(new Uint8Array(zip)));
  vi.stubGlobal("fetch", fetcher);
  try {
    for (const prefix of ["", "mcp_"]) for (const path of ["/bulk/file", "/products"]) {
      const args = { code: `return await api.get('${path}', ${path === "/bulk/file" ? "{file:'products'}" : "{limit:100}"});` };
      const output = await f.tools[`${prefix}orange_book_execute`].handler(args, {});
      expect(output.isError, JSON.stringify(output)).not.toBe(true);
      expect(output.content).toBeInstanceOf(Array);
      expect(output.structuredContent._meta.staged).toBe(true);
      expect(output.structuredContent._staging).toBeTypeOf("object");
      expect(new TextEncoder().encode(JSON.stringify(output)).byteLength).toBeLessThan(30720);
      const id = output.structuredContent.data.data_access_id;
      const recovered = await recover(f, id, prefix);
      expect(recovered._orange_book.snapshot_sha256).toBe(await sha256(zip));
      expect(recovered._orange_book.files.products.sha256).toBe(await sha256(new TextEncoder().encode(text)));
      if (path === "/bulk/file") expect(recovered.raw_text).toBe(text);
      else expect(recovered.results).toEqual(nativeRows);
      const verified = await verifyCitationEnvelope({ citation: output.structuredContent._meta.citation, structuredContent: output.structuredContent, toolArguments: args, materialized: { value: recovered } });
      expect(verified.verification).toMatchObject({ query: "verified", result: "verified" });
      const sample = "Ω🧬".repeat(8000);
      const query = { data_access_id: id, sql: `SELECT '${sample}' AS sample`, limit: 1 };
      const wide = await f.tools[`${prefix}orange_book_query_data`].handler(query, {});
      expect(new TextEncoder().encode(JSON.stringify(wide)).byteLength).toBeLessThan(30720);
      expect(wide.structuredContent._staging).toBeTypeOf("object");
      const complete = await recover(f, wide.structuredContent.data_access_id, prefix);
      expect(complete.structuredContent.data.rows[0].sample).toBe(sample);
    }
    fetcher.mockImplementation(async () => new Response(archive({ "patent.txt": "broken" })));
    for (const prefix of ["", "mcp_"]) {
      const result = await f.tools[`${prefix}orange_book_execute`].handler({ code: "return await api.get('/bulk/manifest', {refresh:true});" }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
      expect(JSON.stringify(result)).toContain("ORANGE_BOOK_BULK");
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
      const response = await FdaOrangeBookMCP.serve("/mcp").fetch(new Request("http://fixture/mcp", {
        method: "POST", headers: { accept: "application/json, text/event-stream", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": `${prefix}orange_book_execute`, "mcp-protocol-version": "2026-07-28" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `${prefix}orange_book_execute`, arguments: { code: "return await api.get('/bulk/manifest', {refresh:true});" }, _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "bulk-contract", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {},
        } } }),
      }), f.env as never, { waitUntil() {} } as never);
      expect(response.status).toBe(200);
      const wire = await response.text();
      expect(new TextEncoder().encode(wire).byteLength).toBeLessThan(30720);
      expect(JSON.parse(wire).result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false, _meta: { citation: expect.any(Object) } } });
    }
  } finally { f.close(); }
});

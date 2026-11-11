import { afterEach, expect, it, vi } from "vitest";
import { parseTildeDelimited } from "./http";
import { archive, columns, rows, table, type FixtureKind } from "./bulk.test-support";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["products", "patents", "exclusivity"] as FixtureKind[])("preserves complete %s rows and their repeated observations", kind => {
  expect(parseTildeDelimited(table(kind, [rows[kind], rows[kind]]), kind)).toEqual([rows[kind], rows[kind]]);
});

it("preserves cell whitespace, BOM-containing values, empty strings and unknown fields", () => {
  const row = { ...rows.products, Trade_Name: "  Example Ω🧬  ", Extra: "\uFEFF Native value \t" };
  expect(parseTildeDelimited("\uFEFF" + table("products", [row], [...columns.products, "Extra"], "\r\n"), "products")).toEqual([row]);
});

it("retains a prototype-like source column as an own data property", () => {
  const row = { ...rows.products }; const source = table("products", [row], [...columns.products, "__proto__"]);
  const parsed = parseTildeDelimited(source, "products")[0];
  expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
});

it.each(["products", "patents", "exclusivity"] as FixtureKind[])("recognizes a header-only %s table as a validated empty collection", kind => {
  expect(parseTildeDelimited(table(kind, []), kind)).toEqual([]);
});

it.each([
  ["empty body", ""], ["non-table body", "upstream error page"],
  ["duplicate header", table("products", [rows.products], [...columns.products, "Appl_No"])],
  ["empty header", table("products", [rows.products], [...columns.products, ""])],
  ["missing column", table("products", [rows.products], columns.products.filter(field => field !== "RS"))],
  ["coerced header", table("products", [rows.products], columns.products.map(field => field === "Appl_No" ? " Appl_No " : field))],
  ["extra cell", table("products").trimEnd() + "~UNREPRESENTED\n"],
  ["missing cell", table("products").trimEnd().replace(/~[^~\n]*$/, "") + "\n"],
  ["internal blank row", table("products") + "\n" + table("products").split("\n")[1] + "\n"],
  ["control character", table("products", [{ ...rows.products, Trade_Name: "Bad\u0000value" }])],
  ["excessive columns", table("products", [rows.products], [...columns.products, ...Array.from({ length: 65 }, (_, index) => `Extra${index}`)])],
  ["oversized row", table("products", [{ ...rows.products, Trade_Name: "a".repeat(128 * 1024) }])],
])("rejects %s instead of silently repairing or omitting data", (_name, input) => {
  expect(() => parseTildeDelimited(input, "products")).toThrow(/ORANGE_BOOK_BULK/);
});

it.each([["Appl_Type", "X"], ["Appl_No", "123"], ["Product_No", "1"], ["Appl_No", " 000123"], ["Appl_Type", ""]])("rejects malformed product identity %s without coercion", (field, value) => {
  expect(() => parseTildeDelimited(table("products", [{ ...rows.products, [field]: value }]), "products")).toThrow(/ORANGE_BOOK_BULK/);
});

it("rejects a blank patent identity", () => {
  expect(() => parseTildeDelimited(table("patents", [{ ...rows.patents, Patent_No: "" }]), "patents")).toThrow(/ORANGE_BOOK_BULK/);
});

async function fetched(bytes: Uint8Array) {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
  return (await import("./http")).orangeBookFetchText("patents");
}

it("rejects invalid UTF-8 rather than replacing a native identifier", async () => {
  const prefix = new TextEncoder().encode(table("patents").replace("100*PED", "MARKER"));
  const offset = new TextDecoder().decode(prefix).indexOf("MARKER"); prefix[offset] = 255;
  await expect(fetched(archive({ "patent.txt": prefix }))).rejects.toThrow(/ORANGE_BOOK_BULK/);
});

it("rejects two archive members that ambiguously identify the same source file", async () => {
  await expect(fetched(archive({ "folder/patent.txt": table("patents") }))).rejects.toThrow(/ORANGE_BOOK_BULK/);
});

it("validates the other required members before publishing any file from the snapshot", async () => {
  await expect(fetched(archive({ "products.txt": "not a table" }))).rejects.toThrow(/ORANGE_BOOK_BULK/);
});

it("verifies member CRCs instead of trusting a decompressor's output", async () => {
  const bytes = archive(); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) { view.setUint32(offset + 16, view.getUint32(offset + 16, true) ^ 1, true); break; }
  }
  await expect(fetched(bytes)).rejects.toThrow(/ORANGE_BOOK_BULK/);
});

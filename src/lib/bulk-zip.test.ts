import { expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { archive } from "./bulk.test-support";
import { crc32, zipDirectory, zipMember } from "./bulk-zip";

function changed(edit: (view: DataView, central: number, end: number) => void) {
  const bytes = archive(); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22; const central = view.getUint32(end + 16, true);
  edit(view, central, end);
  return bytes;
}
function unpack(bytes: Uint8Array) { return zipDirectory(bytes).map(member => zipMember(bytes, member)); }

it("verifies stored and deflated members against the standard CRC32 check value", () => {
  expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  for (const level of [0, 6] as const) {
    const content = strToU8("Native Ω🧬\r\n".repeat(100));
    expect(unpack(zipSync({ "safe/future.txt": content }, { level }))[0].bytes).toEqual(content);
  }
});

it.each([
  ["multi-disk", (v: DataView, _c: number, e: number) => v.setUint16(e + 4, 1, true)],
  ["count mismatch", (v: DataView, _c: number, e: number) => v.setUint16(e + 8, 2, true)],
  ["directory boundary", (v: DataView, _c: number, e: number) => v.setUint32(e + 12, 1, true)],
  ["encrypted", (v: DataView, c: number) => v.setUint16(c + 8, 1, true)],
  ["unsupported method", (v: DataView, c: number) => v.setUint16(c + 10, 99, true)],
  ["huge output", (v: DataView, c: number) => v.setUint32(c + 24, 25 * 1024 * 1024, true)],
  ["huge compressed input", (v: DataView, c: number) => v.setUint32(c + 20, 0xffffffff, true)],
  ["local flags", (v: DataView) => v.setUint16(6, 1, true)],
  ["local method", (v: DataView) => v.setUint16(8, 99, true)],
  ["local name", (v: DataView) => v.setUint8(30, 255)],
  ["local offset", (v: DataView, c: number) => v.setUint32(c + 42, 1, true)],
  ["local extra bounds", (v: DataView) => v.setUint16(28, 65535, true)],
  ["missing descriptor", (v: DataView, c: number) => { v.setUint16(c + 8, 8, true); v.setUint16(6, 8, true); }],
  ["wrong CRC in both headers", (v: DataView, c: number) => { v.setUint32(c + 16, 1, true); v.setUint32(14, 1, true); }],
  ["false size in both headers", (v: DataView, c: number) => { v.setUint32(c + 24, 1, true); v.setUint32(22, 1, true); }],
] as const)("rejects %s", (_label, edit) => {
  expect(() => unpack(changed(edit))).toThrow(/ORANGE_BOOK_BULK/);
});

it.each(["../patent.txt", "/patent.txt", "a/../patent.txt", "a\\patent.txt", "C:patent.txt", "a//patent.txt"])("rejects unsafe member name %s", name => {
  expect(() => unpack(zipSync({ [name]: strToU8("test") }))).toThrow(/ORANGE_BOOK_BULK/);
});

it("rejects truncated data and duplicate case-folded names", () => {
  expect(() => unpack(archive().slice(0, -1))).toThrow(/ORANGE_BOOK_BULK/);
  expect(() => unpack(archive({ "PATENT.TXT": "test" }))).toThrow(/ORANGE_BOOK_BULK/);
});

it.each([false, true])("accepts a verified ZIP data descriptor with signature=%s", signature => {
  const original = zipSync({ "test.txt": strToU8("123456789") });
  const member = zipDirectory(original)[0]; const central = member.data_limit;
  const extra = signature ? 16 : 12;
  const bytes = new Uint8Array(original.length + extra);
  bytes.set(original.subarray(0, central)); bytes.set(original.subarray(central), central + extra);
  const view = new DataView(bytes.buffer);
  view.setUint16(6, member.flags | 8, true); view.setUint16(central + extra + 8, member.flags | 8, true);
  for (const offset of [14, 18, 22]) view.setUint32(offset, 0, true);
  let at = central;
  if (signature) { view.setUint32(at, 0x08074b50, true); at += 4; }
  for (const value of [member.crc32, member.compressed_bytes, member.uncompressed_bytes]) { view.setUint32(at, value, true); at += 4; }
  view.setUint32(bytes.length - 6, central + extra, true);
  expect(new TextDecoder().decode(unpack(bytes)[0].bytes)).toBe("123456789");
  view.setUint32(central + (signature ? 4 : 0), 0, true);
  expect(() => unpack(bytes)).toThrow(/descriptor/);
});

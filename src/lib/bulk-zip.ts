import { inflateRawSync } from "node:zlib";
import { bulkError } from "./bulk-table";

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_MEMBER_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 48 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
export interface BulkMember {
  name: string; method: number; flags: number; crc32: number;
  compressed_bytes: number; uncompressed_bytes: number; offset: number; data_limit: number;
}

export function decodeUtf8(bytes: Uint8Array): string {
  try {
    const text = decoder.decode(bytes);
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? `\uFEFF${text}` : text;
  } catch { return bulkError("Invalid UTF-8"); }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, initial) => {
  let value = initial;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

/** Bounds are checked before inflating; no files are extracted to disk. */
export function zipDirectory(bytes: Uint8Array): BulkMember[] {
  if (bytes.length > MAX_ARCHIVE_BYTES) bulkError("Archive size limit exceeded");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 65557); pos--) {
    if (view.getUint32(pos, true) === 0x06054b50 && pos + 22 + view.getUint16(pos + 20, true) === bytes.length) { end = pos; break; }
  }
  if (end < 0) bulkError("Missing ZIP end record");
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  let pos = view.getUint32(end + 16, true);
  const limit = pos;
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true)
    || !count || count > 256 || pos + size !== end) bulkError("Unsupported ZIP directory");
  const members: BulkMember[] = [];
  const names = new Set<string>();
  let total = 0;
  for (let index = 0; index < count; index++) {
    const { member, name, next } = readDirectoryMember(pos, end, view, bytes, limit);
    total += member.uncompressed_bytes;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Archive names must not contain control characters.
    if (!name || /[\\:\u0000-\u001F\u007F]/.test(name) || name.split("/").some(part => !part || part === "." || part === "..")
      || names.has(name.toLowerCase()) || ![0, 8].includes(member.method) || member.uncompressed_bytes > MAX_MEMBER_BYTES
      || total > MAX_TOTAL_BYTES || member.offset + 30 + member.compressed_bytes > limit) bulkError("Unsupported, oversized or duplicate ZIP member");
    names.add(name.toLowerCase()); members.push(member); pos = next;
  }
  if (pos !== end) bulkError("ZIP directory length mismatch");
  return members;
}

function readDirectoryMember(pos: number, end: number, view: DataView<ArrayBufferLike>, bytes: Uint8Array<ArrayBufferLike>, limit: number) {
  if (pos + 46 > end || view.getUint32(pos, true) !== 0x02014b50) bulkError("Invalid ZIP member directory");
  const flags = view.getUint16(pos + 8, true);
  const nameLength = view.getUint16(pos + 28, true);
  const next = pos + 46 + nameLength + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
  if (next > end || view.getUint16(pos + 34, true) || (flags & ~0x80e)) bulkError("Unsupported ZIP flags or bounds");
  const name = decodeUtf8(bytes.subarray(pos + 46, pos + 46 + nameLength));
  const member = { name, flags, method: view.getUint16(pos + 10, true), crc32: view.getUint32(pos + 16, true), compressed_bytes: view.getUint32(pos + 20, true), uncompressed_bytes: view.getUint32(pos + 24, true), offset: view.getUint32(pos + 42, true), data_limit: limit };
  return { member, name, next };
}

export function zipMember(bytes: Uint8Array, member: BulkMember) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pos = member.offset;
  if (pos + 30 > member.data_limit || view.getUint32(pos, true) !== 0x04034b50 || view.getUint16(pos + 6, true) !== member.flags
    || view.getUint16(pos + 8, true) !== member.method) bulkError("ZIP local header differs from directory");
  const nameEnd = pos + 30 + view.getUint16(pos + 26, true);
  const start = nameEnd + view.getUint16(pos + 28, true);
  let end = start + member.compressed_bytes;
  if (end > member.data_limit || decodeUtf8(bytes.subarray(pos + 30, nameEnd)) !== member.name) bulkError("ZIP member name or bounds mismatch");
  const expected = [member.crc32, member.compressed_bytes, member.uncompressed_bytes];
  if (member.flags & 8) {
    if (end + 12 > member.data_limit) bulkError("Missing ZIP data descriptor");
    if (view.getUint32(end, true) === 0x08074b50) end += 4;
    if (end + 12 > member.data_limit || expected.some((value, index) => view.getUint32(end + index * 4, true) !== value)) bulkError("Invalid ZIP data descriptor");
    end += 12;
    if (expected.some((value, index) => { const local = view.getUint32(pos + 14 + index * 4, true); return local !== 0 && local !== value; })) bulkError("Conflicting ZIP local sizes or CRC");
  } else if (expected.some((value, index) => view.getUint32(pos + 14 + index * 4, true) !== value)) bulkError("ZIP local sizes or CRC differ from directory");
  const compressed = bytes.subarray(start, start + member.compressed_bytes);
  let plain: Uint8Array;
  try { plain = member.method === 0 ? compressed : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.max(1, member.uncompressed_bytes + 1) })); }
  catch { return bulkError("ZIP decompression failed or exceeded its declared size"); }
  if (plain.length !== member.uncompressed_bytes || crc32(plain) !== member.crc32) bulkError("ZIP member size or CRC32 verification failed");
  return { bytes: plain, start: pos, end };
}

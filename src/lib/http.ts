import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";
import { unzipSync } from "fflate";

export interface OrangeBookFetchOptions
    extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * FDA Orange Book ZIP download URL.
 * Contains products.txt, patent.txt, and exclusivity.txt (tilde-delimited).
 */
const ORANGE_BOOK_ZIP_URL = "https://www.fda.gov/media/76860/download";

/** File names inside the Orange Book ZIP */
const FILE_NAMES: Record<OrangeBookFileType, string> = {
    products: "products.txt",
    patents: "patent.txt",
    exclusivity: "exclusivity.txt",
};

export type OrangeBookFileType = "products" | "patents" | "exclusivity";

/** Cached extracted text files from the ZIP */
let zipCache: { files: Map<string, string>; fetchedAt: number } | null = null;
const ZIP_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Fetch and cache all Orange Book data files from the FDA ZIP.
 * Uses fflate for ZIP decompression (pure JS, Workers-compatible).
 */
async function fetchAndCacheZip(
    opts?: OrangeBookFetchOptions,
): Promise<Map<string, string>> {
    if (zipCache && Date.now() - zipCache.fetchedAt < ZIP_CACHE_TTL) {
        return zipCache.files;
    }

    const response = await restFetch(ORANGE_BOOK_ZIP_URL, "", undefined, {
        ...opts,
        headers: {
            Accept: "*/*",
            ...(opts?.headers ?? {}),
        },
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 60_000,
        userAgent: "fda-orange-book-mcp-server/1.0 (bio-mcp)",
    });

    if (!response.ok) {
        throw new Error(
            `FDA Orange Book ZIP download failed: HTTP ${response.status}`,
        );
    }

    const buffer = await response.arrayBuffer();
    const zipData = new Uint8Array(buffer);
    const unzipped = unzipSync(zipData);

    const decoder = new TextDecoder("utf-8");
    const files = new Map<string, string>();

    for (const [path, data] of Object.entries(unzipped)) {
        if (path.endsWith(".txt")) {
            const baseName = path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
            files.set(baseName, decoder.decode(data));
        }
    }

    zipCache = { files, fetchedAt: Date.now() };
    return files;
}

/**
 * Fetch a specific Orange Book data file (extracts from cached ZIP).
 * Returns the raw text content of the tilde-delimited TXT file.
 */
export async function orangeBookFetchText(
    fileType: OrangeBookFileType,
    opts?: OrangeBookFetchOptions,
): Promise<string> {
    const files = await fetchAndCacheZip(opts);
    const targetName = FILE_NAMES[fileType];
    const text = files.get(targetName);
    if (!text) {
        const available = Array.from(files.keys()).join(", ");
        throw new Error(
            `File "${targetName}" not found in Orange Book ZIP. Available: ${available}`,
        );
    }
    return text;
}

/**
 * Parse tilde-delimited FDA Orange Book text data into an array of objects.
 * The first line contains column headers separated by ~.
 * Subsequent lines contain data separated by ~.
 */
export function parseTildeDelimited(
    rawText: string,
): Record<string, string>[] {
    const lines = rawText.trim().split("\n");
    if (lines.length < 2) return [];

    const headers = lines[0].split("~").map((h) => h.trim());

    const records: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split("~");
        const record: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            record[headers[j]] = (values[j] ?? "").trim();
        }
        records.push(record);
    }

    return records;
}

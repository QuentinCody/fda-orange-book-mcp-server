import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

export interface OrangeBookFetchOptions
    extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Direct download URLs for the individual Orange Book TXT data files.
 * These URLs serve the raw tilde-delimited text files.
 */
export const ORANGE_BOOK_DOWNLOAD_URLS = {
    products: "https://www.fda.gov/media/76860/download",
    patents: "https://www.fda.gov/media/76861/download",
    exclusivity: "https://www.fda.gov/media/76862/download",
} as const;

export type OrangeBookFileType = keyof typeof ORANGE_BOOK_DOWNLOAD_URLS;

/**
 * Fetch a raw Orange Book data file from the FDA website.
 * Returns the raw text content of the tilde-delimited TXT file.
 */
export async function orangeBookFetch(
    fileType: OrangeBookFileType,
    opts?: OrangeBookFetchOptions,
): Promise<Response> {
    const url = ORANGE_BOOK_DOWNLOAD_URLS[fileType];
    const headers: Record<string, string> = {
        Accept: "text/plain, text/csv, */*",
        ...(opts?.headers ?? {}),
    };

    // Use restFetch for retry/timeout behavior, path is the full URL
    return restFetch(url, "", undefined, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 60_000,
        userAgent: "fda-orange-book-mcp-server/1.0 (bio-mcp)",
    });
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

    // First line is headers
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

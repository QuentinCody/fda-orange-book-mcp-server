import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {
    orangeBookFetch,
    parseTildeDelimited,
    type OrangeBookFileType,
} from "./http";

/** In-memory cache entry with TTL */
interface CacheEntry {
    data: Record<string, string>[];
    fetchedAt: number;
}

/** 24-hour cache TTL in milliseconds */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** In-memory cache for parsed Orange Book data files */
const dataCache = new Map<OrangeBookFileType, CacheEntry>();

/**
 * Get cached data or fetch + parse from FDA.
 */
async function getCachedData(
    fileType: OrangeBookFileType,
): Promise<Record<string, string>[]> {
    const cached = dataCache.get(fileType);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.data;
    }

    const response = await orangeBookFetch(fileType);
    if (!response.ok) {
        let errorBody: string;
        try {
            errorBody = await response.text();
        } catch {
            errorBody = response.statusText;
        }
        throw new Error(
            `FDA download failed for ${fileType}: HTTP ${response.status} - ${errorBody.slice(0, 300)}`,
        );
    }

    const rawText = await response.text();
    const data = parseTildeDelimited(rawText);

    dataCache.set(fileType, { data, fetchedAt: Date.now() });
    return data;
}

/**
 * Case-insensitive substring match filter.
 */
function matchesFilter(
    records: Record<string, string>[],
    params: Record<string, unknown>,
): Record<string, string>[] {
    const filters = Object.entries(params).filter(
        ([key, val]) =>
            key !== "limit" && key !== "offset" && val !== undefined && val !== "",
    );

    if (filters.length === 0) return records;

    return records.filter((record) =>
        filters.every(([key, val]) => {
            const fieldValue = record[key];
            if (fieldValue === undefined) return false;
            return fieldValue
                .toLowerCase()
                .includes(String(val).toLowerCase());
        }),
    );
}

/**
 * Apply limit and offset to results.
 */
function paginate(
    records: Record<string, string>[],
    params: Record<string, unknown>,
): Record<string, string>[] {
    const offset = Number(params.offset) || 0;
    const limit = Number(params.limit) || 500;
    return records.slice(offset, offset + limit);
}

/**
 * Create an ApiFetchFn for FDA Orange Book data.
 *
 * Routes:
 *   GET /products   - Search approved drug products
 *   GET /patents    - Search patent data
 *   GET /exclusivity - Search exclusivity data
 *
 * All query parameters are used as case-insensitive substring filters
 * against the corresponding field names. Special params: limit, offset.
 */
export function createOrangeBookApiFetch(): ApiFetchFn {
    return async (request) => {
        const path = request.path.replace(/^\/+/, "").split("?")[0];
        const params = request.params ?? {};

        let fileType: OrangeBookFileType;

        if (path === "products" || path.startsWith("products/")) {
            fileType = "products";
        } else if (path === "patents" || path.startsWith("patents/")) {
            fileType = "patents";
        } else if (
            path === "exclusivity" ||
            path.startsWith("exclusivity/")
        ) {
            fileType = "exclusivity";
        } else {
            throw new Error(
                `Unknown Orange Book endpoint: /${path}. Valid endpoints: /products, /patents, /exclusivity`,
            );
        }

        const allData = await getCachedData(fileType);
        const filtered = matchesFilter(allData, params);
        const results = paginate(filtered, params);

        return {
            status: 200,
            data: {
                total_unfiltered: allData.length,
                total_filtered: filtered.length,
                returned: results.length,
                offset: Number(params.offset) || 0,
                limit: Number(params.limit) || 500,
                results,
            },
        };
    };
}

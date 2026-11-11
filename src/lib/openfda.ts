import { restFetch } from "@bio-mcp/shared/http/rest-fetch";

/** Alternate source: preserve openFDA's nested records and update metadata. */
export async function fetchOrangeBookApi(params: Record<string, unknown>, apiKey?: string): Promise<{ status: number; data: unknown }> {
  const query = { ...params };
  // Code Mode callers commonly use URL-style Boolean connectors. restFetch
  // encodes query values, so convert those connectors to their decoded form.
  for (const field of ["search", "count"]) {
    if (typeof query[field] === "string") {
      query[field] = query[field].replace(/\+(AND|OR|NOT)\+/g, " $1 ");
    }
  }
  if (apiKey) query.api_key = apiKey;
  const response = await restFetch("https://api.fda.gov", "/drug/orangebook.json", query, {
    headers: { Accept: "application/json" },
    timeout: 8_000,
    deadlineMs: 26_000,
    retries: 2,
    cache: { ttl: 300 },
    userAgent: "fda-orange-book-mcp-server/1.0 (bio-mcp)",
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 404 && isNoMatches(data)) {
      return { status: 200, data: { meta: { results: { total: 0 } }, results: [] } };
    }
    throw new Error(`openFDA Orange Book returned HTTP ${response.status}`);
  }
  return { status: response.status, data };
}

function isNoMatches(data: unknown): boolean {
  if (!data || typeof data !== "object" || !("error" in data)) return false;
  const error = data.error;
  return !!error && typeof error === "object" && "message" in error && error.message === "No matches found!";
}

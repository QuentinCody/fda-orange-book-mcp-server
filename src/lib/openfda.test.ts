import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOrangeBookApi } from "./openfda";

afterEach(() => vi.unstubAllGlobals());

describe("openFDA Orange Book alternate source", () => {
  it("preserves identifiers, nested patents/exclusivity and last_updated", async () => {
    const payload = { meta: { last_updated: "2026-09-25" }, results: [{ product_number: "001", products: [{ application_number: "020449", application_type: "N", brand_name: "TAXOTERE" }], patents: [{ patent_number: "fixture-patent" }], exclusivity: [{ exclusivity_code: "NCE" }] }] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchOrangeBookApi({ search: 'products.application_number:020449+AND+product_number:001', limit: 1 }, "fixture-key");
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe("https://api.fda.gov/drug/orangebook.json");
    expect(url.searchParams.get("search")).toBe("products.application_number:020449 AND product_number:001");
    expect(url.searchParams.get("api_key")).toBe("fixture-key");
    expect(result).toEqual({ status: 200, data: payload });
  });

  it("normalizes an actual no-match response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { code: "NOT_FOUND", message: "No matches found!" } }, { status: 404 })));
    expect(await fetchOrangeBookApi({ search: 'products.application_number:000000' })).toEqual({ status: 200, data: { meta: { results: { total: 0 } }, results: [] } });
  });

  it.each([null, {}, { error: null }, { error: {} }, { error: { message: "Unknown endpoint" } }])("does not disguise an unrelated 404 (%j) as empty data", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status: 404 })));
    await expect(fetchOrangeBookApi({})).rejects.toThrow("HTTP 404");
  });

  it("does not echo upstream error bodies containing credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "bad fixture-key" } }, { status: 401 })));
    await expect(fetchOrangeBookApi({}, "fixture-key")).rejects.toThrow("openFDA Orange Book returned HTTP 401");
  });
});

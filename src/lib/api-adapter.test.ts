import { afterEach, describe, expect, it, vi } from "vitest";
import { archive, rows, table } from "./bulk.test-support";
import { createOrangeBookApiFetch } from "./api-adapter";

afterEach(() => vi.unstubAllGlobals());

describe("Orange Book source selection", () => {
  it("routes the alternate API without downloading the bulk ZIP", async () => {
    const payload = { meta: { last_updated: "2026-09-25" }, results: [{ product_number: "001", products: [{ application_number: "020449" }] }] };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);
    expect(await createOrangeBookApiFetch()({ method: "GET", path: "/drug/orangebook.json", params: { limit: 1 } })).toEqual({ status: 200, data: payload });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.fda.gov/drug/orangebook.json?limit=1");
  });

  it("retains all existing file-backed product, patent and exclusivity queries", async () => {
    const zip = archive({
      "products.txt": table("products", [{ ...rows.products, Appl_No: "020449", Trade_Name: "TAXOTERE" }]),
      "patent.txt": table("patents", [
        { ...rows.patents, Appl_No: "020449", Patent_No: "fixture-patent", Delist_Flag: "Y" },
        { ...rows.patents, Appl_No: "020449", Product_No: "002", Patent_No: "fixture-patent*PED", Patent_Use_Code: "U-2", Drug_Substance_Flag: "", Drug_Product_Flag: "Y", Delist_Flag: "" },
      ]),
      "exclusivity.txt": table("exclusivity", [{ ...rows.exclusivity, Appl_No: "020449" }]),
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(zip));
    vi.stubGlobal("fetch", fetchMock);
    const api = createOrangeBookApiFetch();
    const products = await api({ method: "GET", path: "/products", params: { Trade_Name: "taxotere" } });
    const patents = await api({ method: "GET", path: "/patents", params: { Appl_No: "020449" } });
    const exclusivity = await api({ method: "GET", path: "/exclusivity", params: { Appl_No: "020449" } });
    expect(products.data).toMatchObject({ total_filtered: 1, results: [{ Appl_Type: "N", Appl_No: "020449", Product_No: "001", Trade_Name: "TAXOTERE" }] });
    expect(patents.data).toMatchObject({ results: [{ Patent_No: "fixture-patent", Drug_Substance_Flag: "Y", Drug_Product_Flag: "", Delist_Flag: "Y" }, { Patent_No: "fixture-patent*PED", Drug_Substance_Flag: "", Drug_Product_Flag: "Y", Delist_Flag: "" }] });
    const use = await api({ method: "GET", path: "/patents", params: { Patent_Use_Code: "u-2" } });
    expect(use.data).toMatchObject({ total_filtered: 1, results: [{ Product_No: "002", Patent_No: "fixture-patent*PED", Patent_Use_Code: "U-2" }] });
    expect(exclusivity.data).toMatchObject({ results: [{ Exclusivity_Code: "NCE" }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://www.fda.gov/media/76860/download");
  });

  it("rejects writes to the new read-only surface before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createOrangeBookApiFetch()({ method: "POST", path: "/drug/orangebook.json" })).rejects.toThrow("GET queries only");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

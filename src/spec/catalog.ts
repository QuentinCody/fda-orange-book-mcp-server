import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const orangeBookCatalog: ApiCatalog = {
    name: "FDA Orange Book",
    baseUrl: "https://www.fda.gov",
    version: "2024",
    auth: "none",
    endpointCount: 3,
    notes:
        "- Data comes from FDA Orange Book bulk data files, updated monthly\n" +
        "- Source: https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files\n" +
        "- Original format is tilde-delimited (~) TXT files; parsed into JSON arrays\n" +
        "- All queries filter in-memory from cached parsed data (24h cache TTL)\n" +
        "- Filter parameters are case-insensitive substring matches against field values\n" +
        "- Use 'limit' and 'offset' params for pagination (default limit: 500)\n" +
        "- Products file contains ~34,000 records, Patents ~4,000, Exclusivity ~3,000\n" +
        "- Appl_No (NDA/ANDA number) is the common key linking products, patents, and exclusivity",
    endpoints: [
        {
            method: "GET",
            path: "/products",
            summary:
                "Search approved drug products from the Orange Book. Filter by active ingredient, dosage form/route, trade name, applicant, application number, or therapeutic equivalence code.",
            category: "products",
            queryParams: [
                {
                    name: "Ingredient",
                    type: "string",
                    required: false,
                    description:
                        "Active ingredient name (case-insensitive substring match, e.g. 'METFORMIN')",
                },
                {
                    name: "DF_Route",
                    type: "string",
                    required: false,
                    description:
                        "Dosage form and route of administration (e.g. 'TABLET;ORAL')",
                },
                {
                    name: "Trade_Name",
                    type: "string",
                    required: false,
                    description:
                        "Brand/trade name of the drug product (e.g. 'GLUCOPHAGE')",
                },
                {
                    name: "Applicant",
                    type: "string",
                    required: false,
                    description:
                        "Applicant/company name (e.g. 'BRISTOL MYERS SQUIBB')",
                },
                {
                    name: "Appl_No",
                    type: "string",
                    required: false,
                    description:
                        "NDA or ANDA application number (e.g. '021574')",
                },
                {
                    name: "Type",
                    type: "string",
                    required: false,
                    description:
                        "Application type: 'N' for NDA (new drug), 'A' for ANDA (generic)",
                    enum: ["N", "A"],
                },
                {
                    name: "TE_Code",
                    type: "string",
                    required: false,
                    description:
                        "Therapeutic equivalence code (e.g. 'AB', 'BX')",
                },
                {
                    name: "Strength",
                    type: "string",
                    required: false,
                    description: "Drug strength (e.g. '500MG')",
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results to return (default: 500)",
                },
                {
                    name: "offset",
                    type: "number",
                    required: false,
                    description: "Number of results to skip (default: 0)",
                },
            ],
        },
        {
            method: "GET",
            path: "/patents",
            summary:
                "Search Orange Book patent data. Find patents associated with approved drug products by patent number, expiry date, or substance/product flags.",
            category: "patents",
            queryParams: [
                {
                    name: "Patent_No",
                    type: "string",
                    required: false,
                    description: "US patent number (e.g. '6011040')",
                },
                {
                    name: "Patent_Expire_Date_Text",
                    type: "string",
                    required: false,
                    description:
                        "Patent expiration date (e.g. 'Jun 20, 2028')",
                },
                {
                    name: "Drug_Substance_Flag",
                    type: "string",
                    required: false,
                    description:
                        "Whether patent covers the drug substance: 'Y' or 'N'",
                    enum: ["Y", "N"],
                },
                {
                    name: "Drug_Product_Flag",
                    type: "string",
                    required: false,
                    description:
                        "Whether patent covers the drug product: 'Y' or 'N'",
                    enum: ["Y", "N"],
                },
                {
                    name: "Appl_No",
                    type: "string",
                    required: false,
                    description:
                        "NDA/ANDA application number to find associated patents",
                },
                {
                    name: "Appl_Type",
                    type: "string",
                    required: false,
                    description: "Application type: 'N' for NDA, 'A' for ANDA",
                    enum: ["N", "A"],
                },
                {
                    name: "Product_No",
                    type: "string",
                    required: false,
                    description: "Product number within the application",
                },
                {
                    name: "Delist_Flag",
                    type: "string",
                    required: false,
                    description: "Patent delist flag",
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results to return (default: 500)",
                },
                {
                    name: "offset",
                    type: "number",
                    required: false,
                    description: "Number of results to skip (default: 0)",
                },
            ],
        },
        {
            method: "GET",
            path: "/exclusivity",
            summary:
                "Search Orange Book exclusivity data. Find marketing exclusivity periods granted to approved drug products by exclusivity code, date, or application number.",
            category: "exclusivity",
            queryParams: [
                {
                    name: "Exclusivity_Code",
                    type: "string",
                    required: false,
                    description:
                        "Exclusivity type code (e.g. 'NCE' for new chemical entity, 'ODE' for orphan drug, 'PED' for pediatric)",
                },
                {
                    name: "Exclusivity_Date",
                    type: "string",
                    required: false,
                    description:
                        "Exclusivity expiration date (e.g. 'Jun 20, 2028')",
                },
                {
                    name: "Appl_No",
                    type: "string",
                    required: false,
                    description:
                        "NDA/ANDA application number to find associated exclusivities",
                },
                {
                    name: "Appl_Type",
                    type: "string",
                    required: false,
                    description: "Application type: 'N' for NDA, 'A' for ANDA",
                    enum: ["N", "A"],
                },
                {
                    name: "Product_No",
                    type: "string",
                    required: false,
                    description: "Product number within the application",
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results to return (default: 500)",
                },
                {
                    name: "offset",
                    type: "number",
                    required: false,
                    description: "Number of results to skip (default: 0)",
                },
            ],
        },
    ],
};

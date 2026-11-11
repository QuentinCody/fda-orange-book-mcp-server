import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

const snapshotParam = { name: "snapshot_sha256", type: "string" as const, required: false, description: "Archive SHA-256 from /bulk/manifest. Rejects a changed snapshot; restart the complete multi-call query if it changes. This is a content identity, not a historical-release selector." };

export const orangeBookCatalog: ApiCatalog = {
    name: "FDA Orange Book",
    baseUrl: "https://www.fda.gov",
    version: "bulk + openFDA",
    auth: "Bulk files: none; openFDA: optional server-side OPENFDA_API_KEY",
    endpointCount: 6,
    notes:
        "- Data comes from FDA Orange Book bulk data files, updated monthly\n" +
        "- Source: https://www.fda.gov/drugs/drug-approvals-and-databases/orange-book-data-files\n" +
        "- Original format is tilde-delimited (~) TXT files; parsed into JSON arrays\n" +
        "- /products, /patents and /exclusivity filter cached bulk files (24h cache TTL). /drug/orangebook.json uses openFDA search syntax and preserves nested records plus meta.last_updated; this is an alternate source, not a bulk replacement.\n" +
        "- Bulk parsing validates every required file before publishing a snapshot. Native cells, repeated rows and additional columns are preserved. Malformed files fail rather than become empty results. /bulk/file returns original text.\n" +
        "- Every bulk response carries _orange_book archive and member SHA-256 hashes. Pin multi-call queries with snapshot_sha256 from /bulk/manifest.\n" +
        "- Filter parameters are case-insensitive substring matches against field values\n" +
        "- Use 'limit' and 'offset' params for pagination (default limit: 500, range: 1–10000; offset is a nonnegative integer)\n" +
        "- Row counts change with each release; read total_unfiltered from file queries and meta.results.total from openFDA\n" +
        "- Join bulk records by Appl_Type + Appl_No + Product_No. The API equivalents are products[].application_type + products[].application_number + product_number. Preserve leading zeros and distinguish NDA/ANDA. Missing patent/exclusivity arrays do not establish absence of protection.\n" +
        "- Preserve every patent/exclusivity row, use code, delist flag and original/pediatric-extension date. Listed expiration dates do not determine generic market-entry eligibility; do not collapse different products or protections to a single earliest date.",
    endpoints: [
        {
            method: "GET", path: "/bulk/manifest", category: "bulk",
            summary: "Validate all three Orange Book files and return archive/file hashes, native columns, row counts and retrieval metadata",
            queryParams: [snapshotParam, { name: "refresh", type: "boolean", required: false, description: "Download and validate a fresh archive atomically (default false; 24-hour cache). Failure returns an error." }],
            usageHint: "Read _orange_book.snapshot_sha256 and supply it to every page and joined-file request. The FDA download is mutable; a hash is not an FDA release date.",
            example: "const m = await api.get('/bulk/manifest'); return await api.get('/products', {Trade_Name:'Example', snapshot_sha256:m._orange_book.snapshot_sha256, limit:10});",
        },
        {
            method: "GET", path: "/bulk/file", category: "bulk",
            summary: "Retrieve the complete validated native UTF-8 text file, preserving BOM, line endings, headers and cell whitespace",
            queryParams: [snapshotParam, { name: "file", type: "string", required: true, enum: ["products", "patents", "exclusivity"], description: "Required native file; use query_data to recover large staged results" }],
            usageHint: "raw_text round-trips to the native uncompressed bytes; compare its UTF-8 SHA-256 to file.sha256. This is the whole file, not a filtered page.",
        },
        {
          "method": "GET",
          "path": "/drug/orangebook.json",
          "summary": "FDA Orange Book approved products with nested patents and exclusivity; alternate source to the monthly bulk files",
          "category": "orange_book",
          "queryParams": [
            {
              "name": "search",
              "type": "string",
              "required": false,
              "description": "openFDA expression, e.g. products.application_number:\"020449\" or products.active_ingredients.name:\"METFORMIN\""
            },
            {
              "name": "limit",
              "type": "number",
              "required": false,
              "description": "Maximum records (1–99 per endpoint guide)",
              "default": 1
            },
            {
              "name": "skip",
              "type": "number",
              "required": false,
              "description": "Pagination offset",
              "default": 0
            },
            {
              "name": "count",
              "type": "string",
              "required": false,
              "description": "Aggregate a field instead of returning records, e.g. products.marketing_status.exact"
            }
          ],
          "usageHint": "Preserve meta.last_updated and all products/patents/exclusivity arrays. Join using application type, zero-padded application number and product_number. This is product-level regulatory data; absent fields are not proof of no patent or exclusivity.",
          "example": "return await api.get('/drug/orangebook.json', {search:'products.application_number:020449',limit:1});"
        },
        {
            method: "GET",
            path: "/products",
            summary:
                "Search approved drug products from the Orange Book. Filter by active ingredient, dosage form/route, trade name, applicant, application number, or therapeutic equivalence code.",
            category: "products",
            queryParams: [
                snapshotParam,
                {
                    name: "Ingredient",
                    type: "string",
                    required: false,
                    description:
                        "Active ingredient name (case-insensitive substring match, e.g. 'METFORMIN')",
                },
                {
                    name: "DF;Route",
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
                    name: "Appl_Type",
                    type: "string",
                    required: false,
                    description:
                        "Application type: 'N' for NDA (new drug), 'A' for ANDA (generic)",
                    enum: ["N", "A"],
                },
                { name: "Type", type: "string", required: false, description: "Marketing status: RX, OTC or DISCN (distinct from Appl_Type N/A)", enum: ["RX", "OTC", "DISCN"] },
                { name: "Product_No", type: "string", required: false, description: "Zero-padded product number within the application, e.g. 006" },
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
                    description: "Max results to return (integer 1–10000; default: 500)",
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
                snapshotParam,
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
                        "Y indicates submitted drug-substance patent information. Native unset values are blank/null, not N.",
                    enum: ["Y"],
                },
                {
                    name: "Drug_Product_Flag",
                    type: "string",
                    required: false,
                    description:
                        "Y indicates submitted drug-product patent information. Native unset values are blank/null, not N.",
                    enum: ["Y"],
                },
                {
                    name: "Patent_Use_Code",
                    type: "string",
                    required: false,
                    description: "Listed use code for an approved indication/use; substring matching, not a determination of patent coverage",
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
                    description: "Y records a sponsor's delisting request; a flagged patent may remain listed. Preserve the native flag and associated use/date context.",
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results to return (integer 1–10000; default: 500)",
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
                snapshotParam,
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
                    description: "Max results to return (integer 1–10000; default: 500)",
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

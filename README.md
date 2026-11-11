# FDA Orange Book MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream FDA Orange Book API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://fda-orange-book-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "fda-orange-book": {
      "command": "npx",
      "args": ["mcp-remote", "https://fda-orange-book-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8849/mcp` (start it with `./scripts/dev-servers.sh fda-orange-book`):

```json
{
  "mcpServers": {
    "fda-orange-book-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8849/mcp"]
    }
  }
}
```

## Tools

- `orange_book_search` — discover file-backed queries and the alternate openFDA endpoint
- `orange_book_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `orange_book_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `orange_book_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Development

`api.get('/drug/orangebook.json', { search: 'products.application_number:021880+AND+product_number:006', limit: 1 })` queries the [openFDA Orange Book API](https://open.fda.gov/apis/drug/orangebook/how-to-use-the-endpoint/). Its native response retains `meta.last_updated` and nested `products`, `patents`, and `exclusivity` arrays. Set the optional `OPENFDA_API_KEY` Worker secret for regular use. Existing `/products`, `/patents`, and `/exclusivity` routes still query the FDA ZIP.

Join the sources using application type, application number and product number, preserving leading zeros. Bulk dates are text; API dates are `YYYYMMDD`, with a separate `approved_prior_to_1982` flag. Bulk `Type` means marketing status (RX/OTC/DISCN); `Appl_Type` means NDA/ANDA (N/A). The dosage-form/route column is literally `DF;Route`. One sampled product (N/021880/006) matched products, patents and exclusivity on September 26, 2026, but full-release parity and cadence remain unproven. Missing arrays do not establish absence of protection; keep the bulk source available.

Bulk queries now validate the complete ZIP and all three tables before publishing
one cached snapshot. Required columns, row widths and literal product identities
are checked; native whitespace, empty cells, additional columns and repeated rows
are preserved. Corrupt ZIPs, invalid UTF-8 and malformed sibling files return
errors instead of partial or empty success. Downloads use a 60-second total
deadline and do not follow redirects.

Read `/bulk/manifest` for `_orange_book.snapshot_sha256`, native column names,
row counts, archive/member hashes and retrieval metadata. Pass that hash as
`snapshot_sha256` to every related query or page. A changed snapshot fails the
request; restart the complete query from a new manifest. This fingerprint does
not select historical releases or establish an FDA publication date. The pipeline
uses one manifest for all product, patent and exclusivity joins. The cache lasts
24 hours; `/bulk/manifest` accepts an explicit boolean `refresh: true` for an
atomic replacement. Concurrent loads share one download. Failed refreshes leave
the previous snapshot intact, including its original identity and retrieval time;
expired snapshots are not returned on download failure.

`api.get('/bulk/file', {file:'products', snapshot_sha256:hash})` retrieves the
complete native text, including BOM and line endings. Its UTF-8 bytes match
`file.sha256`; large results are recovered through `orange_book_query_data`.
The other file values are `patents` and `exclusivity`. Filtered queries require
literal native column names and string values, with case-insensitive substring
matching. `limit` is an integer from 1 to 10000 (default 500); `offset` is a
nonnegative integer. Routes are exact GET paths without an embedded query string
or request body. Use the parameters object for filters.

Operational limits are 32 MiB downloaded ZIP, 24 MiB per member, 48 MiB total
uncompressed members, 256 members, 250,000 data rows per table, 64 columns,
256 UTF-16 code units per header and 65,536 per row. ZIP64, encryption, unsafe or
ambiguous member names, overlaps, inconsistent headers/descriptors and invalid
CRCs are rejected. These are local resource bounds, not FDA dataset limits.
All four MCP tools have both plain and `mcp_` aliases; complete responses,
including SQL/schema results and errors, are measured for staging and cited.

Synthetic ZIP, MCP and SQLite checks pass. A fresh complete FDA release and
Workerd execution remain unqualified in the current restricted environment;
see the [bulk-ingestion review](../../docs/audits/2026-10-05-orange-book-bulk-review.md).

```bash
./scripts/dev-servers.sh fda-orange-book            # run locally (port 8849)
pnpm --filter fda-orange-book-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from FDA Orange Book and stays under the terms of that source: US public domain.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->

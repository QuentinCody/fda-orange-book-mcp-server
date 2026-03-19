import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createOrangeBookApiFetch } from "../lib/api-adapter";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface SearchProductsArgs {
    Ingredient?: string;
    Trade_Name?: string;
    Applicant?: string;
    Appl_No?: string;
    DF_Route?: string;
    Type?: string;
    TE_Code?: string;
    Strength?: string;
    limit?: number;
}

/** Shape of the DO binding used for staging */
interface StagingDO {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
}

interface ExtraWithEnvAndSession {
    env?: Partial<Env>;
    sessionId?: string;
}

function extractStagingDO(env: Partial<Env>): StagingDO | undefined {
    const binding = env.ORANGE_BOOK_DATA_DO;
    if (
        binding &&
        typeof binding === "object" &&
        "idFromName" in binding &&
        "get" in binding
    ) {
        return binding as StagingDO;
    }
    return undefined;
}

export function registerSearchProducts(server: McpServer, env?: Partial<Env>) {
    server.registerTool(
        "orange_book_search_products",
        {
            title: "Search Orange Book Products",
            description:
                "Search FDA Orange Book approved drug products. Filter by active ingredient, trade name, applicant, " +
                "application number, dosage form/route, type (NDA/ANDA), therapeutic equivalence code, or strength. " +
                "Data is sourced from FDA bulk data files updated monthly.",
            inputSchema: {
                Ingredient: z.string().optional().describe("Active ingredient name (e.g. 'METFORMIN', 'ATORVASTATIN')"),
                Trade_Name: z.string().optional().describe("Brand/trade name (e.g. 'GLUCOPHAGE', 'LIPITOR')"),
                Applicant: z.string().optional().describe("Applicant/company name (e.g. 'BRISTOL MYERS SQUIBB')"),
                Appl_No: z.string().optional().describe("NDA or ANDA application number (e.g. '021574')"),
                DF_Route: z.string().optional().describe("Dosage form and route (e.g. 'TABLET;ORAL')"),
                Type: z.string().optional().describe("'N' for NDA (new drug), 'A' for ANDA (generic)"),
                TE_Code: z.string().optional().describe("Therapeutic equivalence code (e.g. 'AB', 'BX')"),
                Strength: z.string().optional().describe("Drug strength (e.g. '500MG')"),
                limit: z.number().int().positive().max(5000).default(500).optional().describe("Max results (default: 500)"),
            },
        },
        async (args: SearchProductsArgs, extra) => {
            const typedExtra = extra as ExtraWithEnvAndSession;
            const runtimeEnv = env ?? typedExtra.env ?? {};
            const stagingDO = extractStagingDO(runtimeEnv);
            try {
                const apiFetch = createOrangeBookApiFetch();
                const params: Record<string, unknown> = {};

                if (args.Ingredient) params.Ingredient = args.Ingredient;
                if (args.Trade_Name) params.Trade_Name = args.Trade_Name;
                if (args.Applicant) params.Applicant = args.Applicant;
                if (args.Appl_No) params.Appl_No = args.Appl_No;
                if (args.DF_Route) params.DF_Route = args.DF_Route;
                if (args.Type) params.Type = args.Type;
                if (args.TE_Code) params.TE_Code = args.TE_Code;
                if (args.Strength) params.Strength = args.Strength;
                if (args.limit) params.limit = args.limit;

                const response = await apiFetch({ method: "GET", path: "/products", params });
                const data = response.data;

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && stagingDO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        stagingDO,
                        "products",
                        undefined,
                        undefined,
                        "orange_book",
                        typedExtra.sessionId,
                    );
                    return createCodeModeResponse(
                        {
                            staged: true,
                            data_access_id: staged.dataAccessId,
                            total_rows: staged.totalRows,
                            _staging: staged._staging,
                            message: `Product results staged. Use orange_book_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(data, {
                    meta: { fetched_at: new Date().toISOString() },
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `orange_book_search_products failed: ${msg}`);
            }
        },
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createOrangeBookApiFetch } from "../lib/api-adapter";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface SearchPatentsArgs {
    Patent_No?: string;
    Patent_Expire_Date_Text?: string;
    Drug_Substance_Flag?: string;
    Drug_Product_Flag?: string;
    Appl_No?: string;
    Appl_Type?: string;
    Product_No?: string;
    Delist_Flag?: string;
    limit?: number;
}

/** Shape of the DO binding used for staging */
interface StagingDO {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(req: Request): Promise<Response> };
}

interface ExtraWithEnvAndSession {
    env?: Record<string, unknown>;
    sessionId?: string;
}

function extractStagingDO(env: Record<string, unknown>): StagingDO | undefined {
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

export function registerSearchPatents(server: McpServer, env?: Record<string, unknown>) {
    server.registerTool(
        "orange_book_search_patents",
        {
            title: "Search Orange Book Patents",
            description:
                "Search FDA Orange Book patent data. Find patents associated with approved drug products " +
                "by patent number, expiration date, drug substance/product flags, or application number. " +
                "Data is sourced from FDA bulk data files updated monthly.",
            inputSchema: {
                Patent_No: z.string().optional().describe("US patent number (e.g. '6011040')"),
                Patent_Expire_Date_Text: z.string().optional().describe("Patent expiration date text (e.g. 'Jun 20, 2028')"),
                Drug_Substance_Flag: z.string().optional().describe("Patent covers drug substance: 'Y' or 'N'"),
                Drug_Product_Flag: z.string().optional().describe("Patent covers drug product: 'Y' or 'N'"),
                Appl_No: z.string().optional().describe("NDA/ANDA application number to find associated patents"),
                Appl_Type: z.string().optional().describe("Application type: 'N' for NDA, 'A' for ANDA"),
                Product_No: z.string().optional().describe("Product number within the application"),
                Delist_Flag: z.string().optional().describe("Patent delist flag"),
                limit: z.number().int().positive().max(5000).default(500).optional().describe("Max results (default: 500)"),
            },
        },
        async (args: SearchPatentsArgs, extra) => {
            const typedExtra = extra as ExtraWithEnvAndSession;
            const runtimeEnv = env ?? typedExtra.env ?? {};
            const stagingDO = extractStagingDO(runtimeEnv);
            try {
                const apiFetch = createOrangeBookApiFetch();
                const params: Record<string, unknown> = {};

                if (args.Patent_No) params.Patent_No = args.Patent_No;
                if (args.Patent_Expire_Date_Text) params.Patent_Expire_Date_Text = args.Patent_Expire_Date_Text;
                if (args.Drug_Substance_Flag) params.Drug_Substance_Flag = args.Drug_Substance_Flag;
                if (args.Drug_Product_Flag) params.Drug_Product_Flag = args.Drug_Product_Flag;
                if (args.Appl_No) params.Appl_No = args.Appl_No;
                if (args.Appl_Type) params.Appl_Type = args.Appl_Type;
                if (args.Product_No) params.Product_No = args.Product_No;
                if (args.Delist_Flag) params.Delist_Flag = args.Delist_Flag;
                if (args.limit) params.limit = args.limit;

                const response = await apiFetch({ method: "GET", path: "/patents", params });
                const data = response.data;

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && stagingDO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        stagingDO,
                        "patents",
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
                            message: `Patent results staged. Use orange_book_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(data, {
                    meta: { fetched_at: new Date().toISOString() },
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `orange_book_search_patents failed: ${msg}`);
            }
        },
    );
}

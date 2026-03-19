import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createOrangeBookApiFetch } from "../lib/api-adapter";
import {
    createCodeModeResponse,
    createCodeModeError,
} from "@bio-mcp/shared/codemode/response";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

interface SearchExclusivityArgs {
    Exclusivity_Code?: string;
    Exclusivity_Date?: string;
    Appl_No?: string;
    Appl_Type?: string;
    Product_No?: string;
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

export function registerSearchExclusivity(server: McpServer, env?: Partial<Env>) {
    server.registerTool(
        "orange_book_search_exclusivity",
        {
            title: "Search Orange Book Exclusivity",
            description:
                "Search FDA Orange Book exclusivity data. Find marketing exclusivity periods granted to " +
                "approved drug products by exclusivity code (NCE, ODE, PED, etc.), expiration date, or " +
                "application number. Data is sourced from FDA bulk data files updated monthly.",
            inputSchema: {
                Exclusivity_Code: z.string().optional().describe(
                    "Exclusivity type code (e.g. 'NCE' new chemical entity, 'ODE' orphan drug, 'PED' pediatric, " +
                    "'NCE-1' new chemical entity-1, 'CCSI' changes to the CCSI)",
                ),
                Exclusivity_Date: z.string().optional().describe("Exclusivity expiration date (e.g. 'Jun 20, 2028')"),
                Appl_No: z.string().optional().describe("NDA/ANDA application number"),
                Appl_Type: z.string().optional().describe("Application type: 'N' for NDA, 'A' for ANDA"),
                Product_No: z.string().optional().describe("Product number within the application"),
                limit: z.number().int().positive().max(5000).default(500).optional().describe("Max results (default: 500)"),
            },
        },
        async (args: SearchExclusivityArgs, extra) => {
            const typedExtra = extra as ExtraWithEnvAndSession;
            const runtimeEnv = env ?? typedExtra.env ?? {};
            const stagingDO = extractStagingDO(runtimeEnv);
            try {
                const apiFetch = createOrangeBookApiFetch();
                const params: Record<string, unknown> = {};

                if (args.Exclusivity_Code) params.Exclusivity_Code = args.Exclusivity_Code;
                if (args.Exclusivity_Date) params.Exclusivity_Date = args.Exclusivity_Date;
                if (args.Appl_No) params.Appl_No = args.Appl_No;
                if (args.Appl_Type) params.Appl_Type = args.Appl_Type;
                if (args.Product_No) params.Product_No = args.Product_No;
                if (args.limit) params.limit = args.limit;

                const response = await apiFetch({ method: "GET", path: "/exclusivity", params });
                const data = response.data;

                const responseSize = JSON.stringify(data).length;
                if (shouldStage(responseSize) && stagingDO) {
                    const staged = await stageToDoAndRespond(
                        data,
                        stagingDO,
                        "exclusivity",
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
                            message: `Exclusivity results staged. Use orange_book_query_data with data_access_id '${staged.dataAccessId}' to query.`,
                        },
                        { meta: { staged: true, data_access_id: staged.dataAccessId } },
                    );
                }

                return createCodeModeResponse(data, {
                    meta: { fetched_at: new Date().toISOString() },
                });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return createCodeModeError("API_ERROR", `orange_book_search_exclusivity failed: ${msg}`);
            }
        },
    );
}

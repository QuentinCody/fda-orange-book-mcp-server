import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface GetSchemaArgs {
    data_access_id?: string;
}

interface SchemaEnv {
    ORANGE_BOOK_DATA_DO?: unknown;
    [key: string]: unknown;
}

interface ExtraWithEnvAndSession {
    env?: SchemaEnv;
    sessionId?: string;
}

export function registerGetSchema(server: McpServer, env?: SchemaEnv) {
    const handler = createGetSchemaHandler("ORANGE_BOOK_DATA_DO", "orange_book");

    server.registerTool(
        "orange_book_get_schema",
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged FDA Orange Book data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets available in this session.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID for the staged dataset. If omitted, lists all staged datasets in this session.",
                ),
            },
        },
        async (args: GetSchemaArgs, extra) => {
            const typedExtra = extra as ExtraWithEnvAndSession;
            const runtimeEnv: SchemaEnv = env ?? typedExtra.env ?? {};
            const handlerArgs: Record<string, unknown> = {
                data_access_id: args.data_access_id,
            };
            return handler(handlerArgs, runtimeEnv, typedExtra.sessionId);
        },
    );
}

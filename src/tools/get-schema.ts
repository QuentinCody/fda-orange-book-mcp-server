import type { McpServer } from "@bio-mcp/shared/mcp";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface GetSchemaArgs {
    data_access_id?: string;
}

interface ExtraWithEnvAndSession {
    env?: Partial<Env>;
    sessionId?: string;
}

export function registerGetSchema(server: McpServer, env?: Partial<Env>): void {
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
            const runtimeEnv = env ?? typedExtra.env ?? {};
            const handlerArgs: Record<string, unknown> = {
                data_access_id: args.data_access_id,
            };
            // Pass the full extra (not just sessionId) so the handler resolves the
            // same request scope the execute/staging path registers under
            // (getRequestScope: _meta["dev.quentincody.bio/chatId"] / mcp-chat-id header, then sessionId).
            return handler(handlerArgs, runtimeEnv, extra as Record<string, unknown>);
        },
    );
}

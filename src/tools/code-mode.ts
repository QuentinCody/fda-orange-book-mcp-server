import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { orangeBookCatalog } from "../spec/catalog";
import { createOrangeBookApiFetch } from "../lib/api-adapter";

/**
 * Interface matching what createSearchTool/createExecuteTool .register() expects.
 * The shared lib calls server.tool(name, description, schema, handler).
 */
interface ToolRegisterable {
    tool: (...args: unknown[]) => void;
}

/**
 * Create a ToolRegisterable adapter that delegates to McpServer.tool().
 *
 * McpServer.tool() has complex overloads whose union doesn't collapse to
 * (...args: unknown[]) => void.  We use Function.prototype.apply to forward
 * the variadic call so TypeScript doesn't need to reconcile the overloads.
 */
function toRegisterable(server: McpServer): ToolRegisterable {
    return {
        tool(...args: unknown[]) {
            Function.prototype.apply.call(server.tool, server, args);
        },
    };
}

/** Minimal shape required from the worker Env for Code Mode registration. */
interface CodeModeEnv {
    ORANGE_BOOK_DATA_DO: Pick<Env["ORANGE_BOOK_DATA_DO"], "get" | "idFromName">;
    CODE_MODE_LOADER: Env["CODE_MODE_LOADER"];
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const doNamespace = env.ORANGE_BOOK_DATA_DO;
    const loader = env.CODE_MODE_LOADER;

    if (!doNamespace || !loader) return;

    const apiFetch = createOrangeBookApiFetch();
    const registerable = toRegisterable(server);

    const searchTool = createSearchTool({
        prefix: "orange_book",
        catalog: orangeBookCatalog,
    });
    searchTool.register(registerable);

    const executeTool = createExecuteTool({
        prefix: "orange_book",
        catalog: orangeBookCatalog,
        apiFetch,
        doNamespace,
        loader,
    });
    executeTool.register(registerable);
}

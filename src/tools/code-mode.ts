import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { orangeBookCatalog } from "../spec/catalog";
import { createOrangeBookApiFetch } from "../lib/api-adapter";
import { orangeBookResponse } from "../lib/tool-result";

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
function toRegisterable(server: McpServer, env: CodeModeEnv): ToolRegisterable {
    return {
        tool(...args: unknown[]) {
            const [name, ...rest] = args;
            const handler = rest.pop() as (input: unknown, extra: unknown) => Promise<unknown>;
            for (const alias of [String(name), `mcp_${String(name)}`]) {
                Function.prototype.apply.call(server.tool, server, [alias, ...rest,
                    (input: unknown, extra: unknown) => orangeBookResponse(() => handler(input, extra), env, alias, input, extra)]);
            }
        },
    };
}

/** Minimal shape required from the worker Env for Code Mode registration. */
interface CodeModeEnv {
    OPENFDA_API_KEY?: string;
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

    const apiFetch = createOrangeBookApiFetch(env.OPENFDA_API_KEY);
    const registerable = toRegisterable(server, env);

    const searchTool = createSearchTool({
        prefix: "orange_book",
        catalog: orangeBookCatalog,
    });
    searchTool.register(registerable);

    const executeTool = createExecuteTool({
        prefix: "orange_book",
        // Verifiable provenance: orange_book_execute results carry a _meta.citation.
        source: { id: "orange_book", name: "FDA Orange Book", url: "https://www.accessdata.fda.gov/scripts/cder/ob", license: "U.S. Public Domain" },
        catalog: orangeBookCatalog,
        apiFetch,
        doNamespace,
        loader,
    });
    executeTool.register(registerable);
}

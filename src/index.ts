import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
// FDA Orange Book MCP Server — Code Mode only (hand-built tools removed)
// Tools: orange_book_search, orange_book_execute, query_data, get_schema
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { OrangeBookDataDO } from "./do";

export { OrangeBookDataDO };

export class FdaOrangeBookMCP extends StatelessMcpWorker<Env> {
    server = new McpServer({
        name: "fda-orange-book",
        version: "0.1.0",
    });

    async init() {

    	configureCitationSigning(this.env);
        const env = this.env;
        registerQueryData(this.server, env);
        registerGetSchema(this.server, env);
        registerCodeMode(this.server, env);
    }
}

export default {
    fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return buildHealthResponse("fda-orange-book");
        }

        if (url.pathname === "/mcp") {
            return FdaOrangeBookMCP.serve("/mcp").fetch(request, env, ctx);
        }

        return new Response("Not found", { status: 404 });
    },
};

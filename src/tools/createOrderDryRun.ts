import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { orderInputSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerCreateOrderDryRun(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "create_order_dry_run",
        {
            description: "Build and persist a complete Coinbase order payload without execution.",
            inputSchema: orderInputSchema
        },
        async (input) => safeTool(() => context.orderProposalService.createDryRun(input))
    );
}

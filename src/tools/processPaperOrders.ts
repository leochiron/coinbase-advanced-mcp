import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerProcessPaperOrders(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "process_paper_orders",
        {
            description: "Evaluate open resting paper orders against current market prices and fill any that are triggered.",
            inputSchema: z.object({}).strict()
        },
        async () => safeTool(() => context.paperBrokerService.processFills())
    );
}

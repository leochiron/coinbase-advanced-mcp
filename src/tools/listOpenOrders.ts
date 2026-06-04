import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productIdSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerListOpenOrders(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "list_open_orders",
        {
            description: "List open Coinbase orders, optionally filtered by product id.",
            inputSchema: z.object({ productId: productIdSchema.optional() }).strict()
        },
        async ({ productId }) => safeTool(() => context.orderExecutionService.listOpenOrders(productId))
    );
}

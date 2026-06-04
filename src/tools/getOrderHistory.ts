import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productIdSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetOrderHistory(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_order_history",
        {
            description: "Return Coinbase and/or local order history.",
            inputSchema: z
                .object({
                    source: z.enum(["COINBASE", "LOCAL", "BOTH"]).default("BOTH"),
                    productId: productIdSchema.optional(),
                    startDate: z.string().datetime().optional(),
                    endDate: z.string().datetime().optional(),
                    limit: z.number().int().positive().max(250).optional().default(50)
                })
                .strict()
        },
        async (input) => safeTool(() => context.orderExecutionService.getOrderHistory(input))
    );
}

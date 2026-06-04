import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerCancelValidatedOrder(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "cancel_validated_order",
        {
            description: "Cancel a Coinbase order after explicit confirmation.",
            inputSchema: z
                .object({
                    orderId: z.string().min(1),
                    confirmationText: z.string()
                })
                .strict()
        },
        async (input) => safeTool(() => context.orderExecutionService.cancelValidatedOrder(input))
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerExecuteValidatedOrder(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "execute_validated_order",
        {
            description: "Execute a previously saved dry-run or proposal after explicit confirmation.",
            inputSchema: z
                .object({
                    dryRunId: z.string().optional(),
                    proposalId: z.string().optional(),
                    orderIndex: z.number().int().min(0).optional(),
                    confirmationText: z.string()
                })
                .strict()
        },
        async (input) => safeTool(() => context.orderExecutionService.executeValidatedOrder(input))
    );
}

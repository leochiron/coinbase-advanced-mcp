import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { limitOrderIntentSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerProposeLimitOrders(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "propose_limit_orders",
        {
            description: "Prepare limit orders without sending them and persist the proposal locally. Consult get_knowledge_base first.",
            inputSchema: z.object({ ordersIntent: z.array(limitOrderIntentSchema).min(1) }).strict()
        },
        async ({ ordersIntent }) => safeTool(() => context.orderProposalService.proposeLimitOrders(ordersIntent))
    );
}

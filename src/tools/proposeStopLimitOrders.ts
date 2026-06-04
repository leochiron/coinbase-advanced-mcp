import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { stopLimitOrderIntentSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerProposeStopLimitOrders(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "propose_stop_limit_orders",
        {
            description: "Prepare stop-limit orders without sending them and persist the proposal locally.",
            inputSchema: z.object({ ordersIntent: z.array(stopLimitOrderIntentSchema).min(1) }).strict()
        },
        async ({ ordersIntent }) => safeTool(() => context.orderProposalService.proposeStopLimitOrders(ordersIntent))
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerAnalyzePortfolioAllocation(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "analyze_portfolio_allocation",
        {
            description: "Mechanically compare current portfolio allocation to an optional target allocation.",
            inputSchema: z
                .object({
                    targetAllocation: z.record(z.number().min(0)).optional(),
                    quoteCurrency: z.string().optional(),
                    driftThresholdPercent: z.number().min(0).optional().default(5)
                })
                .strict()
        },
        async ({ targetAllocation, quoteCurrency, driftThresholdPercent }) =>
            safeTool(() =>
                context.allocationService.analyze({
                    targetAllocation,
                    quoteCurrency: (quoteCurrency ?? context.env.defaultQuoteCurrency).toUpperCase(),
                    driftThresholdPercent
                })
            )
    );
}

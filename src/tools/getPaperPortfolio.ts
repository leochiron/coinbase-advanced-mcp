import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetPaperPortfolio(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_paper_portfolio",
        {
            description: "Return the simulated paper-trading portfolio: balances, valuation, and open paper orders.",
            inputSchema: z.object({ quoteCurrency: z.string().optional() }).strict()
        },
        async ({ quoteCurrency }) =>
            safeTool(() => context.paperBrokerService.getPortfolio((quoteCurrency ?? context.env.defaultQuoteCurrency).toUpperCase()))
    );
}

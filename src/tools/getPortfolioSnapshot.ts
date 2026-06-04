import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetPortfolioSnapshot(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_portfolio_snapshot",
        {
            description: "Build a consolidated Coinbase portfolio snapshot in the requested quote currency.",
            inputSchema: z.object({ quoteCurrency: z.string().optional() }).strict()
        },
        async ({ quoteCurrency }) =>
            safeTool(() => context.portfolioService.getSnapshot((quoteCurrency ?? context.env.defaultQuoteCurrency).toUpperCase()))
    );
}

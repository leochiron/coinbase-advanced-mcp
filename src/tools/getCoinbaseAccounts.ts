import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetCoinbaseAccounts(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_coinbase_accounts",
        {
            description: "Fetch Coinbase accounts and balances using view permissions.",
            inputSchema: z.object({ raw: z.boolean().optional().default(false) }).strict()
        },
        async ({ raw }) => safeTool(() => context.portfolioService.getAccounts(raw))
    );
}

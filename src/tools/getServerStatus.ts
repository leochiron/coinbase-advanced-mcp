import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetServerStatus(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_server_status",
        {
            description: "Return local MCP server, Coinbase, trading, and audit status without secrets.",
            inputSchema: z.object({}).strict()
        },
        async () =>
            safeTool(() => {
                const knowledge = context.knowledgeService.getKnowledgeBase();
                return {
                    serverStarted: true,
                    transport: context.env.mcpTransport,
                    coinbaseConfigured: context.env.coinbaseConfigured,
                    tradingEnabled: context.env.tradingEnabled,
                    paperTradingEnabled: context.env.paperTradingEnabled,
                    riskLimitsEnabled: context.env.riskLimitsEnabled,
                    knowledgeBaseAvailable: knowledge.available,
                    knowledgeSourceCount: knowledge.enabledCount,
                    auditDatabaseAvailable: context.auditService.isAvailable(),
                    auditDatabasePath: context.env.auditDatabasePath
                };
            })
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerResetPaperPortfolio(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "reset_paper_portfolio",
        {
            description: 'Wipe and reseed the paper-trading portfolio. Requires confirmationText "CONFIRM_RESET_PAPER".',
            inputSchema: z
                .object({
                    confirmationText: z.string(),
                    startingBalances: z.record(z.string(), z.string()).optional()
                })
                .strict()
        },
        async ({ confirmationText, startingBalances }) =>
            safeTool(() => {
                if (confirmationText !== "CONFIRM_RESET_PAPER") {
                    throw new Error('confirmationText must exactly equal "CONFIRM_RESET_PAPER"');
                }
                return context.paperBrokerService.reset(startingBalances);
            })
    );
}

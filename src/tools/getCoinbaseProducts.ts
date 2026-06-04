import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetCoinbaseProducts(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_coinbase_products",
        {
            description: "List tradable Coinbase products, optionally filtered by quote currency and product type.",
            inputSchema: z
                .object({
                    quoteCurrency: z.string().optional(),
                    productType: z.string().optional()
                })
                .strict()
        },
        async ({ quoteCurrency, productType }) =>
            safeTool(() =>
                context.pricingService.listProducts({
                    quoteCurrency: (quoteCurrency ?? context.env.defaultQuoteCurrency).toUpperCase(),
                    productType
                })
            )
    );
}

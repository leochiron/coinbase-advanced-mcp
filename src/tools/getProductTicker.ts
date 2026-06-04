import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { productIdSchema } from "../utils/validators.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetProductTicker(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_product_ticker",
        {
            description: "Fetch current ticker snapshot for a Coinbase product such as BTC-EUR.",
            inputSchema: z.object({ productId: productIdSchema }).strict()
        },
        async ({ productId }) => safeTool(() => context.pricingService.getProductTicker(productId))
    );
}

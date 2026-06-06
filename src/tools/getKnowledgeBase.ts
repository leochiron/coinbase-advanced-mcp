import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetKnowledgeBase(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_knowledge_base",
        {
            description:
                "Return the operator's validated information sources. Consult this before any portfolio analysis or order proposal and ground your reasoning in these sources.",
            inputSchema: z.object({}).strict()
        },
        async () => safeTool(() => context.knowledgeService.getKnowledgeBase())
    );
}

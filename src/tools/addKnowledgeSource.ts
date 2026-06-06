import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sourceInputSchema } from "../services/knowledgeService.js";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerAddKnowledgeSource(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "add_knowledge_source",
        {
            description:
                'Add one source to the operator\'s validated knowledge base. Never call this on your own initiative: first PROPOSE the source to the user, and only call it once they confirm with confirmationText "CONFIRM_ADD_SOURCE". The user stays in control of their sources.',
            inputSchema: z
                .object({
                    source: sourceInputSchema,
                    confirmationText: z.string()
                })
                .strict()
        },
        async ({ source, confirmationText }) => safeTool(() => context.knowledgeService.addSource(source, confirmationText))
    );
}

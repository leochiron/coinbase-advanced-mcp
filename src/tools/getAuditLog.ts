import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./toolTypes.js";
import { safeTool } from "./toolTypes.js";

export function registerGetAuditLog(server: McpServer, context: ToolContext): void {
    server.registerTool(
        "get_audit_log",
        {
            description: "Return recent local audit actions with secrets redacted.",
            inputSchema: z.object({ limit: z.number().int().positive().max(250).optional().default(50) }).strict()
        },
        async ({ limit }) => safeTool(() => ({ entries: context.auditService.listAuditLog(limit) }))
    );
}

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function startHttpTransport(_server: McpServer): Promise<void> {
    void _server;
    return Promise.reject(new Error("HTTP / Streamable HTTP transport is intentionally not implemented in v1. Validate stdio first."));
}

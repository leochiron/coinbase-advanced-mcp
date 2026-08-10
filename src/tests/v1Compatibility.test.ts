import { describe, expect, it } from "vitest";
import { LEGACY_TOOL_REGISTRY } from "../server/mcpServer.js";

describe("v1 compatibility contract", () => {
    it("preserves every historical MCP tool name", () => {
        expect(LEGACY_TOOL_REGISTRY.map((item) => item.name)).toEqual([
            "get_server_status",
            "get_coinbase_accounts",
            "get_coinbase_products",
            "get_product_ticker",
            "get_portfolio_snapshot",
            "analyze_portfolio_allocation",
            "propose_limit_orders",
            "propose_stop_limit_orders",
            "create_order_dry_run",
            "execute_validated_order",
            "list_open_orders",
            "cancel_validated_order",
            "get_order_history",
            "get_audit_log",
            "get_paper_portfolio",
            "process_paper_orders",
            "reset_paper_portfolio",
            "get_knowledge_base",
            "add_knowledge_source"
        ]);
    });
});

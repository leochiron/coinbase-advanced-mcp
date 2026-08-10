import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../tools/toolTypes.js";
import { registerAddKnowledgeSource } from "../tools/addKnowledgeSource.js";
import { registerAnalyzePortfolioAllocation } from "../tools/analyzePortfolioAllocation.js";
import { registerCancelValidatedOrder } from "../tools/cancelValidatedOrder.js";
import { registerCreateOrderDryRun } from "../tools/createOrderDryRun.js";
import { registerExecuteValidatedOrder } from "../tools/executeValidatedOrder.js";
import { registerGetAuditLog } from "../tools/getAuditLog.js";
import { registerGetCoinbaseAccounts } from "../tools/getCoinbaseAccounts.js";
import { registerGetCoinbaseProducts } from "../tools/getCoinbaseProducts.js";
import { registerGetOrderHistory } from "../tools/getOrderHistory.js";
import { registerGetPortfolioSnapshot } from "../tools/getPortfolioSnapshot.js";
import { registerGetKnowledgeBase } from "../tools/getKnowledgeBase.js";
import { registerGetPaperPortfolio } from "../tools/getPaperPortfolio.js";
import { registerGetProductTicker } from "../tools/getProductTicker.js";
import { registerGetServerStatus } from "../tools/getServerStatus.js";
import { registerListOpenOrders } from "../tools/listOpenOrders.js";
import { registerProcessPaperOrders } from "../tools/processPaperOrders.js";
import { registerProposeLimitOrders } from "../tools/proposeLimitOrders.js";
import { registerProposeStopLimitOrders } from "../tools/proposeStopLimitOrders.js";
import { registerResetPaperPortfolio } from "../tools/resetPaperPortfolio.js";

type ToolRegistration = (server: McpServer, context: ToolContext) => void;

export const LEGACY_TOOL_REGISTRY: ReadonlyArray<{ name: string; register: ToolRegistration }> = [
    { name: "get_server_status", register: registerGetServerStatus },
    { name: "get_coinbase_accounts", register: registerGetCoinbaseAccounts },
    { name: "get_coinbase_products", register: registerGetCoinbaseProducts },
    { name: "get_product_ticker", register: registerGetProductTicker },
    { name: "get_portfolio_snapshot", register: registerGetPortfolioSnapshot },
    { name: "analyze_portfolio_allocation", register: registerAnalyzePortfolioAllocation },
    { name: "propose_limit_orders", register: registerProposeLimitOrders },
    { name: "propose_stop_limit_orders", register: registerProposeStopLimitOrders },
    { name: "create_order_dry_run", register: registerCreateOrderDryRun },
    { name: "execute_validated_order", register: registerExecuteValidatedOrder },
    { name: "list_open_orders", register: registerListOpenOrders },
    { name: "cancel_validated_order", register: registerCancelValidatedOrder },
    { name: "get_order_history", register: registerGetOrderHistory },
    { name: "get_audit_log", register: registerGetAuditLog },
    { name: "get_paper_portfolio", register: registerGetPaperPortfolio },
    { name: "process_paper_orders", register: registerProcessPaperOrders },
    { name: "reset_paper_portfolio", register: registerResetPaperPortfolio },
    { name: "get_knowledge_base", register: registerGetKnowledgeBase },
    { name: "add_knowledge_source", register: registerAddKnowledgeSource }
];

export function createMcpServer(context: ToolContext): McpServer {
    const server = new McpServer(
        {
            name: "coinbase-local-mcp",
            version: "2.0.0"
        },
        {
            instructions:
                "Use this local Coinbase MCP for portfolio data, market prices, mechanical allocation analysis, dry-runs, and explicitly confirmed order execution only. Never treat mechanical output as financial advice. Before analyzing the portfolio or proposing any orders, call get_knowledge_base and ground your reasoning in the operator's validated sources. You may propose adding a source, but never call add_knowledge_source without the user's explicit confirmation (CONFIRM_ADD_SOURCE)."
        }
    );

    for (const item of LEGACY_TOOL_REGISTRY) {
        item.register(server, context);
    }

    return server;
}

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

export function createMcpServer(context: ToolContext): McpServer {
    const server = new McpServer(
        {
            name: "coinbase-local-mcp",
            version: "0.1.0"
        },
        {
            instructions:
                "Use this local Coinbase MCP for portfolio data, market prices, mechanical allocation analysis, dry-runs, and explicitly confirmed order execution only. Never treat mechanical output as financial advice. Before analyzing the portfolio or proposing any orders, call get_knowledge_base and ground your reasoning in the operator's validated sources. You may propose adding a source, but never call add_knowledge_source without the user's explicit confirmation (CONFIRM_ADD_SOURCE)."
        }
    );

    registerGetServerStatus(server, context);
    registerGetCoinbaseAccounts(server, context);
    registerGetCoinbaseProducts(server, context);
    registerGetProductTicker(server, context);
    registerGetPortfolioSnapshot(server, context);
    registerAnalyzePortfolioAllocation(server, context);
    registerProposeLimitOrders(server, context);
    registerProposeStopLimitOrders(server, context);
    registerCreateOrderDryRun(server, context);
    registerExecuteValidatedOrder(server, context);
    registerListOpenOrders(server, context);
    registerCancelValidatedOrder(server, context);
    registerGetOrderHistory(server, context);
    registerGetAuditLog(server, context);
    registerGetPaperPortfolio(server, context);
    registerProcessPaperOrders(server, context);
    registerResetPaperPortfolio(server, context);
    registerGetKnowledgeBase(server, context);
    registerAddKnowledgeSource(server, context);

    return server;
}

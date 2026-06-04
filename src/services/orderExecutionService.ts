import type { AppEnv } from "../config/env.js";
import type { CoinbaseClient } from "../coinbase/coinbaseClient.js";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import { redactSecrets } from "../utils/redactSecrets.js";
import type { AuditService } from "./auditService.js";
import type { PaperBrokerService } from "./paperBrokerService.js";
import type { RiskLimitService } from "./riskLimitService.js";

type ExecutionClient = Pick<CoinbaseClient, "createOrder" | "cancelOrders" | "listOrders">;
type ExecutionEnv = Pick<AppEnv, "tradingEnabled" | "paperTradingEnabled" | "riskLimitsEnabled">;

export class OrderExecutionService {
    constructor(
        private readonly client: ExecutionClient,
        private readonly auditService: AuditService,
        private readonly env: ExecutionEnv,
        private readonly riskLimitService?: RiskLimitService,
        private readonly paperBroker?: PaperBrokerService
    ) {}

    async executeValidatedOrder(params: { dryRunId?: string; proposalId?: string; orderIndex?: number; confirmationText: string }) {
        if (params.confirmationText !== "CONFIRM_EXECUTE_ORDER") {
            throw new Error('confirmationText must exactly equal "CONFIRM_EXECUTE_ORDER"');
        }

        const payload = this.resolvePayload(params);
        const sourceId = params.dryRunId ?? params.proposalId ?? "unknown";

        // Optional risk guard runs before anything is sent or simulated.
        this.riskLimitService?.assertWithinLimits(payload);

        // Paper mode takes precedence over live trading and never touches Coinbase.
        if (this.env.paperTradingEnabled) {
            if (!this.paperBroker) {
                throw new Error("Paper trading is enabled but the paper broker is not available.");
            }
            const result = await this.paperBroker.submitOrder(payload, sourceId);
            return { ...result, clientOrderId: payload.client_order_id, timestamp: new Date().toISOString() };
        }

        if (!this.env.tradingEnabled) {
            throw new Error("Real trading is disabled. Set COINBASE_TRADING_ENABLED=true only when you intend to execute live orders.");
        }

        const response = await this.client.createOrder(payload);
        const auditLogId = this.auditService.saveExecution(sourceId, payload, response);

        return {
            mode: "LIVE",
            coinbaseOrderId: response.success_response?.order_id ?? response.order_id,
            clientOrderId: payload.client_order_id,
            status: response.success === false ? "FAILED" : "SENT",
            timestamp: new Date().toISOString(),
            auditLogId,
            raw: redactSecrets(response)
        };
    }

    async cancelValidatedOrder(params: { orderId: string; confirmationText: string }) {
        if (params.confirmationText !== "CONFIRM_CANCEL_ORDER") {
            throw new Error('confirmationText must exactly equal "CONFIRM_CANCEL_ORDER"');
        }

        // Paper orders are cancelled in the local simulation, never on Coinbase.
        if (this.env.paperTradingEnabled && params.orderId.startsWith("paper_")) {
            if (!this.paperBroker) {
                throw new Error("Paper trading is enabled but the paper broker is not available.");
            }
            return { mode: "PAPER", ...this.paperBroker.cancelOrder(params.orderId) };
        }

        if (!this.env.tradingEnabled) {
            throw new Error("Real trading is disabled. Set COINBASE_TRADING_ENABLED=true only when you intend to cancel live orders.");
        }

        const response = await this.client.cancelOrders([params.orderId]);
        const auditLogId = this.auditService.saveCancellation(params.orderId, response);

        return {
            status: response.results?.[0]?.success ? "CANCEL_REQUESTED" : "CANCEL_FAILED",
            result: response.results?.[0],
            auditLogId
        };
    }

    async listOpenOrders(productId?: string) {
        const response = await this.client.listOrders({
            productId,
            orderStatus: ["OPEN", "PENDING", "QUEUED", "CANCEL_QUEUED"]
        });

        return {
            orders: response.orders.map((order) => ({
                orderId: order.order_id,
                productId: order.product_id,
                side: order.side,
                orderType: order.order_type,
                status: order.status,
                createdTime: order.created_time,
                filledSize: order.filled_size,
                remainingSize: order.outstanding_hold_amount
            }))
        };
    }

    async getOrderHistory(params: {
        source: "COINBASE" | "LOCAL" | "BOTH";
        productId?: string;
        startDate?: string;
        endDate?: string;
        limit?: number;
    }) {
        const limit = params.limit ?? 50;
        const local = params.source === "LOCAL" || params.source === "BOTH" ? this.auditService.listLocalOrderHistory(limit) : undefined;
        const coinbase =
            params.source === "COINBASE" || params.source === "BOTH"
                ? await this.client.listOrders({
                      productId: params.productId,
                      startDate: params.startDate,
                      endDate: params.endDate,
                      limit
                  })
                : undefined;

        return {
            source: params.source,
            coinbase: coinbase?.orders,
            local
        };
    }

    private resolvePayload(params: { dryRunId?: string; proposalId?: string; orderIndex?: number }): CoinbaseOrderPayload {
        if (params.dryRunId) {
            const dryRun = this.auditService.getDryRun(params.dryRunId);
            if (!dryRun) {
                throw new Error(`dryRunId not found: ${params.dryRunId}`);
            }

            return dryRun.payload;
        }

        if (params.proposalId) {
            const proposal = this.auditService.getProposal(params.proposalId);
            if (!proposal) {
                throw new Error(`proposalId not found: ${params.proposalId}`);
            }

            const index = params.orderIndex ?? 0;
            const payload = proposal.orders[index];
            if (!payload) {
                throw new Error(`orderIndex ${index} was not found in proposal ${params.proposalId}`);
            }

            return payload;
        }

        throw new Error("Either dryRunId or proposalId is required");
    }
}

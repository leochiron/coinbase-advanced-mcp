import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    CoinbaseCancelOrdersResponse,
    CoinbaseCreateOrderResponse,
    CoinbaseOrderPayload,
    CoinbaseOrdersResponse
} from "../coinbase/coinbaseTypes.js";
import { OrderExecutionService } from "../services/orderExecutionService.js";
import type { AuditService } from "../services/auditService.js";
import { RiskLimitService } from "../services/riskLimitService.js";
import type { PaperBrokerService } from "../services/paperBrokerService.js";
import { createTestAuditService } from "./testHelpers.js";

type ExecutionClient = {
    createOrder: (payload: CoinbaseOrderPayload) => Promise<CoinbaseCreateOrderResponse>;
    cancelOrders: (orderIds: string[]) => Promise<CoinbaseCancelOrdersResponse>;
    listOrders: (params: unknown) => Promise<CoinbaseOrdersResponse>;
};

const EXECUTE_CONFIRMATION = "CONFIRM_EXECUTE_ORDER";
const CANCEL_CONFIRMATION = "CONFIRM_CANCEL_ORDER";

const liveEnv = { tradingEnabled: true, paperTradingEnabled: false, riskLimitsEnabled: false };
const tradingOffEnv = { tradingEnabled: false, paperTradingEnabled: false, riskLimitsEnabled: false };

function createFakeClient(overrides: Partial<ExecutionClient> = {}): ExecutionClient {
    return {
        createOrder: vi.fn(async () => ({
            success: true,
            success_response: { order_id: "cb-order-1" }
        })),
        cancelOrders: vi.fn(async (orderIds: string[]) => ({
            results: orderIds.map((order_id) => ({ success: true, order_id }))
        })),
        listOrders: vi.fn(async () => ({ orders: [] })),
        ...overrides
    };
}

function seedDryRun(audit: AuditService): { dryRunId: string; payload: CoinbaseOrderPayload } {
    const dryRun = audit.saveDryRun({
        client_order_id: "codex-dryrun-1",
        product_id: "BTC-EUR",
        side: "SELL",
        order_configuration: { limit_limit_gtc: { base_size: "0.01", limit_price: "90000", post_only: false } }
    });
    return { dryRunId: dryRun.dryRunId, payload: dryRun.payload };
}

describe("OrderExecutionService — execute locks", () => {
    let audit: AuditService;

    beforeEach(() => {
        audit = createTestAuditService();
    });

    it("rejects a wrong confirmation text before touching Coinbase", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);
        const { dryRunId } = seedDryRun(audit);

        await expect(
            service.executeValidatedOrder({ dryRunId, confirmationText: "confirm_execute_order" })
        ).rejects.toThrow(/CONFIRM_EXECUTE_ORDER/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("refuses to execute while trading is disabled", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, tradingOffEnv);
        const { dryRunId } = seedDryRun(audit);

        await expect(
            service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION })
        ).rejects.toThrow(/trading is disabled/i);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("requires either a dryRunId or a proposalId", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);

        await expect(service.executeValidatedOrder({ confirmationText: EXECUTE_CONFIRMATION })).rejects.toThrow(
            /dryRunId or proposalId/
        );
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("rejects an unknown dryRunId", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);

        await expect(
            service.executeValidatedOrder({ dryRunId: "dryrun_missing", confirmationText: EXECUTE_CONFIRMATION })
        ).rejects.toThrow(/dryRunId not found/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range orderIndex on a proposal", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);
        const proposal = audit.saveProposal("LIMIT", [
            {
                client_order_id: "codex-1",
                product_id: "BTC-EUR",
                side: "SELL",
                order_configuration: { limit_limit_gtc: { base_size: "0.01", limit_price: "90000", post_only: false } }
            }
        ]);

        await expect(
            service.executeValidatedOrder({
                proposalId: proposal.proposalId,
                orderIndex: 5,
                confirmationText: EXECUTE_CONFIRMATION
            })
        ).rejects.toThrow(/orderIndex 5/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });
});

describe("OrderExecutionService — execute happy paths", () => {
    let audit: AuditService;

    beforeEach(() => {
        audit = createTestAuditService();
    });

    it("sends the stored dry-run payload and records the execution", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);
        const { dryRunId, payload } = seedDryRun(audit);

        const result = await service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION });

        expect(client.createOrder).toHaveBeenCalledTimes(1);
        expect(client.createOrder).toHaveBeenCalledWith(payload);
        expect(result.status).toBe("SENT");
        expect(result.coinbaseOrderId).toBe("cb-order-1");
        expect(result.clientOrderId).toBe(payload.client_order_id);

        const history = audit.listLocalOrderHistory();
        expect(history).toHaveLength(1);
        expect((history[0] as { coinbase_order_id?: string }).coinbase_order_id).toBe("cb-order-1");
    });

    it("resolves the right order from a multi-order proposal via orderIndex", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);
        const second: CoinbaseOrderPayload = {
            client_order_id: "codex-2",
            product_id: "ETH-EUR",
            side: "SELL",
            order_configuration: { limit_limit_gtc: { base_size: "0.5", limit_price: "2000", post_only: false } }
        };
        const proposal = audit.saveProposal("LIMIT", [
            {
                client_order_id: "codex-1",
                product_id: "BTC-EUR",
                side: "SELL",
                order_configuration: { limit_limit_gtc: { base_size: "0.01", limit_price: "90000", post_only: false } }
            },
            second
        ]);

        await service.executeValidatedOrder({
            proposalId: proposal.proposalId,
            orderIndex: 1,
            confirmationText: EXECUTE_CONFIRMATION
        });

        expect(client.createOrder).toHaveBeenCalledWith(second);
    });

    it("reports FAILED when Coinbase returns success: false", async () => {
        const client = createFakeClient({
            createOrder: vi.fn(async () => ({ success: false, error_response: { error: "INSUFFICIENT_FUND" } }))
        });
        const service = new OrderExecutionService(client, audit, liveEnv);
        const { dryRunId } = seedDryRun(audit);

        const result = await service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION });

        expect(result.status).toBe("FAILED");
    });
});

describe("OrderExecutionService — cancel", () => {
    let audit: AuditService;

    beforeEach(() => {
        audit = createTestAuditService();
    });

    it("rejects a wrong cancel confirmation text", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);

        await expect(
            service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: "nope" })
        ).rejects.toThrow(/CONFIRM_CANCEL_ORDER/);
        expect(client.cancelOrders).not.toHaveBeenCalled();
    });

    it("refuses to cancel while trading is disabled", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, tradingOffEnv);

        await expect(
            service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION })
        ).rejects.toThrow(/trading is disabled/i);
        expect(client.cancelOrders).not.toHaveBeenCalled();
    });

    it("cancels the requested order and records it", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, liveEnv);

        const result = await service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION });

        expect(client.cancelOrders).toHaveBeenCalledWith(["cb-1"]);
        expect(result.status).toBe("CANCEL_REQUESTED");
    });

    it("reports CANCEL_FAILED when Coinbase rejects the cancellation", async () => {
        const client = createFakeClient({
            cancelOrders: vi.fn(async () => ({ results: [{ success: false, failure_reason: "UNKNOWN_CANCEL_ORDER" }] }))
        });
        const service = new OrderExecutionService(client, audit, liveEnv);

        const result = await service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION });

        expect(result.status).toBe("CANCEL_FAILED");
    });
});

describe("OrderExecutionService — paper mode & risk limits", () => {
    let audit: AuditService;

    beforeEach(() => {
        audit = createTestAuditService();
    });

    it("routes to the paper broker and never calls Coinbase, even with live trading off", async () => {
        const client = createFakeClient();
        const submitOrder = vi.fn(async () => ({ paperOrderId: "paper_1", mode: "PAPER", status: "OPEN" as const }));
        const paperBroker = { submitOrder } as unknown as PaperBrokerService;
        const env = { tradingEnabled: false, paperTradingEnabled: true, riskLimitsEnabled: false };
        const service = new OrderExecutionService(client, audit, env, undefined, paperBroker);
        const { dryRunId, payload } = seedDryRun(audit);

        const result = await service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION });

        expect(submitOrder).toHaveBeenCalledWith(payload, dryRunId);
        expect(result.paperOrderId).toBe("paper_1");
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("blocks an order that breaches the daily notional limit before sending", async () => {
        const client = createFakeClient();
        const riskEnv = { riskLimitsEnabled: true, maxDailyNotional: 100 };
        const riskLimitService = new RiskLimitService(audit, riskEnv);
        const env = { tradingEnabled: true, paperTradingEnabled: false, riskLimitsEnabled: true };
        const service = new OrderExecutionService(client, audit, env, riskLimitService);
        // Seeded dry-run notional = 0.01 * 90000 = 900 > 100.
        const { dryRunId } = seedDryRun(audit);

        await expect(
            service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION })
        ).rejects.toThrow(/MAX_DAILY_NOTIONAL/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("cancels a paper order locally without calling Coinbase", async () => {
        const client = createFakeClient();
        const cancelOrder = vi.fn(() => ({ paperOrderId: "paper_1", status: "CANCELLED" as const }));
        const paperBroker = { cancelOrder } as unknown as PaperBrokerService;
        const env = { tradingEnabled: false, paperTradingEnabled: true, riskLimitsEnabled: false };
        const service = new OrderExecutionService(client, audit, env, undefined, paperBroker);

        const result = await service.cancelValidatedOrder({ orderId: "paper_1", confirmationText: CANCEL_CONFIRMATION });

        expect(cancelOrder).toHaveBeenCalledWith("paper_1");
        expect(result.status).toBe("CANCELLED");
        expect(client.cancelOrders).not.toHaveBeenCalled();
    });
});

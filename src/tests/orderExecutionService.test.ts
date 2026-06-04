import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    CoinbaseCancelOrdersResponse,
    CoinbaseCreateOrderResponse,
    CoinbaseOrderPayload,
    CoinbaseOrdersResponse
} from "../coinbase/coinbaseTypes.js";
import { OrderExecutionService } from "../services/orderExecutionService.js";
import type { AuditService } from "../services/auditService.js";
import { createTestAuditService } from "./testHelpers.js";

type ExecutionClient = {
    createOrder: (payload: CoinbaseOrderPayload) => Promise<CoinbaseCreateOrderResponse>;
    cancelOrders: (orderIds: string[]) => Promise<CoinbaseCancelOrdersResponse>;
    listOrders: (params: unknown) => Promise<CoinbaseOrdersResponse>;
};

const EXECUTE_CONFIRMATION = "CONFIRM_EXECUTE_ORDER";
const CANCEL_CONFIRMATION = "CONFIRM_CANCEL_ORDER";

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
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });
        const { dryRunId } = seedDryRun(audit);

        await expect(
            service.executeValidatedOrder({ dryRunId, confirmationText: "confirm_execute_order" })
        ).rejects.toThrow(/CONFIRM_EXECUTE_ORDER/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("refuses to execute while trading is disabled", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: false });
        const { dryRunId } = seedDryRun(audit);

        await expect(
            service.executeValidatedOrder({ dryRunId, confirmationText: EXECUTE_CONFIRMATION })
        ).rejects.toThrow(/trading is disabled/i);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("requires either a dryRunId or a proposalId", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });

        await expect(service.executeValidatedOrder({ confirmationText: EXECUTE_CONFIRMATION })).rejects.toThrow(
            /dryRunId or proposalId/
        );
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("rejects an unknown dryRunId", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });

        await expect(
            service.executeValidatedOrder({ dryRunId: "dryrun_missing", confirmationText: EXECUTE_CONFIRMATION })
        ).rejects.toThrow(/dryRunId not found/);
        expect(client.createOrder).not.toHaveBeenCalled();
    });

    it("rejects an out-of-range orderIndex on a proposal", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });
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
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });
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
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });
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
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });
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
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });

        await expect(
            service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: "nope" })
        ).rejects.toThrow(/CONFIRM_CANCEL_ORDER/);
        expect(client.cancelOrders).not.toHaveBeenCalled();
    });

    it("refuses to cancel while trading is disabled", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: false });

        await expect(
            service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION })
        ).rejects.toThrow(/trading is disabled/i);
        expect(client.cancelOrders).not.toHaveBeenCalled();
    });

    it("cancels the requested order and records it", async () => {
        const client = createFakeClient();
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });

        const result = await service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION });

        expect(client.cancelOrders).toHaveBeenCalledWith(["cb-1"]);
        expect(result.status).toBe("CANCEL_REQUESTED");
    });

    it("reports CANCEL_FAILED when Coinbase rejects the cancellation", async () => {
        const client = createFakeClient({
            cancelOrders: vi.fn(async () => ({ results: [{ success: false, failure_reason: "UNKNOWN_CANCEL_ORDER" }] }))
        });
        const service = new OrderExecutionService(client, audit, { tradingEnabled: true });

        const result = await service.cancelValidatedOrder({ orderId: "cb-1", confirmationText: CANCEL_CONFIRMATION });

        expect(result.status).toBe("CANCEL_FAILED");
    });
});

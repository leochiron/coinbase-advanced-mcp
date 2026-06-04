import { describe, expect, it } from "vitest";
import { OrderExecutionService } from "../services/orderExecutionService.js";
import { OrderProposalService } from "../services/orderProposalService.js";
import { createTestAuditService } from "./testHelpers.js";

describe("order execution validation", () => {
    it("refuses execution when trading is disabled", async () => {
        const audit = createTestAuditService();
        const dryRun = new OrderProposalService(audit).createDryRun({
            productId: "BTC-EUR",
            side: "SELL",
            orderType: "LIMIT",
            baseSize: "0.1",
            limitPrice: "90000",
            timeInForce: "GTC"
        });
        const service = new OrderExecutionService(
            {
                createOrder: async () => ({ success: true }),
                cancelOrders: async () => ({ results: [] }),
                listOrders: async () => ({ orders: [] })
            },
            audit,
            { tradingEnabled: false }
        );

        await expect(
            service.executeValidatedOrder({
                dryRunId: dryRun.dryRunId,
                confirmationText: "CONFIRM_EXECUTE_ORDER"
            })
        ).rejects.toThrow("Real trading is disabled");
    });

    it("refuses execution with incorrect confirmation", async () => {
        const audit = createTestAuditService();
        const service = new OrderExecutionService(
            {
                createOrder: async () => ({ success: true }),
                cancelOrders: async () => ({ results: [] }),
                listOrders: async () => ({ orders: [] })
            },
            audit,
            { tradingEnabled: true }
        );

        await expect(service.executeValidatedOrder({ dryRunId: "dryrun_missing", confirmationText: "NO" })).rejects.toThrow(
            "CONFIRM_EXECUTE_ORDER"
        );
    });

    it("refuses cancellation with incorrect confirmation", async () => {
        const service = new OrderExecutionService(
            {
                createOrder: async () => ({ success: true }),
                cancelOrders: async () => ({ results: [] }),
                listOrders: async () => ({ orders: [] })
            },
            createTestAuditService(),
            { tradingEnabled: true }
        );

        await expect(service.cancelValidatedOrder({ orderId: "order-1", confirmationText: "NO" })).rejects.toThrow(
            "CONFIRM_CANCEL_ORDER"
        );
    });
});

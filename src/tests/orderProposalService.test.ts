import { describe, expect, it } from "vitest";
import { OrderProposalService } from "../services/orderProposalService.js";
import { createTestAuditService } from "./testHelpers.js";

describe("OrderProposalService", () => {
    it("persists limit order proposals with a proposal id", () => {
        const service = new OrderProposalService(createTestAuditService());
        const result = service.proposeLimitOrders([
            {
                productId: "BTC-EUR",
                side: "SELL",
                baseSize: "0.1",
                limitPrice: "90000",
                timeInForce: "GTC"
            }
        ]);

        expect(result.proposalId).toMatch(/^proposal_/);
        expect(result.coinbasePayloads[0]?.order_configuration.limit_limit_gtc).toBeDefined();
    });

    it("persists stop-limit proposals", () => {
        const service = new OrderProposalService(createTestAuditService());
        const result = service.proposeStopLimitOrders([
            {
                productId: "ETH-EUR",
                side: "SELL",
                baseSize: "0.5",
                stopPrice: "2000",
                limitPrice: "1950",
                timeInForce: "GTC"
            }
        ]);

        expect(result.proposalId).toMatch(/^proposal_/);
        expect(result.coinbasePayloads[0]?.order_configuration.stop_limit_stop_limit_gtc).toBeDefined();
    });

    it("can attach take-profit and stop-loss to a proposal", () => {
        const service = new OrderProposalService(createTestAuditService());
        const result = service.proposeLimitOrders([
            {
                productId: "BTC-EUR",
                side: "BUY",
                baseSize: "0.001",
                limitPrice: "64000",
                takeProfitPrice: "66000",
                stopLossPrice: "62800",
                timeInForce: "GTC"
            }
        ]);

        expect(result.coinbasePayloads[0]?.attached_order_configuration).toEqual({
            trigger_bracket_gtc: {
                limit_price: "66000",
                stop_trigger_price: "62800"
            }
        });
    });

    it("creates a dry-run with a client order id", () => {
        const service = new OrderProposalService(createTestAuditService());
        const result = service.createDryRun({
            productId: "BTC-EUR",
            side: "BUY",
            orderType: "LIMIT",
            quoteSize: "100",
            limitPrice: "50000",
            timeInForce: "GTC"
        });

        expect(result.dryRunId).toMatch(/^dryrun_/);
        expect(result.clientOrderId).toMatch(/^codex-/);
    });
});

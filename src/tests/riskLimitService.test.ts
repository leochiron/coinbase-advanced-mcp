import { beforeEach, describe, expect, it } from "vitest";
import type { CoinbaseOrderPayload } from "../coinbase/coinbaseTypes.js";
import type { AuditService } from "../services/auditService.js";
import { RiskLimitService } from "../services/riskLimitService.js";
import { createTestAuditService } from "./testHelpers.js";

function limitOrder(baseSize: string, limitPrice: string): CoinbaseOrderPayload {
    return {
        client_order_id: `codex-${baseSize}-${limitPrice}`,
        product_id: "BTC-EUR",
        side: "BUY",
        order_configuration: { limit_limit_gtc: { base_size: baseSize, limit_price: limitPrice, post_only: false } }
    };
}

const marketBaseOrder: CoinbaseOrderPayload = {
    client_order_id: "codex-market",
    product_id: "BTC-EUR",
    side: "SELL",
    order_configuration: { market_market_ioc: { base_size: "1" } }
};

describe("RiskLimitService", () => {
    let audit: AuditService;

    beforeEach(() => {
        audit = createTestAuditService();
    });

    it("is a no-op when risk limits are disabled", () => {
        const service = new RiskLimitService(audit, { riskLimitsEnabled: false, maxDailyNotional: 100 });
        // notional 100_000 would clearly exceed, but the guard is off.
        expect(() => service.assertWithinLimits(limitOrder("1", "100000"))).not.toThrow();
    });

    it("is a no-op when maxDailyNotional is zero (unlimited)", () => {
        const service = new RiskLimitService(audit, { riskLimitsEnabled: true, maxDailyNotional: 0 });
        expect(() => service.assertWithinLimits(limitOrder("1", "100000"))).not.toThrow();
    });

    it("allows an order under the daily cap", () => {
        const service = new RiskLimitService(audit, { riskLimitsEnabled: true, maxDailyNotional: 150 });
        expect(() => service.assertWithinLimits(limitOrder("1", "100"))).not.toThrow();
    });

    it("rejects when prior executions plus the candidate exceed the daily cap", () => {
        // Record an execution already worth 100 of notional today.
        audit.saveExecution("dryrun_x", limitOrder("1", "100"), { success: true });
        const service = new RiskLimitService(audit, { riskLimitsEnabled: true, maxDailyNotional: 150 });

        // Candidate notional 100 -> projected 200 > 150.
        expect(() => service.assertWithinLimits(limitOrder("1", "100"))).toThrow(/exceed MAX_DAILY_NOTIONAL/);
    });

    it("rejects when the candidate notional cannot be determined", () => {
        const service = new RiskLimitService(audit, { riskLimitsEnabled: true, maxDailyNotional: 1000 });
        expect(() => service.assertWithinLimits(marketBaseOrder)).toThrow(/cannot be determined/);
    });
});
